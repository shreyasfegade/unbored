"""Media detail endpoints — movie, TV, and anime lookups."""

import logging

from fastapi import APIRouter, Path, Request

from app.exceptions import AppError
from app.models.media import MediaItem

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/media/movie/{tmdb_id}", response_model=MediaItem)
async def get_movie(request: Request, tmdb_id: int = Path(..., gt=0)):
    tmdb = request.app.state.tmdb
    item = await tmdb.get_movie_detail(tmdb_id)
    if item is None:
        raise AppError(
            status_code=404,
            detail=f"Movie with TMDB ID {tmdb_id} not found.",
            error_code="MEDIA_NOT_FOUND",
        )
    return item


@router.get("/media/tv/{tmdb_id}", response_model=MediaItem)
async def get_tv(request: Request, tmdb_id: int = Path(..., gt=0)):
    tmdb = request.app.state.tmdb
    item = await tmdb.get_tv_detail(tmdb_id)
    if item is None:
        raise AppError(
            status_code=404,
            detail=f"TV show with TMDB ID {tmdb_id} not found.",
            error_code="MEDIA_NOT_FOUND",
        )
    return item


@router.get("/media/anime/{anilist_id}", response_model=MediaItem)
async def get_anime(request: Request, anilist_id: int = Path(..., gt=0)):
    anilist = request.app.state.anilist
    item = await anilist.get_detail(anilist_id)
    if item is None:
        raise AppError(
            status_code=404,
            detail=f"Anime with AniList ID {anilist_id} not found.",
            error_code="MEDIA_NOT_FOUND",
        )
    return item
