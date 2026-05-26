from __future__ import annotations
from enum import StrEnum
from typing import Literal, Optional

from pydantic import BaseModel, Field


class MoodType(StrEnum):
    HAPPY_ENERGETIC = "happy_energetic"
    TIRED_LOW = "tired_low"
    ANXIOUS = "anxious"
    WANT_TO_CRY = "want_to_cry"
    MINDBLOWN_CURIOUS = "mindblown_curious"
    WANT_TO_LAUGH = "want_to_laugh"
    THRILLED = "thrilled"


class TimeSlot(StrEnum):
    SHORT = "short"
    MEDIUM = "medium"
    LONG = "long"


TIME_SLOT_RANGES: dict[TimeSlot, tuple[int, int]] = {
    TimeSlot.SHORT: (0, 30),
    TimeSlot.MEDIUM: (31, 90),
    TimeSlot.LONG: (91, 999),
}


TimeOfDay = Literal["morning", "afternoon", "evening", "late_night"]


class ConfidenceLevel(StrEnum):
    HIGH = "high"
    STRONG = "strong"
    MODERATE = "moderate"


CONFIDENCE_DISPLAY: dict[ConfidenceLevel, str] = {
    ConfidenceLevel.HIGH: "High confidence pick.",
    ConfidenceLevel.STRONG: "Unusually strong match tonight.",
    ConfidenceLevel.MODERATE: "Best fit right now.",
}


class MoodModifier(BaseModel):
    """Schema for one mood entry in mood_translation.json."""

    boost_genres: list[str] = Field(
        ...,
        description="TMDB genre names whose weight is multiplied by BOOST_MULTIPLIER (1.3)",
    )
    penalize_genres: list[str] = Field(
        ...,
        description="TMDB genre names whose weight is multiplied by PENALIZE_MULTIPLIER (0.7)",
    )
    boost_keywords: list[str] = Field(
        ...,
        description="TMDB keyword strings whose weight is multiplied by BOOST_MULTIPLIER (1.3)",
    )
    penalize_keywords: list[str] = Field(
        ...,
        description="TMDB keyword strings whose weight is multiplied by PENALIZE_MULTIPLIER (0.7)",
    )
    emotional_intensity_modifier: float = Field(
        ...,
        ge=-0.3,
        le=0.3,
        description="Additive shift to the user's emotionalIntensity preference.",
    )
    pacing_modifier: Optional[Literal["fast", "slow"]] = Field(
        default=None,
        description="If set, temporarily overrides the taste vector's pacingPreference.",
    )
    darkness_modifier: float = Field(
        ...,
        ge=-0.3,
        le=0.3,
        description="Additive shift to the user's darknessPreference.",
    )
