"""Build the configured LLM provider from settings."""

from __future__ import annotations

import logging

from app.config import Settings
from app.llm.base import LLMProvider
from app.llm.gemini import GeminiProvider
from app.llm.openai_compatible import OpenAICompatibleProvider

logger = logging.getLogger(__name__)


def build_provider(settings: Settings) -> LLMProvider | None:
    """Return a provider instance, or ``None`` to use offline fallbacks.

    Selection is driven by ``settings.resolve_llm_provider()``, which honours
    an explicit ``LLM_PROVIDER`` or auto-detects the first provider with a key.
    """
    name = settings.resolve_llm_provider()
    timeout = settings.llm_timeout_seconds

    if name == "none":
        logger.info("No LLM provider configured — using offline 'Why now?' sentences")
        return None

    if name == "gemini":
        provider: LLMProvider = GeminiProvider(
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            base_url=settings.gemini_base_url,
            timeout=timeout,
        )
    elif name == "deepseek":
        provider = OpenAICompatibleProvider(
            name="deepseek",
            api_key=settings.deepseek_api_key,
            model=settings.deepseek_model,
            base_url=settings.deepseek_base_url,
            timeout=timeout,
        )
    elif name == "openai":
        provider = OpenAICompatibleProvider(
            name="openai",
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            base_url=settings.openai_base_url,
            timeout=timeout,
        )
    elif name == "openrouter":
        provider = OpenAICompatibleProvider(
            name="openrouter",
            api_key=settings.openrouter_api_key,
            model=settings.openrouter_model,
            base_url=settings.openrouter_base_url,
            timeout=timeout,
            # OpenRouter asks clients to identify themselves; harmless elsewhere.
            extra_headers={
                "HTTP-Referer": "https://github.com/unbored",
                "X-Title": "Unbored",
            },
        )
    else:  # pragma: no cover - defensive
        logger.warning("Unknown LLM provider %r — using offline fallbacks", name)
        return None

    logger.info("LLM provider active: %s", provider.label)
    return provider
