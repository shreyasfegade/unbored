"""Templated 'why this, for you' line for the engine-only path (no LLM).

Honest and taste-aware: it leans on the actual signals the engine used (shared
genre with the user's favourites, the chosen mood, runtime fit) rather than
pretending to be the LLM. When a user connects a key, the LLM curator's line
replaces this.
"""

from __future__ import annotations

from app.models.recommendation import ScoredMediaItem

_MOOD_TAIL = {
    "happy_energetic": "and it matches the upbeat mood you're in",
    "tired_low": "and it's an easy one to sink into right now",
    "anxious": "and it's gentle enough for where your head's at",
    "want_to_cry": "and it carries the emotional weight you're after",
    "mindblown_curious": "and it'll give you plenty to chew on",
    "want_to_laugh": "and it brings the laughs you came for",
    "thrilled": "and it delivers the charge you're chasing",
}


def engine_rationale(primary: ScoredMediaItem, mood: str | None, liked_genres: set[str]) -> str:
    media = primary.media
    genre = (media.genres[0] if media.genres else media.media_type.value).lower()
    shares = bool({g.lower() for g in media.genres} & {g.lower() for g in liked_genres})
    rel = primary.score_breakdown.relevance

    if shares and rel >= 0.25:
        head = f"Right in your wheelhouse — it shares the {genre} streak in what you love"
    elif rel >= 0.25:
        head = f"A close match to your taste, with a strong {genre} core"
    else:
        head = f"A well-reviewed {genre} pick to broaden the night"

    tail = _MOOD_TAIL.get(mood or "", "and it fits the time you have")
    return f"{head}, {tail}."
