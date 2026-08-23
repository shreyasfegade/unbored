"""LLM curator: the AI layer on top of the deterministic engine.

The engine produces a strong, ranked shortlist. When the user has connected an
LLM (their own Gemini/DeepSeek key), the curator makes one compact, token-frugal
call to choose the single best pick + two backups and write a short, personal
reason for each. If the call fails or no key is connected, the caller simply
keeps the engine's own ordering.

Responses are cached by (shortlist, mood, slot, type): re-rolling the same
context returns instantly and costs no tokens.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass

from app.llm.base import LLMProvider
from app.models.media import MediaItem

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a sharp film, TV and anime taste expert. From a shortlist, you pick the ONE "
    "best thing for this person to watch right now plus two backups, and explain each in one "
    "short, specific sentence tied to what they love. Reply with JSON only."
)

_MOOD_LABEL = {
    "happy_energetic": "happy and energetic",
    "tired_low": "tired and low-energy",
    "anxious": "anxious and wanting comfort",
    "want_to_cry": "wanting something moving",
    "mindblown_curious": "curious, wanting to be amazed",
    "want_to_laugh": "wanting to laugh",
    "thrilled": "wanting a thrill",
}
_TIME_LABEL = {"short": "about 30 minutes", "medium": "about an hour", "long": "a couple of hours"}
_TYPE_LABEL = {"movie": "a movie", "tv": "a TV show", "anime": "anime", "surprise": "anything"}

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


@dataclass
class CuratorResult:
    primary_index: int
    alternate_indices: list[int]
    why: str
    # Rationale per shortlist index, so a hand-swapped alternate has an honest
    # line to show instead of the primary's.
    why_by_index: dict[int, str]


def build_user_prompt(
    liked_titles: list[str],
    mood: str | None,
    time_available: str,
    media_type: str | None,
    shortlist: list[MediaItem],
) -> str:
    loves = ", ".join(liked_titles[:8]) if liked_titles else "a range of acclaimed films and shows"
    mood_txt = _MOOD_LABEL.get(mood or "", "open to anything")
    want = _TYPE_LABEL.get(media_type or "", "anything")
    lines = []
    for i, m in enumerate(shortlist, start=1):
        year = m.release_year or m.year or ""
        genres = ", ".join(m.genres[:3]) if m.genres else m.media_type.value
        # Richer than before: runtime + rating + series length let the model
        # reason about the tradeoffs the engine already quantified.
        rt = f"{m.runtime_minutes}min" if m.runtime_minutes else "?"
        rating = f"{m.vote_average:.1f}" if m.vote_average else "?"
        eps = f", {m.episode_count} eps" if m.episode_count and m.episode_count > 1 else ""
        lines.append(f"{i}. {m.title} ({year}) — {genres} — {rt}{eps}, rated {rating}")
    options = "\n".join(lines)
    return (
        f"I love: {loves}.\n"
        f"Right now I'm {mood_txt}, I have {_TIME_LABEL.get(time_available, 'some time')}, "
        f"and I want to watch {want}.\n\n"
        f"Shortlist:\n{options}\n\n"
        f'Reply ONLY with JSON: {{"pick": <number>, "alt": [<number>, <number>], '
        f'"why": "<max 16 words on the pick>", '
        f'"alt_why": ["<max 12 words>", "<max 12 words>"]}}'
    )


def _clip(text: object, limit: int) -> str:
    s = str(text or "").strip().strip('"').strip()
    if len(s) > limit:
        s = s[: limit - 3].rstrip() + "..."
    return s


def _parse(raw: str, n: int) -> CuratorResult | None:
    match = _JSON_RE.search(raw or "")
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except (json.JSONDecodeError, ValueError):
        return None

    pick = data.get("pick")
    if not isinstance(pick, int) or not (1 <= pick <= n):
        return None

    alts: list[int] = []
    for a in data.get("alt", []) or []:
        if isinstance(a, int) and 1 <= a <= n and a != pick and a not in alts:
            alts.append(a)
    alts = alts[:2]

    why = _clip(data.get("why", ""), 160)
    why_by_index = {pick - 1: why}
    alt_why = data.get("alt_why") or []
    if isinstance(alt_why, list):
        for idx, text in zip(alts, alt_why):
            line = _clip(text, 120)
            if line:
                why_by_index[idx - 1] = line

    return CuratorResult(
        primary_index=pick - 1,
        alternate_indices=[a - 1 for a in alts],
        why=why,
        why_by_index=why_by_index,
    )


# ── Response cache ────────────────────────────────────────────────
# (result, expires_at) keyed by a hash of the deciding inputs.
_cache: dict[str, tuple[CuratorResult, float]] = {}
_TTL = 1800.0
_MAX = 512


def _cache_key(
    provider_name: object, mood: str | None, time_available: str,
    media_type: str | None, shortlist: list[MediaItem],
) -> str:
    raw = "|".join([
        str(provider_name), mood or "", time_available, media_type or "",
        ",".join(m.id for m in shortlist),
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def clear_cache() -> None:
    _cache.clear()


async def curate(
    provider: LLMProvider,
    *,
    liked_titles: list[str],
    mood: str | None,
    time_available: str,
    media_type: str | None,
    shortlist: list[MediaItem],
) -> CuratorResult | None:
    """Run one compact LLM call. Returns None on any failure (caller falls back)."""
    if not shortlist:
        return None

    key = _cache_key(provider.name, mood, time_available, media_type, shortlist)
    now = time.time()
    hit = _cache.get(key)
    if hit and hit[1] > now:
        return hit[0]

    prompt = build_user_prompt(liked_titles, mood, time_available, media_type, shortlist)
    raw = await provider.generate(
        system=SYSTEM_PROMPT, user=prompt, temperature=0.4, max_tokens=200
    )
    if not raw:
        return None
    result = _parse(raw, len(shortlist))
    if result is None:
        return None

    if len(_cache) >= _MAX:
        for k, (_, exp) in list(_cache.items()):
            if exp <= now:
                _cache.pop(k, None)
        if len(_cache) >= _MAX:
            _cache.pop(next(iter(_cache)), None)
    _cache[key] = (result, now + _TTL)
    return result
