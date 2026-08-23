"""Upstream AI query expansion.

The curator (downstream) can only reorder a shortlist the deterministic engine
already chose. This runs *before* ranking: it turns the request into structured
retrieval hints — which genres to lean into — so the AI shapes *what gets
considered*, which is where the leverage is. Failures fall back to no bias, so
the engine path is never worse off for trying.

Results are cached by (favourites, mood, slot, type, era): a user re-rolling the
same context pays for this once.
"""

from __future__ import annotations

import json
import logging
import re
import time

from app.llm.base import LLMProvider

logger = logging.getLogger(__name__)

_SYSTEM = (
    "You are a film/TV/anime taste analyst. Given what someone loves and how they feel right "
    "now, name the 2-4 genres most worth surfacing for them tonight. Reply with JSON only."
)
_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)

# Only bias toward genres the catalog actually uses (lowercased).
_KNOWN_GENRES = {
    "action", "adventure", "animation", "comedy", "crime", "documentary", "drama",
    "family", "fantasy", "history", "horror", "music", "mystery", "romance",
    "science fiction", "sci-fi", "thriller", "war", "western", "supernatural",
    "psychological", "slice of life", "sports", "mecha", "isekai",
}

_MOOD_LABEL = {
    "happy_energetic": "happy and energetic",
    "tired_low": "tired and low-energy",
    "anxious": "anxious, wanting comfort",
    "want_to_cry": "wanting something moving",
    "mindblown_curious": "curious, wanting to be amazed",
    "want_to_laugh": "wanting to laugh",
    "thrilled": "wanting a thrill",
}

# (result, expires_at) keyed by a compact context string.
_cache: dict[str, tuple[dict[str, float], float]] = {}
_TTL = 1800.0
_MAX = 512


def _key(liked_titles: list[str], mood: str | None, slot: str, media_type: str | None, era: str) -> str:
    return "|".join([",".join(sorted(liked_titles[:8])), mood or "", slot, media_type or "", era])


def _parse(raw: str) -> dict[str, float]:
    match = _JSON_RE.search(raw or "")
    if not match:
        return {}
    try:
        data = json.loads(match.group(0))
    except (json.JSONDecodeError, ValueError):
        return {}
    genres = data.get("genres") or []
    boosts: dict[str, float] = {}
    for g in genres:
        if not isinstance(g, str):
            continue
        key = g.lower().strip()
        if key in _KNOWN_GENRES:
            boosts[key] = 1.0
    return boosts


async def expand(
    provider: LLMProvider,
    *,
    liked_titles: list[str],
    mood: str | None,
    time_available: str,
    media_type: str | None,
    era: str,
) -> dict[str, float]:
    """Return {genre: weight} biases, or {} on any failure. Cached."""
    key = _key(liked_titles, mood, time_available, media_type, era)
    now = time.time()
    hit = _cache.get(key)
    if hit and hit[1] > now:
        return hit[0]

    loves = ", ".join(liked_titles[:8]) if liked_titles else "a wide range of acclaimed titles"
    mood_txt = _MOOD_LABEL.get(mood or "", "open to anything")
    prompt = (
        f"They love: {loves}.\n"
        f"Right now they are {mood_txt}.\n"
        f'Reply ONLY with JSON: {{"genres": ["<genre>", "<genre>"]}} — 2 to 4 genres.'
    )
    try:
        raw = await provider.generate(system=_SYSTEM, user=prompt, temperature=0.3, max_tokens=60)
    except Exception:
        raw = None
    boosts = _parse(raw or "")

    # Cache even an empty result (a miss is still a decision) with light eviction.
    if len(_cache) >= _MAX:
        for k, (_, exp) in list(_cache.items()):
            if exp <= now:
                _cache.pop(k, None)
        if len(_cache) >= _MAX:
            _cache.pop(next(iter(_cache)), None)
    _cache[key] = (boosts, now + _TTL)
    return boosts


def clear_cache() -> None:
    _cache.clear()
