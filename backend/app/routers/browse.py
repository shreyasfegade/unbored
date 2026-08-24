"""Browse endpoints — a Netflix-style, shelf-organised view of the catalog.

Every endpoint is a pure function of the frozen catalog: `/shelves` lists the
rows, `/shelf/{key}` serves one row paginated for infinite horizontal scrolling,
and `/deck` deals a diverse swipe deck. No live TMDB/AniList calls, so browsing
is instant and cache-friendly. The shelves themselves are assembled in
`app.services.shelves`; this module is only the HTTP layer over them.
"""

from __future__ import annotations

import random

from fastapi import APIRouter, HTTPException, Query, Response

from app.models.media import (
    BrowseDeck,
    BrowseShelf,
    BrowseShelfList,
    BrowseShelfPage,
    MediaItem,
    MediaType,
)
from app.services.shelves import build_shelves

router = APIRouter()

# The catalog changes with each deploy, so these must not be cached as
# "immutable" — clients kept serving a stale set of rows for a day after a
# rebuild. Short freshness plus a long stale-while-revalidate keeps it fast
# while still self-healing within minutes.
_CATALOG_CACHE = "public, max-age=300, stale-while-revalidate=604800"

MAX_LIMIT = 40
DEFAULT_LIMIT = 24

_TYPE_MAP = {"movie": MediaType.MOVIE, "tv": MediaType.TV, "anime": MediaType.ANIME}


def _shelf_by_key(key: str) -> dict | None:
    return next((s for s in build_shelves() if s["key"] == key), None)


@router.get("/browse/shelves", response_model=BrowseShelfList)
async def get_shelves(response: Response, media_type: str | None = Query(None)):
    """The ordered list of browsable rows. With `media_type`, counts reflect the
    filter and rows that would be empty are dropped."""
    response.headers["Cache-Control"] = _CATALOG_CACHE
    want = _TYPE_MAP.get((media_type or "").lower())
    shelves: list[BrowseShelf] = []
    for s in build_shelves():
        items = s["items"]
        if want:
            items = [m for m in items if m.media_type == want]
        if items:
            shelves.append(BrowseShelf(key=s["key"], title=s["title"], count=len(items)))
    return BrowseShelfList(shelves=shelves)


@router.get("/browse/deck", response_model=BrowseDeck)
async def get_deck(
    response: Response,
    limit: int = Query(30, ge=1, le=60),
    exclude: str | None = Query(None, description="Comma-separated ids to leave out"),
    media_type: str | None = Query(None),
    seed: int | None = Query(None, description="Set for a reproducible deck"),
):
    """A diverse deck for swipe-to-build-taste.

    Round-robins across the genre pools so consecutive cards feel different,
    weights toward popular titles (people recognise them, so they can judge
    fast), and never repeats a title within the deck.
    """
    # Not cacheable like the shelves: the deck is shuffled and exclusion-aware.
    response.headers["Cache-Control"] = "no-store"
    excluded = {e for e in (exclude or "").split(",") if e}
    want = _TYPE_MAP.get((media_type or "").lower())
    rng = random.Random(seed)

    pools: list[list[MediaItem]] = []
    for shelf in build_shelves():
        if not shelf["key"].startswith("genre:"):
            continue
        pool = [
            m for m in shelf["items"][:80]
            if m.id not in excluded and (not want or m.media_type == want)
        ]
        if pool:
            rng.shuffle(pool)
            pools.append(pool)

    if not pools:  # no genre pool survived the filter — fall back to trending
        base = [
            m for m in (_shelf_by_key("trending") or {"items": []})["items"]
            if m.id not in excluded and (not want or m.media_type == want)
        ]
        rng.shuffle(base)
        return BrowseDeck(items=base[:limit])

    rng.shuffle(pools)
    picked: list[MediaItem] = []
    seen: set[str] = set()
    cursors = [0] * len(pools)
    while len(picked) < limit and any(cursors[i] < len(pools[i]) for i in range(len(pools))):
        for i, pool in enumerate(pools):
            if len(picked) >= limit:
                break
            while cursors[i] < len(pool):
                item = pool[cursors[i]]
                cursors[i] += 1
                if item.id not in seen:
                    seen.add(item.id)
                    picked.append(item)
                    break

    return BrowseDeck(items=picked[:limit])


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
