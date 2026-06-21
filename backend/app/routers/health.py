"""Health and status endpoints.

`/health` is a lightweight liveness check. `/status` describes the running
configuration — catalog mode (live/demo) and the active LLM provider — and is
what the frontend uses to tailor its first-run guidance.
"""

from fastapi import APIRouter, Request

from app.config import settings

router = APIRouter()


@router.get("/health")
async def health_check(request: Request):
    pool = request.app.state.pool
    return {
        "status": "ok",
        "version": "2.0.0",
        "candidate_pool_size": len(pool.candidates),
    }


@router.get("/status")
async def status(request: Request):
    tmdb = request.app.state.tmdb
    pool = request.app.state.pool
    why_now = request.app.state.why_now
    return {
        "status": "ok",
        "version": "2.0.0",
        "catalog": {
            "mode": settings.catalog_mode,
            "size": len(pool.candidates),
            "tmdb_genres_loaded": len(tmdb._movie_genre_map) > 0,
        },
        "llm": why_now.status,
    }
