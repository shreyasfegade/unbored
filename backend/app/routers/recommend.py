"""Recommendation endpoints: generate primary + alternates with 'Why Now?' reasoning."""

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Request

from app.engine.scorer import WeightedScorer
from app.exceptions import AppError
from app.models.media import MediaItem, MediaSource, MediaType
from app.models.mood import ConfidenceLevel, MoodType, TimeSlot
from app.models.recommendation import (
    RecommendationRequest,
    RecommendationResponse,
    RegenerateRequest,
    ScoreBreakdown,
    ScoredMediaItem,
    WhyNowContext,
    WhyNowResult,
)
from app.models.taste import RecommendationHistoryEntry, UserTasteVector
from app.storage.file_store import file_store
from app.services.taste_builder import (
    TasteBuilder,
    _find_in_pool,
    _parse_composite_id,
    get_fallback_recommendation,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_recommendation_log: dict[str, dict] = {}

VOTE_FLOOR_TMDB = 7.0
VOTE_FLOOR_ANILIST = 7.5

RUNTIME_MAX: dict[str, int] = {
    "short": 40,
    "medium": 90,
    "long": 9999,
}


def _validate_uuid(vector_id: str) -> None:
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


def _runtime_fits_endpoint(item: MediaItem, time_available: TimeSlot) -> bool:
    runtime = item.runtime_minutes
    if runtime is None:
        return True
    max_minutes = RUNTIME_MAX.get(time_available.value, 9999)
    return runtime <= max_minutes


def _vote_filter(item: MediaItem) -> bool:
    is_anime = item.media_type == MediaType.ANIME or item.source == MediaSource.ANILIST
    threshold = VOTE_FLOOR_ANILIST if is_anime else VOTE_FLOOR_TMDB
    return item.vote_average >= threshold


async def _resolve_history_items(
    pool_candidates: list[MediaItem],
    history: list[RecommendationHistoryEntry],
    builder: TasteBuilder,
) -> list[MediaItem]:
    resolved: list[MediaItem] = []
    for entry in history[-2:]:
        item = _find_in_pool(pool_candidates, entry.media_id)
        if item is not None:
            resolved.append(item)
            continue

        item = await builder._fetch_item_detail(entry.media_id)
        if item is not None:
            resolved.append(item)
            continue

        tmdb_id, anilist_id, source = _parse_composite_id(entry.media_id)
        dummy = MediaItem(
            id=entry.media_id,
            source=source or MediaSource.TMDB_MOVIE,
            tmdb_id=tmdb_id,
            anilist_id=anilist_id,
            title=entry.media_id,
            original_title=entry.media_id,
            genres=[],
            keywords=[],
            media_type=MediaType.MOVIE,
        )
        resolved.append(dummy)

    return resolved


def _build_why_now_context(scored: ScoredMediaItem, body: RecommendationRequest) -> WhyNowContext:
    m = scored.media
    return WhyNowContext(
        title=m.title,
        year=m.release_year or 2024,
        genres=m.genres,
        runtime_minutes=m.runtime_minutes or 0,
        rating=m.vote_average,
        top_keywords=list(m.keywords[:5]),
        time_of_day=body.time_of_day,
        time_available=body.time_available.value,
        genre_score_pct=int(scored.score_breakdown.genre * 100),
        keyword_score_pct=int(scored.score_breakdown.keyword * 100),
        media_id=m.id,
        mood=body.mood.value,
    )


def _confidence_from_score(score: float) -> ConfidenceLevel:
    if score >= 0.75:
        return ConfidenceLevel.HIGH
    elif score >= 0.60:
        return ConfidenceLevel.STRONG
    return ConfidenceLevel.MODERATE


async def _run_recommendation_pipeline(
    request: Request,
    taste_vector: UserTasteVector,
    body: RecommendationRequest,
    excluded_ids: list[str],
) -> RecommendationResponse:
    pool = request.app.state.pool
    why_now_service = request.app.state.why_now
    builder = _get_taste_builder(request)

    candidates = pool.get_candidates(exclude_ids=excluded_ids)
    filtered = [
        c for c in candidates
        if _vote_filter(c) and _runtime_fits_endpoint(c, body.time_available)
    ]

    if not filtered:
        return get_fallback_recommendation(pool, body.time_available, body.mood, excluded_ids)

    history_items = await _resolve_history_items(
        pool.candidates, taste_vector.recommendation_history, builder
    )

    scorer = WeightedScorer(
        taste_vector=taste_vector,
        mood=body.mood,
        time_available=body.time_available,
        time_of_day=body.time_of_day,
        recommendation_history=history_items,
    )
    scored = scorer.score_batch(filtered)

    if not scored:
        return get_fallback_recommendation(pool, body.time_available, body.mood, excluded_ids)

    primary = scored[0]
    alternates = list(scored[1:3])

    while len(alternates) < 2:
        alt_dummy = alternates[0] if alternates else primary
        alternates.append(alt_dummy)

    confidence = _confidence_from_score(primary.score)

    ctx = _build_why_now_context(primary, body)
    why_now = await why_now_service.generate_why_now(ctx)

    response = RecommendationResponse(
        primary=primary,
        alternates=alternates[:2],
        why_now=why_now,
        confidence=confidence,
    )

    taste_vector.recommendation_history.append(
        RecommendationHistoryEntry(
            media_id=primary.media.id,
            timestamp=datetime.now(timezone.utc),
            was_regenerated=False,
        )
    )
    taste_vector.updated_at = datetime.now(timezone.utc)
    file_store.save_vector(taste_vector)

    _recommendation_log[response.request_id] = {
        "primary_media_id": primary.media.id,
        "alternate_media_ids": [alt.media.id for alt in alternates[:2]],
    }

    return response


@router.post("/recommend", response_model=RecommendationResponse)
async def recommend(request: Request, body: RecommendationRequest):
    _validate_uuid(body.taste_vector_id)

    taste_vector = file_store.get_vector(body.taste_vector_id)
    if taste_vector is None:
        raise AppError(
            status_code=404,
            detail=f"Taste vector with ID '{body.taste_vector_id}' not found.",
            error_code="TASTE_VECTOR_NOT_FOUND",
        )

    excluded_ids = list(
        set(body.excluded_ids)
        | set(taste_vector.watched_ids)
        | set(taste_vector.favourites)
    )

    return await _run_recommendation_pipeline(request, taste_vector, body, excluded_ids)


@router.post("/recommend/regenerate", response_model=RecommendationResponse)
async def regenerate(request: Request, body: RegenerateRequest):
    _validate_uuid(body.taste_vector_id)

    taste_vector = file_store.get_vector(body.taste_vector_id)
    if taste_vector is None:
        raise AppError(
            status_code=404,
            detail=f"Taste vector with ID '{body.taste_vector_id}' not found.",
            error_code="TASTE_VECTOR_NOT_FOUND",
        )

    log_entry = _recommendation_log.get(body.original_request_id)
    if log_entry is None:
        raise AppError(
            status_code=404,
            detail=f"Previous request with ID '{body.original_request_id}' not found.",
            error_code="PREVIOUS_REQUEST_NOT_FOUND",
        )

    primary_media_id = log_entry["primary_media_id"]

    excluded_ids = list(
        set(body.excluded_ids)
        | set(taste_vector.watched_ids)
        | set(taste_vector.favourites)
        | {primary_media_id}
    )

    taste_vector.regeneration_count += 1

    for entry in reversed(taste_vector.recommendation_history):
        if entry.media_id == primary_media_id:
            entry.was_regenerated = True
            break

    taste_vector.updated_at = datetime.now(timezone.utc)
    file_store.save_vector(taste_vector)

    return await _run_recommendation_pipeline(request, taste_vector, body, excluded_ids)
