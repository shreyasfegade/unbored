"""Browse endpoints — a Netflix-style, shelf-organised view of the catalog.

Both endpoints are pure functions of the frozen catalog: `/shelves` lists the
rows (genres, media types, curated collections) and `/shelf/{key}`
serves one row, paginated for infinite horizontal scrolling. No live TMDB/AniList
calls, so browsing is instant and cache-friendly.
"""

from __future__ import annotations

import random
from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query, Response

from app.models.media import (
    BrowseDeck,
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
_GENRE_MIN = 18  # a genre needs this many titles to earn its own row
_CURATED_SIZE = 60  # trending / acclaimed / new are finite, curated lists
_TYPE_CAP = 0.55  # no media type may exceed this share of a mixed row
_ACCLAIM_MIN_VOTES = 400
_ACCLAIM_PRIOR = 3000  # votes of "average" pulled toward the mean

_TYPE_MAP = {"movie": MediaType.MOVIE, "tv": MediaType.TV, "anime": MediaType.ANIME}
_TYPE_TITLE = {MediaType.MOVIE: "Movies", MediaType.TV: "TV Shows", MediaType.ANIME: "Anime"}

# Human titles for genre slugs that don't title-case cleanly.
_GENRE_TITLE = {
    "sci-fi": "Sci-Fi",
    "tv movie": "TV Movies",
}


def _genre_title(slug: str) -> str:
    return _GENRE_TITLE.get(slug, slug.title())


def _dedupe_franchise(items: list[MediaItem]) -> list[MediaItem]:
    """One entry per series in a row, so a franchise can't fill the screen."""
    seen: set[str] = set()
    out: list[MediaItem] = []
    for m in items:
        key = m.franchise or m.id
        if key in seen:
            continue
        seen.add(key)
        out.append(m)
    return out


def _balance_types(items: list[MediaItem], cap: float = _TYPE_CAP) -> list[MediaItem]:
    """Interleave media types so no single one owns a mixed row.

    Without this, anime takes every slot: its popularity numbers come from a
    different source on a different scale. Order is otherwise preserved.
    """
    buckets: dict[MediaType, list[MediaItem]] = {}
    for m in items:
        buckets.setdefault(m.media_type, []).append(m)
    if len(buckets) < 2:
        return items

    total = len(items)
    quota = {t: max(1, int(total * cap)) for t in buckets}
    cursors = {t: 0 for t in buckets}
    taken = {t: 0 for t in buckets}
    order = sorted(buckets, key=lambda t: -len(buckets[t]))

    out: list[MediaItem] = []
    while len(out) < total:
        progressed = False
        for t in order:
            pool = buckets[t]
            if cursors[t] >= len(pool) or taken[t] >= quota[t]:
                continue
            out.append(pool[cursors[t]])
            cursors[t] += 1
            taken[t] += 1
            progressed = True
        if not progressed:
            break
    return out


@lru_cache(maxsize=1)
def _shelves() -> list[dict]:
    """Build the ordered shelf catalog once. Each entry carries the members
    already sorted for display so `/shelf/{key}` is a slice.

    Two rules keep browsing from feeling repetitive: every title gets one
    *primary* genre row rather than appearing in all of them, and mixed rows are
    balanced across media types. Previously a title showed up in 5.3 rows on
    average (up to 10), which read as "the same stuff over and over".
    """
    catalog = [m for m in load_catalog() if m.poster_path]
    # popularity_norm is comparable across TMDB and AniList; raw popularity isn't.
    by_pop = sorted(catalog, key=lambda m: m.popularity_norm, reverse=True)

    shelves: list[dict] = []

    def add(key: str, title: str, items: list[MediaItem], balance: bool = True) -> None:
        items = _dedupe_franchise(items)
        if balance:
            items = _balance_types(items)
        if items:
            shelves.append({"key": key, "title": title, "items": items})

    # ── Curated rows. A title may appear in at most one of these. ──────
    used_in_curated: set[str] = set()

    def take(pool: list[MediaItem], limit: int) -> list[MediaItem]:
        picked = [m for m in pool if m.id not in used_in_curated][:limit]
        used_in_curated.update(m.id for m in picked)
        return picked

    # Weighted rating, not the raw average: a 9.5 from 210 votes is a curio,
    # a 8.6 from 25,000 is a classic. Pulls obscure outliers back down.
    rated = [m for m in catalog if m.vote_count >= _ACCLAIM_MIN_VOTES]
    mean = (sum(m.vote_average for m in rated) / len(rated)) if rated else 0.0

    def weighted(m: MediaItem) -> float:
        v = m.vote_count
        return (v / (v + _ACCLAIM_PRIOR)) * m.vote_average + (_ACCLAIM_PRIOR / (v + _ACCLAIM_PRIOR)) * mean

    # Rank acclaim *within each source* for the same reason as popularity:
    # AniList scores sit around 8.5+ while TMDB's span 6-8.7, so a straight
    # sort hands the whole row to anime.
    acclaim_pct: dict[str, float] = {}
    by_src: dict[str, list[MediaItem]] = {}
    for m in rated:
        by_src.setdefault(m.source.value, []).append(m)
    for group in by_src.values():
        group.sort(key=weighted)
        last = len(group) - 1 or 1
        for rank, m in enumerate(group):
            acclaim_pct[m.id] = rank / last

    # Claimed most-specific-first so the narrow rows get their defining titles:
    # trending is a huge pool and can afford to go last. Display order below is
    # independent of this.
    acclaimed = take(
        sorted(rated, key=lambda m: acclaim_pct.get(m.id, 0.0), reverse=True), _CURATED_SIZE
    )
    recent = take([m for m in by_pop if (m.release_year or 0) >= 2023], _CURATED_SIZE)
    trending = take(by_pop, _CURATED_SIZE)

    add("trending", "Trending Now", trending)
    add("top_rated", "Critically Acclaimed", acclaimed)
    add("new_releases", "New & Recent", recent)

    # ── One row per media type (these are meant to overlap the genre rows;
    #    they're how someone browses "just films"). ─────────────────────
    for mt in (MediaType.MOVIE, MediaType.TV, MediaType.ANIME):
        add(mt.value, _TYPE_TITLE[mt], [m for m in by_pop if m.media_type == mt], balance=False)

    # ── Genre rows: each title lands in exactly one, its rarest genre, so
    #    the same handful of blockbusters don't headline every row. ─────
    genre_size: dict[str, int] = {}
    for m in catalog:
        for g in m.genres:
            genre_size[g] = genre_size.get(g, 0) + 1

    primary: dict[str, list[MediaItem]] = {}
    for m in by_pop:
        usable = [g for g in m.genres if genre_size.get(g, 0) >= _GENRE_MIN]
        if not usable:
            continue
        # Rarest qualifying genre is the most descriptive one.
        best = min(usable, key=lambda g: genre_size[g])
        primary.setdefault(best, []).append(m)

    for g in sorted(primary, key=lambda k: len(primary[k]), reverse=True):
        if len(primary[g]) >= _GENRE_MIN:
            add(f"genre:{g}", _genre_title(g), primary[g])

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
    for shelf in _shelves():
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
