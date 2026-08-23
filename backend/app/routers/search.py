"""Search and onboarding-shortlist endpoints, served from the local catalog.

No live TMDB/AniList calls: both endpoints filter the pre-built catalog, so
taste selection is instant and works offline. Users can search across movies,
TV, and anime (optionally filtered to one type).
"""

from __future__ import annotations

import difflib
import logging
import re
import unicodedata

from fastapi import APIRouter, Query, Request, Response

from app.models.media import MediaItem, MediaType, SearchResponse
from app.services.catalog import load_catalog

logger = logging.getLogger(__name__)

router = APIRouter()

MIN_QUERY_LEN = 1
MAX_QUERY_LEN = 100
MAX_RESULTS = 20
SHORTLIST_SIZE = 36

# Both endpoints are pure functions of the frozen catalog, so they're safe to
# cache hard at the CDN/browser (a catalog rebuild ships a new deploy anyway).
_CATALOG_CACHE = "public, max-age=86400, immutable"

_TYPE_MAP = {"movie": MediaType.MOVIE, "tv": MediaType.TV, "anime": MediaType.ANIME}


def _norm(s: str) -> str:
    """Fold to a searchable form: strip diacritics (é→e), drop punctuation
    (WALL·E→wall e, Léon→leon), lowercase, collapse whitespace."""
    if not s:
        return ""
    decomposed = unicodedata.normalize("NFKD", s)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", stripped.lower()).strip()


def _match_rank(item: MediaItem, needle: str, tokens: list[str]) -> int:
    """Lower is better: 0 prefix, 1 word-start, 2 substring, 3 all-tokens (any
    order), 4 keyword/genre, 5 fuzzy near-match, 9 none.

    Matches both the display title and the original (non-English) title, so a
    show is findable by its real name, and tolerates typos + diacritics."""
    titles = [_norm(item.title), _norm(item.original_title)]
    for title in titles:
        if not title:
            continue
        if title.startswith(needle):
            return 0
        if any(w.startswith(needle) for w in title.split()):
            return 1
        if needle in title:
            return 2
        if tokens and all(any(w.startswith(t) for w in title.split()) for t in tokens):
            return 3  # all query words present, any order ("dark knight the")
    if any(needle in _norm(kw) for kw in item.keywords) or any(needle in _norm(g) for g in item.genres):
        return 4
    # Typo tolerance: one transposed/dropped letter still finds the title.
    for title in titles:
        if title and difflib.SequenceMatcher(None, needle, title).ratio() >= 0.82:
            return 5
        if title and any(difflib.SequenceMatcher(None, needle, w).ratio() >= 0.82 for w in title.split()):
            return 5
    return 9


@router.get("/search/multi", response_model=SearchResponse)
async def search_multi(
    request: Request,
    response: Response,
    q: str = Query(..., min_length=MIN_QUERY_LEN, max_length=MAX_QUERY_LEN),
    type: str | None = Query(None),
):
    response.headers["Cache-Control"] = _CATALOG_CACHE
    needle = _norm(q)
    tokens = needle.split()
    catalog = load_catalog()
    want = _TYPE_MAP.get((type or "").lower())

    scored: list[tuple[int, float, MediaItem]] = []
    for m in catalog:
        if want and m.media_type != want:
            continue
        rank = _match_rank(m, needle, tokens)
        if rank < 9:
            scored.append((rank, -m.popularity, m))

    scored.sort(key=lambda t: (t[0], t[1]))
    results = [m for _, _, m in scored[:MAX_RESULTS]]
    return SearchResponse(results=results, total_results=len(scored), query=q)


@router.get("/search/curated-shortlist")
async def get_curated_shortlist(request: Request, response: Response):
    """A diverse, high-quality starter set spanning movies, TV, and anime."""
    response.headers["Cache-Control"] = _CATALOG_CACHE
    catalog = load_catalog()
    by_type: dict[MediaType, list[MediaItem]] = {MediaType.MOVIE: [], MediaType.TV: [], MediaType.ANIME: []}
    for m in sorted(catalog, key=lambda c: c.popularity, reverse=True):
        if m.poster_path and m.media_type in by_type:
            by_type[m.media_type].append(m)

    # Interleave so the grid feels varied (roughly half movies, then TV + anime).
    quotas = {MediaType.MOVIE: 16, MediaType.TV: 10, MediaType.ANIME: 10}
    seen: set[str] = set()
    interleaved: list[MediaItem] = []
    cursors = {t: 0 for t in by_type}
    order = [MediaType.MOVIE, MediaType.MOVIE, MediaType.TV, MediaType.ANIME]
    pool = {t: [m for m in by_type[t][:quotas[t]]] for t in by_type}
    while len(interleaved) < SHORTLIST_SIZE and any(cursors[t] < len(pool[t]) for t in pool):
        for t in order:
            if cursors[t] < len(pool[t]):
                item = pool[t][cursors[t]]
                cursors[t] += 1
                if item.id not in seen:
                    seen.add(item.id)
                    interleaved.append(item)

    return {"items": interleaved[:SHORTLIST_SIZE]}
