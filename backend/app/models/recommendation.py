from __future__ import annotations
import uuid
from typing import Literal
from pydantic import BaseModel, Field
from app.models.media import MediaItem
from app.models.mood import ConfidenceLevel, MoodType, TimeOfDay, TimeSlot

class ScoreBreakdown(BaseModel):
    """Transparent per-signal scores behind a recommendation (all 0..1)."""
    relevance: float = Field(default=0.0, ge=0.0, le=1.0)
    mood: float = Field(default=0.0, ge=0.0, le=1.0)
    runtime: float = Field(default=0.0, ge=0.0, le=1.0)
    quality: float = Field(default=0.0, ge=0.0, le=1.0)

class ScoredMediaItem(BaseModel):
    media: MediaItem
    score: float = Field(..., ge=0.0, le=1.0)
    score_breakdown: ScoreBreakdown

MediaTypeChoice = Literal["movie", "tv", "anime", "surprise"]

class RecommendationRequest(BaseModel):
    taste_vector_id: str
    mood: MoodType
    time_available: TimeSlot
    time_of_day: TimeOfDay
    media_type: MediaTypeChoice = "surprise"
    excluded_ids: list[str] = Field(default_factory=list)

class RecommendationResponse(BaseModel):
    primary: ScoredMediaItem
    alternates: list[ScoredMediaItem] = Field(
        ..., min_length=2, max_length=2,
        description="Exactly 2 alternate recommendations",
    )
    rationale: str                       # the "why this, for you" line
    picked_by: Literal["ai", "engine"]   # who made the final pick
    provider: str | None = None          # "gemini" | "deepseek" when picked_by == "ai"
    confidence: ConfidenceLevel
    request_id: str = Field(default_factory=lambda: str(uuid.uuid4()))

class RegenerateRequest(BaseModel):
    taste_vector_id: str
    mood: MoodType
    time_available: TimeSlot
    time_of_day: TimeOfDay
    media_type: MediaTypeChoice = "surprise"
    original_request_id: str
    excluded_ids: list[str] = Field(default_factory=list)
