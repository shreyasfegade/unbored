from __future__ import annotations
import uuid
from pydantic import BaseModel, Field
from app.models.media import MediaItem
from app.models.mood import ConfidenceLevel, MoodType, TimeOfDay, TimeSlot

class ScoreBreakdown(BaseModel):
    genre: float = Field(default=0.0, ge=0.0, le=1.0)
    keyword: float = Field(default=0.0, ge=0.0, le=1.0)
    mood: float = Field(default=0.0, ge=0.0, le=1.0)
    runtime: float = Field(default=0.0, ge=0.0, le=1.0)
    rating: float = Field(default=0.0, ge=0.0, le=1.0)
    diversity: float = Field(default=0.0, ge=-1.0, le=0.0)

class ScoredMediaItem(BaseModel):
    media: MediaItem
    score: float = Field(..., ge=0.0, le=1.0)
    score_breakdown: ScoreBreakdown

class RecommendationRequest(BaseModel):
    taste_vector_id: str
    mood: MoodType
    time_available: TimeSlot
    time_of_day: TimeOfDay
    excluded_ids: list[str] = Field(default_factory=list)

class WhyNowContext(BaseModel):
    """All data required to construct the Gemini prompt."""
    title: str
    year: int
    genres: list[str]
    runtime_minutes: int
    rating: float = Field(ge=0.0, le=10.0)
    top_keywords: list[str] = Field(max_length=5)
    time_of_day: str
    time_available: str
    genre_score_pct: int = Field(ge=0, le=100)
    keyword_score_pct: int = Field(ge=0, le=100)
    media_id: str
    mood: str

class WhyNowResult(BaseModel):
    """Result of 'Why now?' sentence generation."""
    sentence: str
    source: str  # "llm" | "fallback" | "cache"
    provider: str | None = None  # e.g. "gemini", "deepseek" — None when offline

class RecommendationResponse(BaseModel):
    primary: ScoredMediaItem
    alternates: list[ScoredMediaItem] = Field(
        ..., min_length=2, max_length=2,
        description="Exactly 2 alternate recommendations",
    )
    why_now: WhyNowResult
    confidence: ConfidenceLevel
    request_id: str = Field(default_factory=lambda: str(uuid.uuid4()))

class RegenerateRequest(BaseModel):
    taste_vector_id: str
    mood: MoodType
    time_available: TimeSlot
    time_of_day: TimeOfDay
    original_request_id: str
    excluded_ids: list[str] = Field(default_factory=list)
