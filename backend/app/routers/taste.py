"""Taste profile — what the engine actually sees when it reads your favourites.

The API stays stateless: the profile is computed from the ids in the request and
nothing is stored. It exists so the recommendation stops being a black box —
the user can see the genres, era and tone their picks are being drawn from.
"""

from __future__ import annotations

from collections import Counter

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.engine.taste_signals import taste_dims_from_items
from app.models.media import MediaItem

router = APIRouter()

MAX_IDS = 200
_TOP_GENRES = 8
_TOP_PEOPLE = 5


class TasteProfileRequest(BaseModel):
    favourite_ids: list[str] = Field(default_factory=list, max_length=MAX_IDS)


class GenreWeight(BaseModel):
    name: str
    count: int
    share: float = Field(ge=0.0, le=1.0)


class DecadeCount(BaseModel):
    decade: str
    count: int


class TasteProfile(BaseModel):
    resolved: int = Field(default=0, ge=0, description="How many ids matched the catalog")
    requested: int = Field(default=0, ge=0)
    genres: list[GenreWeight] = Field(default_factory=list)
    decades: list[DecadeCount] = Field(default_factory=list)
    media_types: dict[str, int] = Field(default_factory=dict)
    mean_runtime: int | None = None
    mean_rating: float | None = None
    tone: dict[str, float] = Field(default_factory=dict)
    top_directors: list[str] = Field(default_factory=list)
    top_studios: list[str] = Field(default_factory=list)
    top_cast: list[str] = Field(default_factory=list)


def _top_names(values: list[str], n: int) -> list[str]:
    return [name for name, _ in Counter(v for v in values if v).most_common(n)]


@router.post("/taste/profile", response_model=TasteProfile)
async def taste_profile(body: TasteProfileRequest, request: Request):
    """Summarise a set of favourites. Unknown ids are ignored, not an error."""
    catalog_map: dict[str, MediaItem] = request.app.state.catalog_map
    items = [m for m in (catalog_map.get(i) for i in body.favourite_ids) if m is not None]

    if not items:
        return TasteProfile(resolved=0, requested=len(body.favourite_ids))

    genre_counts = Counter(g.lower().strip() for m in items for g in m.genres if g)
    total_genre = sum(genre_counts.values()) or 1
    genres = [
        GenreWeight(name=name, count=count, share=round(count / total_genre, 3))
        for name, count in genre_counts.most_common(_TOP_GENRES)
    ]

    decade_counts: Counter[int] = Counter()
    for m in items:
        year = m.release_year or m.year
        if year:
            decade_counts[(year // 10) * 10] += 1
    decades = [
        DecadeCount(decade=f"{d}s", count=c)
        for d, c in sorted(decade_counts.items(), reverse=True)
    ]

    runtimes = [m.runtime_minutes for m in items if m.runtime_minutes]
    ratings = [m.vote_average for m in items if m.vote_average]

    return TasteProfile(
        resolved=len(items),
        requested=len(body.favourite_ids),
        genres=genres,
        decades=decades,
        media_types=dict(Counter(m.media_type.value for m in items)),
        mean_runtime=round(sum(runtimes) / len(runtimes)) if runtimes else None,
        mean_rating=round(sum(ratings) / len(ratings), 1) if ratings else None,
        tone=taste_dims_from_items(items),
        top_directors=_top_names([m.director for m in items if m.director], _TOP_PEOPLE),
        top_studios=_top_names([m.studio for m in items if m.studio], _TOP_PEOPLE),
        top_cast=_top_names([c for m in items for c in m.cast], _TOP_PEOPLE),
    )
