"""LLM curator: the AI layer on top of the deterministic engine.

The engine produces a strong, ranked shortlist. When the user has connected an
LLM (their own Gemini/DeepSeek key), the curator makes one compact, token-frugal
call to choose the single best pick + two backups and write a short, personal
reason grounded in the titles the user said they love. If the call fails or no
key is connected, the caller simply keeps the engine's own ordering.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from app.llm.base import LLMProvider
from app.models.media import MediaItem

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a sharp film, TV and anime taste expert. From a shortlist, you pick the ONE "
    "best thing for this person to watch right now plus two backups, and explain the top "
    "pick in one short, specific sentence tied to what they love. Reply with JSON only."
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
_TYPE_LABEL = {"movie": "a movie", "tv": "a TV show", "anime": "anime"}

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


@dataclass
class CuratorResult:
    primary_index: int
    alternate_indices: list[int]
    why: str


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
        lines.append(f"{i}. {m.title} ({year}) — {genres}")
    options = "\n".join(lines)
    return (
        f"I love: {loves}.\n"
        f"Right now I'm {mood_txt}, I have {_TIME_LABEL.get(time_available, 'some time')}, "
        f"and I want to watch {want}.\n\n"
        f"Shortlist:\n{options}\n\n"
        f'Reply ONLY with JSON: {{"pick": <number>, "alt": [<number>, <number>], '
        f'"why": "<max 16 words, why the pick fits my taste>"}}'
    )


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

    why = str(data.get("why", "")).strip().strip('"').strip()
    if len(why) > 160:
        why = why[:157].rstrip() + "..."

    return CuratorResult(primary_index=pick - 1, alternate_indices=[a - 1 for a in alts[:2]], why=why)


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
    prompt = build_user_prompt(liked_titles, mood, time_available, media_type, shortlist)
    raw = await provider.generate(
        system=SYSTEM_PROMPT, user=prompt, temperature=0.4, max_tokens=90
    )
    if not raw:
        return None
    return _parse(raw, len(shortlist))
