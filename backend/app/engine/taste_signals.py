"""Derive standing taste dimensions from a set of liked items — on the fly.

These used to be precomputed and persisted on a server-side taste vector. In the
stateless design the engine is a pure function of the request, so we compute the
few dimensions the ranker actually consumes (darkness / humor / emotional
intensity) directly from the favourite items each request. It's cheap and the
catalog is already in memory.
"""

from __future__ import annotations

from app.models.media import MediaItem

_INTENSE_GENRES = {"drama", "war", "history"}
_DARK_GENRES = {"thriller", "horror", "crime", "mystery"}


def taste_dims_from_items(items: list[MediaItem]) -> dict[str, float]:
    """Return {darkness_preference, humor_affinity, emotional_intensity} in [0,1].

    Neutral 0.5 for each when there's nothing to derive from.
    """
    if not items:
        return {
            "darkness_preference": 0.5,
            "humor_affinity": 0.5,
            "emotional_intensity": 0.5,
        }

    total = len(items)
    all_genres = [g.lower().strip() for item in items for g in item.genres]
    max_genres_per_pick = max((len(i.genres) for i in items), default=1) or 1
    denom = total * max_genres_per_pick

    intense = sum(1 for g in all_genres if g in _INTENSE_GENRES)
    dark = sum(1 for g in all_genres if g in _DARK_GENRES)
    comedy = sum(1 for g in all_genres if g == "comedy")

    return {
        "darkness_preference": round(min(dark / denom, 1.0), 3),
        "humor_affinity": round(min(comedy / total, 1.0), 3),
        "emotional_intensity": round(min(intense / denom, 1.0), 3),
    }
