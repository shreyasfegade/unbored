"""Minimal in-process metrics counters.

No external dependency — just process-lifetime counters surfaced on /api/status,
so the AI success/failure rate, regenerate rate, and engine-vs-AI split are
observable at all (previously the only signal, regeneration_count, was collected
and thrown away). For real deployments these would feed a proper sink.
"""

from __future__ import annotations

import threading
from collections import Counter

_lock = threading.Lock()
_counters: Counter[str] = Counter()


def incr(name: str, n: int = 1) -> None:
    with _lock:
        _counters[name] += n


def snapshot() -> dict[str, int]:
    with _lock:
        return dict(_counters)
