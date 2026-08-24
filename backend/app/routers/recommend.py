"""Recommendation endpoint — stateless.

The request carries the taste itself (`favourite_ids`) plus everything already
seen (`excluded_ids`), so the server keeps no per-user state at all: no storage,
no request log, no taste vectors. The deterministic engine ranks the in-memory
catalog and produces a shortlist; if the request carries a user LLM key, the AI
biases retrieval (query expansion) and re-picks/explains from the shortlist.
Either way the result is one confident pick + up to two alternates.

"Try again" is just another /recommend with the previous pick in excluded_ids —
no server-side original_request_id needed.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Header, Request

from app.engine.engine import RecommendationEngine
from app.engine.taste_signals import taste_dims_from_items
from app.exceptions import AppError
from app.llm.base import LLMProvider
from app.models.media import MediaItem
from app.models.mood import ConfidenceLevel
from app.models.recommendation import (
    RecommendationRequest,
    RecommendationResponse,
    ScoreBreakdown,
    ScoredMediaItem,
)
from app.services import metrics
from app.services.curator import curate
from app.services.query_expansion import expand
from app.services.rationale import engine_rationale

logger = logging.getLogger(__name__)

router = APIRouter()


def _resolve_provider(request: Request, name: str | None, key: str | None) -> LLMProvider | None:
    if not name or not key:
        return None
    return request.app.state.provider_cache.get(name, key)


def _fill_alternates(
    primary: ScoredMediaItem, alternates: list[ScoredMediaItem], ranked: list[ScoredMediaItem]
) -> list[ScoredMediaItem]:
    """Top up alternates from the ranked pool without ever duplicating a pick.
    Returns 0–2 distinct items."""
    chosen_ids = {primary.media.id} | {a.media.id for a in alternates}
    result = list(alternates)
    for s in ranked:
        if len(result) >= 2:
            break
        if s.media.id not in chosen_ids:
            result.append(s)
            chosen_ids.add(s.media.id)
    return result[:2]


def _popularity_fallback(candidates: list[MediaItem]) -> RecommendationResponse | None:
    if not candidates:
        return None
    # popularity_norm, so the fallback isn't all anime on a cross-source scale.
    ranked = sorted(candidates, key=lambda c: c.popularity_norm, reverse=True)

    def wrap(m: MediaItem) -> ScoredMediaItem:
        return ScoredMediaItem(media=m, score=0.5, score_breakdown=ScoreBreakdown())

    return RecommendationResponse(
        primary=wrap(ranked[0]),
        alternates=[wrap(m) for m in ranked[1:3]],
        rationale="A crowd favourite to get you started.",
        picked_by="engine",
        ai_status="off",
        confidence=ConfidenceLevel.MODERATE,
    )


async def _run_pipeline(
    request: Request,
    body: RecommendationRequest,
    provider: LLMProvider | None,
) -> RecommendationResponse:
    pool = request.app.state.pool
    index = request.app.state.index
    catalog_map: dict[str, MediaItem] = request.app.state.catalog_map  # built once at startup

    excluded_ids = set(body.excluded_ids) | set(body.favourite_ids)
    candidates = pool.get_candidates(exclude_ids=list(excluded_ids))

    liked_ids = list(body.favourite_ids)
    liked_items = [catalog_map[i] for i in liked_ids if i in catalog_map]
    liked_genres = {g for item in liked_items for g in item.genres}
    liked_titles = [m.title for m in liked_items]

    ai_status: str = "off"
    genre_boosts: dict[str, float] = {}
    if provider is not None:
        ai_status = "error"  # provider present; downgraded unless curate succeeds
        # Upstream: let the AI shape what's considered before ranking.
        genre_boosts = await expand(
            provider,
            liked_titles=liked_titles,
            mood=body.mood.value,
            time_available=body.time_available.value,
            media_type=body.media_type,
            era=body.era.value,
        )

    engine = RecommendationEngine(
        index,
        liked_ids=liked_ids,
        mood=body.mood.value,
        time_available=body.time_available,
        media_type=body.media_type,
        era=body.era,
        time_of_day=body.time_of_day,
        taste=taste_dims_from_items(liked_items),
        genre_boosts=genre_boosts,
        tuning=body.tuning.model_dump() if body.tuning else None,
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
            liked_titles=liked_titles,
            mood=body.mood.value,
            time_available=body.time_available.value,
            media_type=body.media_type,
            shortlist=[s.media for s in result.shortlist],
        )
        if curated is not None:
            sl = result.shortlist
            primary = sl[curated.primary_index]
            alternates = [sl[i] for i in curated.alternate_indices if i != curated.primary_index]
            alternates = _fill_alternates(primary, alternates, result.ranked)
            rationale = curated.why or rationale
            # Attach the per-item reason so a swap shows an honest line.
            for idx, line in curated.why_by_index.items():
                if 0 <= idx < len(sl):
                    sl[idx].rationale = line
            picked_by = "ai"
            provider_name = provider.name
            ai_status = "used"

    alternates = _fill_alternates(primary, alternates, result.ranked)
    if primary.rationale is None:
        primary.rationale = rationale

    # Observability: how often AI is used vs. silently downgraded vs. off.
    metrics.incr("recommend_total")
    metrics.incr(f"ai_{ai_status}")
    metrics.incr(f"confidence_{confidence.value}")
    if body.excluded_ids:
        metrics.incr("regenerate_total")

    return RecommendationResponse(
        primary=primary,
        alternates=alternates,
        rationale=rationale,
        picked_by=picked_by,  # type: ignore[arg-type]
        provider=provider_name,
        ai_status=ai_status,  # type: ignore[arg-type]
        media_type_applied=result.media_type_applied,
        confidence=confidence,
    )


@router.post("/recommend", response_model=RecommendationResponse)
async def recommend(
    request: Request,
    body: RecommendationRequest,
    x_llm_provider: str | None = Header(default=None),
    x_llm_key: str | None = Header(default=None),
):
    provider = _resolve_provider(request, x_llm_provider, x_llm_key)
    return await _run_pipeline(request, body, provider)
