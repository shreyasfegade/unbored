"""Media detail endpoints — movie, TV, and anime lookups."""

import logging

from fastapi import APIRouter, Path, Query, Request, Response

from app.exceptions import AppError
from app.models.media import MediaItem, MediaItemList

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_BATCH = 100


@router.get("/media/batch", response_model=MediaItemList)
async def get_catalog_items(
    request: Request,
    response: Response,
    ids: str = Query(..., description="Comma-separated composite ids"),
):
    """Resolve many catalog items in one request, preserving the given order and
    silently skipping unknown ids. Replaces N per-item round trips (the enrich
    page used to fire one request per saved favourite on mount)."""
    catalog_map = request.app.state.catalog_map
    wanted = [i for i in (ids or "").split(",") if i][:_MAX_BATCH]
    items = [catalog_map[i] for i in wanted if i in catalog_map]
    response.headers["Cache-Control"] = "public, max-age=86400"
    return MediaItemList(items=items)


@router.get("/media/item/{composite_id}", response_model=MediaItem)
async def get_catalog_item(request: Request, response: Response, composite_id: str):
    """Look up one catalog item by its composite id (e.g. tmdb_550, al_21).

    Powers shareable /pick/:id links: anyone can render a pick without any local
    state. Served from the in-memory catalog, cacheable hard.
    """
    item = request.app.state.catalog_map.get(composite_id)
    if item is None:
        raise AppError(
            status_code=404,
            detail=f"No catalog item with id '{composite_id}'.",
            error_code="MEDIA_NOT_FOUND",
        )
    response.headers["Cache-Control"] = "public, max-age=86400, immutable"
    return item


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
