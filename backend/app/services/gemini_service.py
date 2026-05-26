"""Gemini API integration for 'Why now?' sentence generation.

This service generates a single observational sentence explaining why the
primary recommendation fits the current moment. It is the perceived intelligence
of the product — the sentence must describe content qualities and context,
never the user's emotional state.

See CLAUDE.md § "Why Now?" Sentence — Strict Constraints.
"""

from __future__ import annotations

import hashlib
import logging
import re
import time as _time
from dataclasses import dataclass

import httpx

from app.config import Settings
from app.models.recommendation import WhyNowContext, WhyNowResult

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
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
    "lonely",
    "sad",
    "depressed",
    "vulnerable",
    "struggling",
    "anxious",
    "stressed",
    "emotional state",
    "feeling",
    "mood",
    "you seem",
    "you appear",
    "you might be",
    "your emotions",
    "psychological",
    "mental",
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
        self._store[key] = _CacheEntry(
            sentence=sentence,
            expires_at=_time.time() + self._ttl,
        )

    def clear_expired(self) -> None:
        now = _time.time()
        expired_keys = [k for k, v in self._store.items() if now > v.expires_at]
        for k in expired_keys:
            del self._store[k]


# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------

def _build_user_prompt(ctx: WhyNowContext) -> str:
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


def _build_request_body(user_prompt: str) -> dict:
    return {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_prompt}],
            }
        ],
        "systemInstruction": {
            "parts": [{"text": SYSTEM_PROMPT}],
        },
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 100,
            "topP": 0.9,
            "topK": 40,
        },
        "safetySettings": [
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
        ],
    }


def _extract_sentence(response_json: dict) -> str | None:
    """Extract the generated text from Gemini response. Returns None on failure."""
    try:
        candidates = response_json.get("candidates")
        if not candidates or len(candidates) == 0:
            return None

        candidate = candidates[0]

        if candidate.get("finishReason") == "SAFETY":
            logger.warning("Gemini response blocked by safety filter")
            return None

        parts = candidate.get("content", {}).get("parts")
        if not parts or len(parts) == 0:
            return None

        raw_text = parts[0].get("text", "").strip()
        return raw_text if raw_text else None

    except (KeyError, IndexError, TypeError, AttributeError):
        return None


def _post_process(raw: str) -> str:
    """Clean, truncate, and normalize a raw Gemini sentence."""
    sentence = raw.strip().strip('"').strip("'").strip()

    multi = re.search(r'[.!?]\s+[A-Z]', sentence)
    if multi:
        sentence = sentence[:multi.start() + 1]

    if sentence and sentence[-1] not in '.!?':
        sentence += '.'

    return sentence.strip()


def _validate(sentence: str) -> bool:
    """Return True if sentence contains no forbidden patterns."""
    lower = sentence.lower()
    for pattern in FORBIDDEN_PATTERNS:
        if pattern in lower:
            logger.warning(
                "Forbidden pattern %r found in Gemini output: %s",
                pattern,
                sentence,
            )
            return False
    return True


def _get_fallback(title: str, time_of_day: str) -> str:
    hash_input = f"{title}:{time_of_day}"
    digest = hashlib.sha256(hash_input.encode("utf-8")).hexdigest()
    index = int(digest, 16) % len(FALLBACK_SENTENCES)
    return FALLBACK_SENTENCES[index]


def _make_cache_key(ctx: WhyNowContext) -> str:
    return f"whynow:{ctx.media_id}:{ctx.mood}:{ctx.time_of_day}:{ctx.time_available}"


# ---------------------------------------------------------------------------
# Service Class
# ---------------------------------------------------------------------------

class GeminiService:
    """Generates the 'Why now?' sentence via the Gemini REST API.

    Usage:
        settings = Settings()
        service = GeminiService(settings)
        result = await service.generate_why_now(context)
    """

    def __init__(self, settings: Settings) -> None:
        self._api_key: str = settings.gemini_api_key
        self._model: str = settings.gemini_model
        self._base_url: str = settings.gemini_base_url
        self._timeout: float = settings.gemini_timeout_seconds
        self._cache = _WhyNowCache(ttl_seconds=settings.gemini_cache_ttl_seconds)

        self._endpoint: str = (
            f"{self._base_url}/models/{self._model}:generateContent"
        )

        if not self._api_key:
            logger.warning(
                "GEMINI_API_KEY is not set. All 'Why now?' sentences will use fallbacks."
            )

        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self._timeout, connect=5.0),
                headers={"Content-Type": "application/json"},
            )
        return self._client

    async def generate_why_now(self, ctx: WhyNowContext) -> WhyNowResult:
        """Generate a 'Why now?' sentence for the given recommendation context."""
        cache_key = _make_cache_key(ctx)

        # Step 1: Cache check
        cached = self._cache.get(cache_key)
        if cached is not None:
            logger.debug("Cache hit for key=%s", cache_key)
            return WhyNowResult(sentence=cached, source="cache")

        # Step 2: Bail if no API key
        if not self._api_key:
            fallback = _get_fallback(ctx.title, ctx.time_of_day)
            return WhyNowResult(sentence=fallback, source="fallback")

        # Step 3: Build request
        user_prompt = _build_user_prompt(ctx)
        body = _build_request_body(user_prompt)
        url = f"{self._endpoint}?key={self._api_key}"

        # Step 4: Call Gemini (with retry on 5xx)
        sentence = await self._call_gemini(url, body, ctx)

        # Step 5: Return result
        if sentence is not None:
            self._cache.set(cache_key, sentence)
            return WhyNowResult(sentence=sentence, source="gemini")

        fallback = _get_fallback(ctx.title, ctx.time_of_day)
        self._cache.set(cache_key, fallback)
        return WhyNowResult(sentence=fallback, source="fallback")

    async def _call_gemini(
        self, url: str, body: dict, ctx: WhyNowContext, *, is_retry: bool = False
    ) -> str | None:
        """Make the HTTP request to Gemini and process the response."""
        client = await self._get_client()

        try:
            response = await client.post(url, json=body)
        except httpx.TimeoutException:
            logger.warning("Gemini request timed out after %.1fs", self._timeout)
            return None
        except httpx.HTTPError as exc:
            logger.error("Gemini HTTP error: %s", exc)
            return None

        status = response.status_code

        if status == 429:
            logger.warning("Gemini rate limited (429). Using fallback.")
            return None

        if status == 400:
            logger.error(
                "Gemini bad request (400): %s", response.text[:500]
            )
            return None

        if status >= 500:
            if not is_retry:
                logger.warning("Gemini server error (%d). Retrying once...", status)
                return await self._call_gemini(url, body, ctx, is_retry=True)
            else:
                logger.error("Gemini server error (%d) on retry. Using fallback.", status)
                return None

        if status != 200:
            logger.error("Gemini unexpected status %d: %s", status, response.text[:500])
            return None

        try:
            response_json = response.json()
        except Exception:
            logger.error("Gemini response is not valid JSON")
            return None

        raw = _extract_sentence(response_json)
        if raw is None:
            logger.warning("Could not extract sentence from Gemini response")
            return None

        sentence = _post_process(raw)
        if not sentence:
            logger.warning("Post-processing resulted in empty sentence")
            return None

        if not _validate(sentence):
            return None

        return sentence

    async def close(self) -> None:
        """Close the shared HTTP client. Call during app shutdown."""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
