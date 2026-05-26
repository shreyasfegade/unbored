from __future__ import annotations
import uuid
from datetime import datetime, timezone
from enum import StrEnum
from pydantic import BaseModel, Field, field_validator

class PacingPreference(StrEnum):
    FAST = "fast"
    SLOW = "slow"
    MIXED = "mixed"

class RuntimePreference(StrEnum):
    SHORT = "short"
    MEDIUM = "medium"
    LONG = "long"

class EnrichmentSource(StrEnum):
    ONBOARDING_STEP1 = "onboarding_step1"
    CATALOGUE_TAP = "catalogue_tap"
    YOUTUBE_IMPORT = "youtube_import"
    BOOKS = "books"
    GAMES = "games"

class RecommendationHistoryEntry(BaseModel):
    media_id: str = Field(
        ...,
        description='Composite ID: "tmdb_<id>" or "al_<id>"',
    )
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    was_regenerated: bool = False

class UserTasteVector(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    genres: dict[str, float] = Field(
        default_factory=dict,
        description="Genre weights. Keys: normalized genre strings. Values: 0.0–1.0.",
    )
    keywords: dict[str, float] = Field(
        default_factory=dict,
        description="TMDB keyword weights. Keys: slugified keyword. Values: 0.0–1.0.",
    )
    pacing_preference: PacingPreference = PacingPreference.MIXED
    emotional_intensity: float = Field(
        default=0.5, ge=0.0, le=1.0,
        description="0.0 = light, 1.0 = emotionally heavy",
    )
    darkness_preference: float = Field(
        default=0.5, ge=0.0, le=1.0,
        description="0.0 = wholesome, 1.0 = dark/gritty",
    )
    humor_affinity: float = Field(
        default=0.5, ge=0.0, le=1.0,
        description="0.0 = no humor pref, 1.0 = strong humor affinity",
    )
    animation_affinity: float = Field(
        default=0.3, ge=0.0, le=1.0,
        description="0.0 = no animation pref, 1.0 = strong anime/animation affinity",
    )
    runtime_preference: RuntimePreference = RuntimePreference.MEDIUM
    watched_ids: list[str] = Field(
        default_factory=list,
        description='IDs of watched content. Format: "tmdb_<id>" or "al_<id>".',
    )
    favourites: list[str] = Field(
        default_factory=list,
        description="IDs of favourite content (highest taste signal).",
    )
    archetype_applied: str | None = Field(
        default=None,
        description="ID of the vibe archetype applied during cold start augmentation.",
    )
    onboarding_completed: bool = False
    enrichment_sources: list[str] = Field(default_factory=list)
    recommendation_history: list[RecommendationHistoryEntry] = Field(
        default_factory=list,
    )
    regeneration_count: int = Field(
        default=0,
        ge=0,
        description="Total 'Not feeling it' taps — logs user dissatisfaction",
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("genres", "keywords")
    @classmethod
    def validate_weights(cls, v: dict[str, float]) -> dict[str, float]:
        for key, weight in v.items():
            if not (0.0 <= weight <= 1.0):
                raise ValueError(
                    f"Weight for '{key}' must be between 0.0 and 1.0, got {weight}"
                )
        return v

    @field_validator("enrichment_sources")
    @classmethod
    def validate_enrichment_sources(cls, v: list[str]) -> list[str]:
        valid = {e.value for e in EnrichmentSource}
        for src in v:
            if src not in valid:
                raise ValueError(
                    f"Invalid enrichment source '{src}'. Valid: {valid}"
                )
        return v

class CreateTasteRequest(BaseModel):
    favourite_ids: list[str] = Field(
        ...,
        min_length=5,
        max_length=5,
        description="Exactly 5 composite media IDs from onboarding Step 1.",
    )

class UpdateTasteRequest(BaseModel):
    add_favourites: list[str] | None = None
    add_watched_ids: list[str] | None = None
    genre_overrides: dict[str, float] | None = None
    keyword_overrides: dict[str, float] | None = None
    pacing_preference: PacingPreference | None = None
    emotional_intensity: float | None = Field(default=None, ge=0.0, le=1.0)
    darkness_preference: float | None = Field(default=None, ge=0.0, le=1.0)
    humor_affinity: float | None = Field(default=None, ge=0.0, le=1.0)
    animation_affinity: float | None = Field(default=None, ge=0.0, le=1.0)
    runtime_preference: RuntimePreference | None = None
    enrichment_source: str | None = None

    @field_validator("genre_overrides", "keyword_overrides")
    @classmethod
    def validate_override_weights(cls, v: dict[str, float] | None) -> dict[str, float] | None:
        if v is None:
            return v
        for key, weight in v.items():
            if not (0.0 <= weight <= 1.0):
                raise ValueError(f"Weight for '{key}' must be 0.0–1.0, got {weight}")
        return v

    @field_validator("enrichment_source")
    @classmethod
    def validate_enrichment(cls, v: str | None) -> str | None:
        if v is None:
            return v
        valid = {e.value for e in EnrichmentSource}
        if v not in valid:
            raise ValueError(f"Invalid enrichment source '{v}'. Valid: {valid}")
        return v
