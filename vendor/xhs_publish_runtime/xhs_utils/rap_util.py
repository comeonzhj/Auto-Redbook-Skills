"""Bundled Creator x-rap-param adapter."""

import json
import os
import subprocess


_RAP_CLI = os.path.join(
    os.path.dirname(__file__),
    "xhs_pc",
    "js",
    "rap_cli.js",
)


def generate_x_rap_param(api, data, app_id=None, fingerprint_hex: str = ""):
    """Generate x-rap-param with the bundled local Node implementation."""
    body = data if isinstance(data, str) else json.dumps(
        data or {}, ensure_ascii=False
    )
    argv = ["node", _RAP_CLI, api, body]
    if app_id:
        argv.append(app_id)
    elif fingerprint_hex:
        argv.append("")
    if fingerprint_hex:
        argv.append(fingerprint_hex)

    try:
        result = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            cwd=os.path.dirname(_RAP_CLI),
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError("JS x-rap-param 生成失败") from exc

    output = (result.stdout or "").strip()
    if result.returncode == 0 and output.startswith("ByQ"):
        return output
    detail = (result.stderr or "").strip()
    raise RuntimeError(f"JS x-rap-param 生成失败: {detail or '无有效输出'}")
