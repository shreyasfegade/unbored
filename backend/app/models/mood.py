from __future__ import annotations
from enum import StrEnum
from typing import Literal


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


class EraPreference(StrEnum):
    """How much the user cares about recency. A soft ranking bias, never a hard
    filter — classics stay reachable when explicitly asked for."""
    MODERN = "modern"    # lean hard toward recent titles
    ANY = "any"          # neutral (default)
    CLASSIC = "classic"  # lean toward older, established titles


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
