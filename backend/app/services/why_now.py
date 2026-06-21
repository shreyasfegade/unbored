"""'Why now?' sentence generation — the perceived intelligence of the product.

This service is provider-agnostic: it builds the prompt, caches results, cleans
and validates output, and falls back to hand-written sentences when generation
fails or no LLM is configured. The actual text generation is delegated to an
:class:`app.llm.base.LLMProvider` (Gemini, DeepSeek, OpenAI, …).

The generated sentence must describe *content qualities and context* — never
the user's emotional state. See the forbidden-pattern guard below.
"""

from __future__ import annotations

import hashlib
import logging
import re
import time as _time
from dataclasses import dataclass

from app.config import Settings
from app.llm.base import LLMProvider
from app.models.recommendation import WhyNowContext, WhyNowResult

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a recommendation confidence writer for a movie/show recommendation app. You write exactly ONE short sentence explaining why a piece of content is a good pick right now.

RULES:
- Maximum 1 sentence. Never more.
- Tone: observational, cinematic, confident. Like a film critic's aside.
- ONLY reference: content qualities (genre, pacing, tone, atmosphere, length), time of day, runtime fit, or taste pattern match.
- NEVER reference the user's emotions, mental state, or psychological profile.
- NEVER use these words: lonely, sad, depressed, vulnerable, struggling, emotional state, feeling, mood, anxious, stressed
- Do NOT start with "Based on" or "Because you"
- Do NOT use phrases like "you might enjoy" or "you seem to like"
- Write as if describing why the content fits the moment, not the person.

Examples of GOOD output:
- "Late-night, slower pacing, and strong atmosphere make this a particularly good fit tonight."
- "Short, intense, and exactly the right length for the time you have."
- "Complex narrative with the right edge for this hour.\""""

FORBIDDEN_PATTERNS: list[str] = [
    "lonely", "sad", "depressed", "vulnerable", "struggling", "anxious",
    "stressed", "emotional state", "feeling", "mood", "you seem", "you appear",
    "you might be", "your emotions", "psychological", "mental",
]

FALLBACK_SENTENCES: list[str] = [
    "Strong match for your taste profile and the time you have.",
    "Right tone, right length, right now.",
    "A confident pick for tonight.",
    "Fits the moment well.",
]

TIME_AVAILABLE_MAP: dict[str, str] = {
    "short": "~20 minutes",
    "medium": "~1 hour",
    "long": "2+ hours",
}


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

@dataclass
class _CacheEntry:
    sentence: str
    expires_at: float


class _WhyNowCache:
    """In-memory TTL cache for generated sentences."""

    def __init__(self, ttl_seconds: int = 3600) -> None:
        self._ttl = ttl_seconds
        self._store: dict[str, _CacheEntry] = {}

    def get(self, key: str) -> str | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        if _time.time() > entry.expires_at:
            del self._store[key]
            return None
        return entry.sentence

    def set(self, key: str, sentence: str) -> None:
        self._store[key] = _CacheEntry(sentence, _time.time() + self._ttl)

    def clear_expired(self) -> None:
        now = _time.time()
        for k in [k for k, v in self._store.items() if now > v.expires_at]:
            del self._store[k]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def build_user_prompt(ctx: WhyNowContext) -> str:
    genres_str = ", ".join(ctx.genres) if ctx.genres else "Unknown"
    keywords_str = ", ".join(ctx.top_keywords) if ctx.top_keywords else "None"
    time_display = TIME_AVAILABLE_MAP.get(ctx.time_available, ctx.time_available)
    time_of_day_display = ctx.time_of_day.replace("_", " ")
    return (
        f"Content: {ctx.title} ({ctx.year})\n"
        f"Genres: {genres_str}\n"
        f"Runtime: {ctx.runtime_minutes} minutes\n"
        f"Rating: {ctx.rating}/10\n"
        f"Keywords: {keywords_str}\n"
        f"Time of day: {time_of_day_display}\n"
        f"Time available: {time_display}\n"
        f"Taste match factors: genre overlap ({ctx.genre_score_pct}%), "
        f"keyword overlap ({ctx.keyword_score_pct}%)\n"
        f"\n"
        f"Write one sentence."
    )


def post_process(raw: str) -> str:
    """Clean, truncate to one sentence, and normalize terminal punctuation."""
    sentence = raw.strip().strip('"').strip("'").strip()
    multi = re.search(r"[.!?]\s+[A-Z]", sentence)
    if multi:
        sentence = sentence[: multi.start() + 1]
    if sentence and sentence[-1] not in ".!?":
        sentence += "."
    return sentence.strip()


def validate(sentence: str) -> bool:
    """Return True if the sentence contains no forbidden (psychologizing) terms."""
    lower = sentence.lower()
    for pattern in FORBIDDEN_PATTERNS:
        if pattern in lower:
            logger.warning("Forbidden pattern %r in LLM output: %s", pattern, sentence)
            return False
    return True


def get_fallback(title: str, time_of_day: str) -> str:
    digest = hashlib.sha256(f"{title}:{time_of_day}".encode("utf-8")).hexdigest()
    return FALLBACK_SENTENCES[int(digest, 16) % len(FALLBACK_SENTENCES)]


def make_cache_key(ctx: WhyNowContext) -> str:
    return f"whynow:{ctx.media_id}:{ctx.mood}:{ctx.time_of_day}:{ctx.time_available}"


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class WhyNowService:
    """Generates 'Why now?' sentences via a pluggable LLM provider.

    Usage:
        provider = build_provider(settings)        # may be None
        service = WhyNowService(settings, provider)
        result = await service.generate_why_now(context)
    """

    def __init__(self, settings: Settings, provider: LLMProvider | None) -> None:
        self._provider = provider
        self._cache = _WhyNowCache(ttl_seconds=settings.llm_cache_ttl_seconds)
        if provider is None:
            logger.info("WhyNowService running in offline mode (fallback sentences).")

    @property
    def provider_name(self) -> str | None:
        return self._provider.name if self._provider else None

    @property
    def status(self) -> dict:
        return {
            "configured": self._provider is not None,
            "provider": self._provider.name if self._provider else None,
            "model": self._provider.model if self._provider else None,
            "label": self._provider.label if self._provider else "Offline (built-in sentences)",
        }

    async def generate_why_now(self, ctx: WhyNowContext) -> WhyNowResult:
        cache_key = make_cache_key(ctx)

        cached = self._cache.get(cache_key)
        if cached is not None:
            return WhyNowResult(sentence=cached, source="cache", provider=self.provider_name)

        if self._provider is None:
            return WhyNowResult(
                sentence=get_fallback(ctx.title, ctx.time_of_day),
                source="fallback",
                provider=None,
            )

        raw = await self._provider.generate(
            system=SYSTEM_PROMPT,
            user=build_user_prompt(ctx),
            temperature=0.7,
            max_tokens=120,
        )

        sentence = post_process(raw) if raw else ""
        if sentence and validate(sentence):
            self._cache.set(cache_key, sentence)
            return WhyNowResult(sentence=sentence, source="llm", provider=self.provider_name)

        fallback = get_fallback(ctx.title, ctx.time_of_day)
        self._cache.set(cache_key, fallback)
        return WhyNowResult(sentence=fallback, source="fallback", provider=self.provider_name)

    async def close(self) -> None:
        if self._provider is not None:
            await self._provider.close()
