"""Recommendation endpoints.

The deterministic engine (app/engine) ranks the catalog and produces a strong
shortlist. If the request carries a user LLM key (X-LLM-* headers), the curator
re-picks + explains from that shortlist; otherwise the engine's own pick and a
templated rationale are used. Either way the result is one confident pick + two
alternates.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Header, Request

from app.engine.engine import RecommendationEngine
from app.exceptions import AppError
from app.llm.base import LLMProvider
from app.models.media import MediaItem
from app.models.mood import ConfidenceLevel
from app.models.recommendation import (
    RecommendationRequest,
    RecommendationResponse,
    RegenerateRequest,
    ScoreBreakdown,
    ScoredMediaItem,
)
from app.models.taste import RecommendationHistoryEntry, UserTasteVector
from app.services.curator import curate
from app.services.rationale import engine_rationale
from app.storage.file_store import file_store

logger = logging.getLogger(__name__)

router = APIRouter()

_recommendation_log: dict[str, dict] = {}


def _validate_uuid(vector_id: str) -> None:
    try:
        uuid.UUID(vector_id, version=4)
    except (ValueError, AttributeError):
        raise AppError(
            status_code=404,
            detail=f"Taste vector with ID '{vector_id}' not found.",
            error_code="TASTE_VECTOR_NOT_FOUND",
        )


def _get_vector_or_404(vector_id: str) -> UserTasteVector:
    _validate_uuid(vector_id)
    vector = file_store.get_vector(vector_id)
    if vector is None:
        raise AppError(
            status_code=404,
            detail=f"Taste vector with ID '{vector_id}' not found.",
            error_code="TASTE_VECTOR_NOT_FOUND",
        )
    return vector


def _resolve_provider(request: Request, name: str | None, key: str | None) -> LLMProvider | None:
    if not name or not key:
        return None
    return request.app.state.provider_cache.get(name, key)


def _pad_alternates(
    primary: ScoredMediaItem, alternates: list[ScoredMediaItem], ranked: list[ScoredMediaItem]
) -> list[ScoredMediaItem]:
    chosen_ids = {primary.media.id} | {a.media.id for a in alternates}
    for s in ranked:
        if len(alternates) >= 2:
            break
        if s.media.id not in chosen_ids:
            alternates.append(s)
            chosen_ids.add(s.media.id)
    while len(alternates) < 2:  # tiny pool — duplicate as a last resort
        alternates.append(alternates[-1] if alternates else primary)
    return alternates[:2]


def _popularity_fallback(candidates: list[MediaItem]) -> RecommendationResponse | None:
    if not candidates:
        return None
    ranked = sorted(candidates, key=lambda c: c.popularity, reverse=True)

    def wrap(m: MediaItem) -> ScoredMediaItem:
        return ScoredMediaItem(media=m, score=0.5, score_breakdown=ScoreBreakdown())

    primary = wrap(ranked[0])
    alternates = [wrap(m) for m in ranked[1:3]]
    while len(alternates) < 2:
        alternates.append(primary)
    return RecommendationResponse(
        primary=primary,
        alternates=alternates[:2],
        rationale="A crowd favourite to get you started.",
        picked_by="engine",
        confidence=ConfidenceLevel.MODERATE,
    )


async def _run_pipeline(
    request: Request,
    taste_vector: UserTasteVector,
    body: RecommendationRequest,
    excluded_ids: list[str],
    provider: LLMProvider | None,
) -> RecommendationResponse:
    pool = request.app.state.pool
    index = request.app.state.index
    catalog_map: dict[str, MediaItem] = {c.id: c for c in pool.candidates}

    candidates = pool.get_candidates(exclude_ids=excluded_ids)

    liked_ids = list(taste_vector.favourites)
    liked_items = [catalog_map[i] for i in liked_ids if i in catalog_map]
    liked_genres = {g for item in liked_items for g in item.genres}

    engine = RecommendationEngine(
        index,
        liked_ids=liked_ids,
        mood=body.mood.value,
        time_available=body.time_available,
        media_type=body.media_type,
    )
    result = engine.recommend(candidates, shortlist_size=8)
    if result is None:
        fallback = _popularity_fallback(candidates or pool.candidates)
        if fallback is None:
            raise AppError(500, "No candidates available.", "NO_CANDIDATES")
        return fallback

    primary = result.primary
    alternates = list(result.alternates)
    confidence = result.confidence
    rationale = engine_rationale(primary, body.mood.value, liked_genres)
    picked_by: str = "engine"
    provider_name: str | None = None

    if provider is not None:
        curated = await curate(
            provider,
            liked_titles=[m.title for m in liked_items],
            mood=body.mood.value,
            time_available=body.time_available.value,
            media_type=body.media_type,
            shortlist=[s.media for s in result.shortlist],
        )
        if curated is not None:
            sl = result.shortlist
            primary = sl[curated.primary_index]
            alternates = [sl[i] for i in curated.alternate_indices if i != curated.primary_index]
            alternates = _pad_alternates(primary, alternates, result.ranked)
            rationale = curated.why or rationale
            picked_by = "ai"
            provider_name = provider.name

    alternates = _pad_alternates(primary, alternates, result.ranked)

    response = RecommendationResponse(
        primary=primary,
        alternates=alternates,
        rationale=rationale,
        picked_by=picked_by,  # type: ignore[arg-type]
        provider=provider_name,
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
        "alternate_media_ids": [a.media.id for a in alternates],
    }
    return response


@router.post("/recommend", response_model=RecommendationResponse)
async def recommend(
    request: Request,
    body: RecommendationRequest,
    x_llm_provider: str | None = Header(default=None),
    x_llm_key: str | None = Header(default=None),
):
    taste_vector = _get_vector_or_404(body.taste_vector_id)
    excluded_ids = list(
        set(body.excluded_ids) | set(taste_vector.watched_ids) | set(taste_vector.favourites)
    )
    provider = _resolve_provider(request, x_llm_provider, x_llm_key)
    return await _run_pipeline(request, taste_vector, body, excluded_ids, provider)


@router.post("/recommend/regenerate", response_model=RecommendationResponse)
async def regenerate(
    request: Request,
    body: RegenerateRequest,
    x_llm_provider: str | None = Header(default=None),
    x_llm_key: str | None = Header(default=None),
):
    taste_vector = _get_vector_or_404(body.taste_vector_id)

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

    req = RecommendationRequest(
        taste_vector_id=body.taste_vector_id,
        mood=body.mood,
        time_available=body.time_available,
        time_of_day=body.time_of_day,
        media_type=body.media_type,
        excluded_ids=body.excluded_ids,
    )
    provider = _resolve_provider(request, x_llm_provider, x_llm_key)
    return await _run_pipeline(request, taste_vector, req, excluded_ids, provider)
