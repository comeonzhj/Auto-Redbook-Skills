"""Node adapter for Creator signing algorithms.

Python validates inputs and lifecycle only.  b1/MNS/X-s/X-S-Common/profileData
have one JavaScript implementation and are never reimplemented in Python.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from typing import Any, Mapping, Optional

from xhs_utils.xhs_core.runtime import generate_websectiga


_ROOT = os.path.dirname(os.path.dirname(__file__))
_CORE_JS_DIR = os.path.join(_ROOT, 'xhs_core', 'js')
_CREATOR_JS_DIR = os.path.join(os.path.dirname(__file__), 'js')
_B1_JS = os.path.join(_CORE_JS_DIR, 'b1.js')
_SIGN_JS = os.path.join(_CORE_JS_DIR, 'sign.js')
_PROFILE_JS = os.path.join(_CREATOR_JS_DIR, 'profile.js')

_TIER_GATE = {
    '0201': ('mns0201_', (200,)),
    # 0101 uses custom Base58. Its text length varies with leading magnitude
    # and the explicit deviceTag/a1 field lengths. Browser fixtures are
    # 196/197; sanitized long-a1 fixtures can reach 198.
    '0101': ('mns0101_', (196, 197, 198)),
}
_PROFILE_DATA_RE = re.compile(r'^[0-9a-f]{5000,20000}$', re.I)


def _run_node(argv: list[str], *, timeout: float) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=os.path.dirname(argv[1]),
            encoding='utf-8',
            errors='replace',
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(f'Creator Node runtime failed to start: {exc}') from exc


def generate_b1(
    options: Optional[Mapping[str, Any]] = None,
    timeout: float = 10.0,
) -> str:
    payload = json.dumps(dict(options or {}), ensure_ascii=False, separators=(',', ':'))
    proc = _run_node(['node', _B1_JS, '--generate', payload], timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(f'Creator b1 runtime failed: {(proc.stderr or proc.stdout)[:500]}')
    try:
        value = str(json.loads(proc.stdout.strip())['b1'])
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise RuntimeError(f'Creator b1 output invalid: {proc.stdout[:300]}') from exc
    if len(value) < 500 or len(value) % 4:
        raise RuntimeError(f'Creator b1 length invalid: {len(value)}')
    return value


def run_signer(
    api: str,
    data: Any = '',
    *,
    cookie: str,
    b1: Optional[str],
    dsl_pair: str,
    tier: str,
    sign_context: Mapping[str, Any],
    timeout: float = 30.0,
) -> dict:
    if tier not in _TIER_GATE:
        raise ValueError(f'unsupported Creator MNS tier: {tier}')
    if not cookie or 'a1=' not in cookie:
        raise ValueError('Creator signer cookie must contain a1')
    if b1 is None:
        raise ValueError('Creator signer b1 must be explicit (empty string is valid)')
    if not dsl_pair or ';' not in dsl_pair:
        raise ValueError('Creator signer dsl_pair must be dsllt;_dsl')

    context = dict(sign_context or {})
    required = (
        'now', 'version', 'loadts', 'seq', 'envConst', 'envFpTail',
        'deviceTag', 'webBuild', 'signVersion', 'appId', 'platform',
    )
    missing = [key for key in required if key not in context]
    if missing:
        raise ValueError(f'Creator sign_context missing: {", ".join(missing)}')
    if (
        tier == '0101'
        and str(context.get('deviceTag') or '') != 'nop'
        and not context.get('dsProgram')
    ):
        raise ValueError(
            'Creator mns0101 requires the server-issued DS program for exact _dsf'
        )

    payload = {
        'api': str(api),
        'data': data,
        'cookie': str(cookie),
        'b1': str(b1),
        'dslPair': str(dsl_pair),
        'tier': tier,
    }
    for key in (
        'now', 'version', 'loadts', 'seq', 'envConst', 'envFpTail',
        'deviceTag', 'b1b1', 'signCount', 'webBuild', 'signVersion',
        'appId', 'platform',
        'dsProgram', 'xt',
    ):
        if key in context:
            payload[key] = context[key]

    temp_path = ''
    try:
        with tempfile.NamedTemporaryFile(
            mode='w', encoding='utf-8', suffix='.json', delete=False
        ) as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(',', ':'))
            temp_path = handle.name
        proc = _run_node(['node', _SIGN_JS, f'@{temp_path}'], timeout=timeout)
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
    if proc.returncode != 0:
        message = (proc.stderr or proc.stdout or '').strip()
        raise RuntimeError(f'Creator signer failed: {message[:500]}')

    try:
        result = json.loads((proc.stdout or '').strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError) as exc:
        raise RuntimeError(f'Creator signer output invalid: {proc.stdout[:300]}') from exc
    required_prefix, allowed_lengths = _TIER_GATE[tier]
    x3 = str(result.get('x3') or '')
    if (
        not result.get('xs')
        or not result.get('xs_common')
        or not x3.startswith(required_prefix)
        or len(x3) not in allowed_lengths
    ):
        raise RuntimeError(
            f'Creator signer gate failed: tier={tier}, prefix={x3[:12]}, len={len(x3)}'
        )
    return result


def generate_profile_data(
    options: Mapping[str, Any],
    timeout: float = 10.0,
) -> str:
    payload = json.dumps(dict(options), ensure_ascii=False, separators=(',', ':'))
    proc = _run_node(['node', _PROFILE_JS, payload], timeout=timeout)
    if proc.returncode != 0:
        message = (proc.stderr or proc.stdout or '').strip()
        raise RuntimeError(f'Creator profileData runtime failed: {message[:500]}')
    try:
        result = json.loads((proc.stdout or '').strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError) as exc:
        raise RuntimeError(f'Creator profileData output invalid: {proc.stdout[:300]}') from exc
    value = str(result.get('profileData') or '')
    if (
        result.get('sdkVersion') != '4.3.6'
        or int(result.get('length') or 0) != len(value)
        or not _PROFILE_DATA_RE.fullmatch(value)
    ):
        raise RuntimeError('Creator profileData output gate failed')
    return value


__all__ = [
    'generate_b1',
    'run_signer',
    'generate_profile_data',
    'generate_websectiga',
]
