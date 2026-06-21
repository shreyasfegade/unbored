"""Application configuration.

Every external API key is optional. Unbored is designed to start and run with
zero configuration: with no TMDB key it serves a bundled offline catalog, and
with no LLM key it falls back to hand-written "Why now?" sentences. Keys only
*upgrade* the experience — they are never required to boot.
"""

from __future__ import annotations

from functools import cached_property

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Catalog sources ────────────────────────────────────────────────
    tmdb_api_key: str = ""
    tmdb_base_url: str = "https://api.themoviedb.org/3"
    anilist_base_url: str = "https://graphql.anilist.co"

    # ── LLM ("Why now?" generation) ────────────────────────────────────
    # Provider selection. "auto" picks the first provider that has a key,
    # in the order gemini → deepseek → openai → openrouter. Set explicitly
    # to force one, or "none" to always use the offline fallback sentences.
    llm_provider: str = "auto"
    llm_timeout_seconds: float = 8.0
    llm_cache_ttl_seconds: int = 3600

    # Gemini
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"

    # DeepSeek (OpenAI-compatible)
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-chat"
    deepseek_base_url: str = "https://api.deepseek.com/v1"

    # OpenAI (and any OpenAI-compatible endpoint)
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_base_url: str = "https://api.openai.com/v1"

    # OpenRouter (OpenAI-compatible gateway to many models)
    openrouter_api_key: str = ""
    openrouter_model: str = "google/gemini-2.0-flash-001"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"

    # ── Runtime ────────────────────────────────────────────────────────
    storage_dir: str = "./data"
    cors_origins: str = "http://localhost:5173,http://localhost:4173"
    log_level: str = "INFO"
    candidate_pool_size: int = 500
    pool_refresh_hours: int = 6

    # ── Legacy alias (kept so existing GEMINI_* envs keep working) ──────
    @property
    def gemini_timeout_seconds(self) -> float:
        return self.llm_timeout_seconds

    @property
    def gemini_cache_ttl_seconds(self) -> int:
        return self.llm_cache_ttl_seconds

    # ── Derived state ──────────────────────────────────────────────────
    @cached_property
    def has_tmdb(self) -> bool:
        return bool(self.tmdb_api_key.strip())

    @property
    def catalog_mode(self) -> str:
        """'live' when a TMDB key is present, otherwise 'demo' (offline catalog)."""
        return "live" if self.has_tmdb else "demo"

    def resolve_llm_provider(self) -> str:
        """Return the effective provider name based on configuration and keys.

        Returns one of: "gemini", "deepseek", "openai", "openrouter", "none".
        """
        choice = (self.llm_provider or "auto").strip().lower()

        keyed = {
            "gemini": bool(self.gemini_api_key.strip()),
            "deepseek": bool(self.deepseek_api_key.strip()),
            "openai": bool(self.openai_api_key.strip()),
            "openrouter": bool(self.openrouter_api_key.strip()),
        }

        if choice in keyed:
            return choice if keyed[choice] else "none"
        if choice == "none":
            return "none"

        # auto: first configured provider in priority order
        for name in ("gemini", "deepseek", "openai", "openrouter"):
            if keyed[name]:
                return name
        return "none"


settings = Settings()
