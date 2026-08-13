"""Platform-neutral request identifiers used by XHS Web clients."""

from __future__ import annotations

import math
import random
import time
from urllib.parse import urlencode


def generate_x_b3_traceid(length: int = 16) -> str:
    alphabet = 'abcdef0123456789'
    return ''.join(alphabet[math.floor(16 * random.random())] for _ in range(length))


_xray_seq = [int(random.random() * 0x7fffff)]


def generate_xray_traceid() -> str:
    now = int(time.time() * 1000)
    _xray_seq[0] = (_xray_seq[0] + 1) & 0x7fffff
    part1 = format(((now << 23) | _xray_seq[0]) & 0xffffffffffffffff, 'x').rjust(16, '0')
    random64 = (random.getrandbits(32) << 32) | random.getrandbits(32)
    return part1 + format(random64, 'x').rjust(16, '0')


def splice_str(api: str, params: dict) -> str:
    return api + '?' + urlencode(
        {key: '' if value is None else value for key, value in params.items()},
        doseq=True,
    )


__all__ = ['generate_x_b3_traceid', 'generate_xray_traceid', 'splice_str']
