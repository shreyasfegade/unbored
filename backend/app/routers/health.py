from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/health")
async def health_check(request: Request):
    tmdb = request.app.state.tmdb
    pool = request.app.state.pool
    return {
        "status": "ok",
        "version": "1.0.0",
        "candidate_pool_size": len(pool.candidates),
        "tmdb_genres_loaded": len(tmdb._movie_genre_map) > 0,
    }
