"""In-memory cache of per-user LLM providers (BYO key).

User API keys arrive per request. Rebuilding an httpx-backed provider on every
request would be wasteful, so providers are cached briefly, keyed by a hash of
the key (never the key itself). Nothing here is persisted to disk, and keys are
never logged.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time

from app.config import Settings
from app.llm.base import LLMProvider
from app.llm.factory import build_user_provider

logger = logging.getLogger(__name__)


def _fingerprint(name: str, api_key: str) -> str:
    return f"{name}:{hashlib.sha256(api_key.encode('utf-8')).hexdigest()[:16]}"


class ProviderCache:
    def __init__(self, settings: Settings, *, ttl_seconds: int = 1800, max_size: int = 64) -> None:
        self._settings = settings
        self._ttl = ttl_seconds
        self._max = max_size
        self._store: dict[str, tuple[LLMProvider, float]] = {}

    def get(self, name: str, api_key: str) -> LLMProvider | None:
        """Return a provider for this (provider, key), building+caching if needed."""
        name = (name or "").strip().lower()
        api_key = (api_key or "").strip()
        if not name or not api_key:
            return None

        key = _fingerprint(name, api_key)
        now = time.time()

        entry = self._store.get(key)
        if entry is not None:
            provider, _ = entry
            self._store[key] = (provider, now)
            return provider

        provider = build_user_provider(name, api_key, self._settings)
        if provider is None:
            return None

        self._evict_if_needed(now)
        self._store[key] = (provider, now)
        logger.info("Built per-user %s provider (cache size=%d)", name, len(self._store))
        return provider

    def _evict_if_needed(self, now: float) -> None:
        # Drop expired entries first, then the least-recently-used if still full.
        expired = [k for k, (_, ts) in self._store.items() if now - ts > self._ttl]
        for k in expired:
            self._close(self._store.pop(k)[0])
        if len(self._store) >= self._max:
            lru = min(self._store, key=lambda k: self._store[k][1])
            self._close(self._store.pop(lru)[0])

    @staticmethod
    def _close(provider: LLMProvider) -> None:
        try:
            asyncio.create_task(provider.close())
        except RuntimeError:
            pass  # no running loop (shutdown)

    async def close_all(self) -> None:
        for provider, _ in self._store.values():
            await provider.close()
        self._store.clear()
