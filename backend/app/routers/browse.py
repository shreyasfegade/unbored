"""Browse endpoints — a Netflix-style, shelf-organised view of the catalog.

Both endpoints are pure functions of the frozen catalog: `/shelves` lists the
rows (genres, media types, decades, curated collections) and `/shelf/{key}`
serves one row, paginated for infinite horizontal scrolling. No live TMDB/AniList
calls, so browsing is instant and cache-friendly.
"""

from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query, Response

from app.models.media import (
    BrowseShelf,
    BrowseShelfList,
    BrowseShelfPage,
    MediaItem,
    MediaType,
)
from app.services.catalog import load_catalog

router = APIRouter()

# Same immutable cache as search: a catalog rebuild ships a new deploy anyway.
_CATALOG_CACHE = "public, max-age=86400, immutable"

MAX_LIMIT = 40
DEFAULT_LIMIT = 24
_GENRE_MIN = 12  # a genre needs this many titles to earn its own row
_DECADE_MIN = 8

_TYPE_MAP = {"movie": MediaType.MOVIE, "tv": MediaType.TV, "anime": MediaType.ANIME}
_TYPE_TITLE = {MediaType.MOVIE: "Movies", MediaType.TV: "TV Shows", MediaType.ANIME: "Anime"}

# Human titles for genre slugs that don't title-case cleanly.
_GENRE_TITLE = {
    "sci-fi": "Sci-Fi",
    "tv movie": "TV Movies",
}


def _genre_title(slug: str) -> str:
    return _GENRE_TITLE.get(slug, slug.title())


def _decade_of(year: int | None) -> int | None:
    if not year:
        return None
    return (year // 10) * 10


@lru_cache(maxsize=1)
def _shelves() -> list[dict]:
    """Build the ordered shelf catalog once. Each entry carries the members
    already sorted for display so `/shelf/{key}` is a slice."""
    catalog = [m for m in load_catalog() if m.poster_path]
    by_pop = sorted(catalog, key=lambda m: m.popularity, reverse=True)

    shelves: list[dict] = []

    def add(key: str, title: str, items: list[MediaItem]) -> None:
        if items:
            shelves.append({"key": key, "title": title, "items": items})

    # Curated collections.
    add("trending", "Trending Now", by_pop[:120])
    top_rated = sorted(
        (m for m in catalog if m.vote_count >= 200),
        key=lambda m: (m.vote_average, m.vote_count),
        reverse=True,
    )
    add("top_rated", "Critically Acclaimed", top_rated[:120])
    add("new_releases", "New & Recent", [m for m in by_pop if (m.release_year or 0) >= 2023][:120])

    # Media types.
    for mt in (MediaType.MOVIE, MediaType.TV, MediaType.ANIME):
        add(mt.value, _TYPE_TITLE[mt], [m for m in by_pop if m.media_type == mt])

    # Decades (newest first).
    decades: dict[int, list[MediaItem]] = {}
    for m in by_pop:
        d = _decade_of(m.release_year)
        if d and d >= 1980:
            decades.setdefault(d, []).append(m)
    for d in sorted(decades, reverse=True):
        if len(decades[d]) >= _DECADE_MIN:
            add(f"decade:{d}s", f"{d}s", decades[d])

    # Genres, largest first.
    genres: dict[str, list[MediaItem]] = {}
    for m in by_pop:
        for g in m.genres:
            genres.setdefault(g, []).append(m)
    for g in sorted(genres, key=lambda k: len(genres[k]), reverse=True):
        if len(genres[g]) >= _GENRE_MIN:
            add(f"genre:{g}", _genre_title(g), genres[g])

    return shelves


def _shelf_by_key(key: str) -> dict | None:
    return next((s for s in _shelves() if s["key"] == key), None)


@router.get("/browse/shelves", response_model=BrowseShelfList)
async def get_shelves(response: Response, media_type: str | None = Query(None)):
    """The ordered list of browsable rows. With `media_type`, counts reflect the
    filter and rows that would be empty are dropped."""
    response.headers["Cache-Control"] = _CATALOG_CACHE
    want = _TYPE_MAP.get((media_type or "").lower())
    shelves: list[BrowseShelf] = []
    for s in _shelves():
        items = s["items"]
        if want:
            items = [m for m in items if m.media_type == want]
        if items:
            shelves.append(BrowseShelf(key=s["key"], title=s["title"], count=len(items)))
    return BrowseShelfList(shelves=shelves)


@router.get("/browse/shelf/{key}", response_model=BrowseShelfPage)
async def get_shelf(
    key: str,
    response: Response,
    offset: int = Query(0, ge=0),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    media_type: str | None = Query(None),
):
    """One row, paginated. `next_offset` is null when the row is exhausted."""
    response.headers["Cache-Control"] = _CATALOG_CACHE
    shelf = _shelf_by_key(key)
    if shelf is None:
        raise HTTPException(status_code=404, detail=f"Unknown shelf: {key}")

    items = shelf["items"]
    want = _TYPE_MAP.get((media_type or "").lower())
    if want:
        items = [m for m in items if m.media_type == want]

    total = len(items)
    page = items[offset : offset + limit]
    next_offset = offset + limit if offset + limit < total else None
    return BrowseShelfPage(
        key=key, title=shelf["title"], items=page, total=total, next_offset=next_offset
    )
