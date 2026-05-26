"""Taste endpoints: create, retrieve, and update user taste vectors."""

import json
import uuid
import logging

from fastapi import APIRouter, Request, UploadFile

from app.exceptions import AppError
from app.models.media import YouTubeImportResult
from app.models.taste import CreateTasteRequest, UpdateTasteRequest, UserTasteVector
from app.storage.file_store import file_store
from app.services.taste_builder import TasteBuilder, merge_youtube_signals
from app.services.youtube_service import extract_taste_signals, parse_html_history, parse_json_history

logger = logging.getLogger(__name__)

router = APIRouter()


def _validate_uuid(vector_id: str) -> None:
    """Validate UUID v4 format. Raise AppError 404 if malformed."""
    try:
        uuid.UUID(vector_id, version=4)
    except (ValueError, AttributeError):
        raise AppError(
            status_code=404,
            detail=f"Taste vector with ID '{vector_id}' not found.",
            error_code="TASTE_VECTOR_NOT_FOUND",
        )


def _get_taste_builder(request: Request) -> TasteBuilder:
    return TasteBuilder(
        request.app.state.tmdb,
        request.app.state.anilist,
        request.app.state.pool,
    )


@router.post("/taste", status_code=201, response_model=UserTasteVector)
async def create_taste(request: Request, body: CreateTasteRequest):
    """Create a new taste vector from exactly 5 favourite media IDs."""
    builder = _get_taste_builder(request)
    vector = await builder.build_from_favourites(body.favourite_ids)
    return vector


@router.get("/taste/{vector_id}", response_model=UserTasteVector)
async def get_taste(request: Request, vector_id: str):
    """Retrieve an existing taste vector by UUID."""
    _validate_uuid(vector_id)
    vector = file_store.get_vector(vector_id)
    if vector is None:
        raise AppError(
            status_code=404,
            detail=f"Taste vector with ID '{vector_id}' not found.",
            error_code="TASTE_VECTOR_NOT_FOUND",
        )
    return vector


@router.put("/taste/{vector_id}", response_model=UserTasteVector)
async def update_taste(request: Request, vector_id: str, body: UpdateTasteRequest):
    """Update an existing taste vector with enrichment data."""
    _validate_uuid(vector_id)
    vector = file_store.get_vector(vector_id)
    if vector is None:
        raise AppError(
            status_code=404,
            detail=f"Taste vector with ID '{vector_id}' not found.",
            error_code="TASTE_VECTOR_NOT_FOUND",
        )

    # Empty update check: at least one field must be non-null
    null_fields = {
        "add_favourites", "add_watched_ids", "genre_overrides",
        "keyword_overrides", "pacing_preference", "emotional_intensity",
        "darkness_preference", "humor_affinity", "animation_affinity",
        "runtime_preference", "enrichment_source",
    }
    has_non_null = False
    for field_name in null_fields:
        if getattr(body, field_name, None) is not None:
            has_non_null = True
            break

    if not has_non_null:
        raise AppError(
            status_code=422,
            detail="At least one field must be provided for update.",
            error_code="VALIDATION_ERROR",
        )

    builder = _get_taste_builder(request)
    updated = await builder.update_with_enrichment(vector, body)
    return updated


@router.post("/taste/{vector_id}/youtube", response_model=YouTubeImportResult)
async def import_youtube(
    request: Request,
    vector_id: str,
    file: UploadFile,
):
    _validate_uuid(vector_id)
    vector = file_store.get_vector(vector_id)
    if vector is None:
        raise AppError(
            status_code=404,
            detail=f"Taste vector with ID '{vector_id}' not found.",
            error_code="TASTE_VECTOR_NOT_FOUND",
        )

    # 50 MB max
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise AppError(
            status_code=413,
            detail="File size exceeds 50 MB limit.",
            error_code="FILE_TOO_LARGE",
        )

    text = content.decode("utf-8", errors="replace")

    # Detect JSON vs HTML
    stripped = text.strip()
    if stripped.startswith("{") or stripped.startswith("["):
        entries = parse_json_history(stripped)
    else:
        entries = parse_html_history(stripped)

    signals = extract_taste_signals(entries)
    merge_youtube_signals(vector, signals)
    file_store.save_vector(vector)

    return YouTubeImportResult(
        total_videos_parsed=signals.total_videos_parsed,
        videos_with_signals=signals.videos_with_signals,
        top_channels=signals.top_channels,
        genres_extracted=signals.genres_extracted,
        keywords_extracted=signals.keywords_extracted,
        animation_affinity_delta=signals.animation_affinity_delta,
        success=True,
    )
