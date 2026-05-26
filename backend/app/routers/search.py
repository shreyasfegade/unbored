"""Multi-source search endpoint — TMDB + AniList with interleaving."""

import asyncio
import logging

from fastapi import APIRouter, Query, Request

from app.exceptions import AppError
from app.models.media import SearchResponse

logger = logging.getLogger(__name__)

router = APIRouter()

MIN_QUERY_LEN = 2
MAX_QUERY_LEN = 100
MIN_PAGE = 1
MAX_PAGE = 5
MAX_RESULTS = 20

MOVIE_IDS = [27205, 157336, 155, 496243, 680, 550, 278, 603, 120, 244786]
TV_IDS = [1396, 66732, 1399, 93405, 100088, 94997]
ANIME_IDS = [16498, 1535, 21519, 101922, 113415, 21087]

TRENDING_FALLBACK_MOVIES = [299536, 569094, 76600, 438631]
TRENDING_FALLBACK_TV = [71912, 84958, 114410, 60625]


def _title_match_key(item) -> str:
    return item.title.lower().strip()


@router.get("/search/multi", response_model=SearchResponse)
async def search_multi(
    request: Request,
    q: str = Query(..., min_length=MIN_QUERY_LEN, max_length=MAX_QUERY_LEN),
    page: int = Query(1, ge=MIN_PAGE, le=MAX_PAGE),
):
    tmdb = request.app.state.tmdb
    anilist = request.app.state.anilist

    tmdb_task = asyncio.create_task(tmdb.search_multi(q, page=page))
    anilist_task = asyncio.create_task(anilist.search(q, page=page, per_page=10))

    tmdb_results = None
    anilist_results = None
    tmdb_error = None
    anilist_error = None

    try:
        tmdb_results = await tmdb_task
    except Exception as e:
        logger.warning("TMDB search failed for '%s': %s", q, e)
        tmdb_error = e

    try:
        anilist_results = await anilist_task
    except Exception as e:
        logger.warning("AniList search failed for '%s': %s", q, e)
        anilist_error = e

    if tmdb_results is None and anilist_results is None:
        raise AppError(
            status_code=502,
            detail="Both TMDB and AniList search APIs are currently unavailable.",
            error_code="SEARCH_BACKEND_UNAVAILABLE",
        )

    tmdb_results = tmdb_results or []
    anilist_results = anilist_results or []

    # Deduplicate AniList titles against TMDB
    tmdb_titles = {_title_match_key(m) for m in tmdb_results}
    anilist_deduped = [m for m in anilist_results if _title_match_key(m) not in tmdb_titles]

    # Interleave: 2 TMDB, 1 AniList, repeat
    interleaved = []
    tmdb_idx = 0
    al_idx = 0

    while len(interleaved) < MAX_RESULTS and (tmdb_idx < len(tmdb_results) or al_idx < len(anilist_deduped)):
        for _ in range(2):
            if tmdb_idx < len(tmdb_results) and len(interleaved) < MAX_RESULTS:
                interleaved.append(tmdb_results[tmdb_idx])
                tmdb_idx += 1

        if al_idx < len(anilist_deduped) and len(interleaved) < MAX_RESULTS:
            interleaved.append(anilist_deduped[al_idx])
            al_idx += 1

    total_results = len(tmdb_results) + len(anilist_results)

    return SearchResponse(
        results=interleaved[:MAX_RESULTS],
        total_results=total_results,
        query=q,
    )


@router.get("/search/curated-shortlist")
async def get_curated_shortlist(request: Request):
    tmdb = request.app.state.tmdb
    anilist = request.app.state.anilist

    items = []

    for mid in MOVIE_IDS:
        try:
            detail = await tmdb.get_movie_detail(mid)
            if detail:
                items.append(detail)
        except Exception:
            pass

    for tid in TV_IDS:
        try:
            detail = await tmdb.get_tv_detail(tid)
            if detail:
                items.append(detail)
        except Exception:
            pass

    for aid in ANIME_IDS:
        try:
            detail = await anilist.get_detail(aid)
            if detail:
                items.append(detail)
        except Exception:
            pass

    # Try to fill with trending
    try:
        from app.services.tmdb_service import TMDBService
        trending = await tmdb.get_trending_movies()
        existing = {i.id for i in items}
        for t in trending[:8]:
            if t.id not in existing and len(items) < 30:
                items.append(t)
    except Exception:
        pass

    # Try trending TV
    try:
        trending_tv = await tmdb.get_trending_tv()
        existing = {i.id for i in items}
        for t in trending_tv[:8]:
            if t.id not in existing and len(items) < 30:
                items.append(t)
    except Exception:
        pass

    # Fallback if not enough items
    if len(items) < 20:
        for mid in TRENDING_FALLBACK_MOVIES:
            try:
                detail = await tmdb.get_movie_detail(mid)
                if detail and len(items) < 30:
                    items.append(detail)
            except Exception:
                pass

    if len(items) < 25:
        for tid in TRENDING_FALLBACK_TV:
            try:
                detail = await tmdb.get_tv_detail(tid)
                if detail and len(items) < 30:
                    items.append(detail)
            except Exception:
                pass

    return {"items": items[:30]}
