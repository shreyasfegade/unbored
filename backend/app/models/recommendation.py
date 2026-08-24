from __future__ import annotations
import uuid
from typing import Literal
from pydantic import BaseModel, Field
from app.models.media import MediaItem
from app.models.mood import ConfidenceLevel, EraPreference, MoodType, TimeOfDay, TimeSlot

class ScoreBreakdown(BaseModel):
    """Transparent per-signal scores behind a recommendation (all 0..1)."""
    relevance: float = Field(default=0.0, ge=0.0, le=1.0)
    mood: float = Field(default=0.0, ge=0.0, le=1.0)
    runtime: float = Field(default=0.0, ge=0.0, le=1.0)
    quality: float = Field(default=0.0, ge=0.0, le=1.0)
    recency: float = Field(default=0.5, ge=0.0, le=1.0)

class ScoredMediaItem(BaseModel):
    media: MediaItem
    score: float = Field(..., ge=0.0, le=1.0)
    score_breakdown: ScoreBreakdown
    # Per-item AI reason, so a hand-swapped alternate shows its own line.
    rationale: str | None = None

MediaTypeChoice = Literal["movie", "tv", "anime", "surprise"]

# Who actually made the AI call, and how it went. "off" = no key connected;
# "used" = AI picked; the rest are silent-failure modes the UI can surface.
AIStatus = Literal["off", "used", "timeout", "error"]

class RecommendationRequest(BaseModel):
    # The taste itself, sent per request — the server keeps no state. Favourites
    # are catalog ids; unknown ids are ignored by the engine. Empty is allowed:
    # the engine's cold-start path returns a strong popular pick, so a visitor
    # can try the product before naming any favourites.
    favourite_ids: list[str] = Field(default_factory=list, max_length=100)
    mood: MoodType
    time_available: TimeSlot
    time_of_day: TimeOfDay
    media_type: MediaTypeChoice = "surprise"
    era: EraPreference = EraPreference.ANY
    # Everything the user has already seen or rejected (incl. the current pick on
    # a "try again"), so regenerate needs no server-side request log.
    excluded_ids: list[str] = Field(default_factory=list, max_length=200)

class RecommendationResponse(BaseModel):
    primary: ScoredMediaItem
    # Up to 2 alternates. Fewer only when the pool is genuinely tiny (heavy
    # exclusions + a type filter); the UI renders 0–2 gracefully rather than
    # us duplicating the primary to hit a fixed count.
    alternates: list[ScoredMediaItem] = Field(
        default_factory=list, max_length=2,
        description="Up to 2 alternate recommendations",
    )
    rationale: str                       # the "why this, for you" line
    picked_by: Literal["ai", "engine"]   # who made the final pick
    provider: str | None = None          # "gemini" | "deepseek" when picked_by == "ai"
    ai_status: AIStatus = "off"          # so the UI never upsells a connected user
    media_type_applied: bool = True      # False when a type filter was dropped to avoid an empty pool
    confidence: ConfidenceLevel
    request_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
