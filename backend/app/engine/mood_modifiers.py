from __future__ import annotations
import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.models.mood import MoodModifier, MoodType

BOOST_MULTIPLIER: float = 1.3
PENALIZE_MULTIPLIER: float = 0.7

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "data" / "mood_translation.json"


@lru_cache(maxsize=1)
def load_mood_config() -> dict[MoodType, MoodModifier]:
    raw = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    config: dict[MoodType, MoodModifier] = {}
    for key, value in raw.items():
        mood = MoodType(key)
        config[mood] = MoodModifier.model_validate(value)

    missing = set(MoodType) - set(config.keys())
    if missing:
        raise ValueError(f"mood_translation.json missing moods: {missing}")

    return config


def get_mood_modifier(mood: MoodType) -> MoodModifier:
    config = load_mood_config()
    return config[mood]


_COMPOUND_MAP: dict[str, list[str]] = {
    "Action & Adventure": ["Action", "Adventure"],
    "Sci-Fi & Fantasy": ["Science Fiction", "Fantasy"],
    "War & Politics": ["War"],
}


def normalize_genre(genre: str) -> list[str]:
    if genre in _COMPOUND_MAP:
        return _COMPOUND_MAP[genre]
    return [genre]


def expand_candidate_genres(genre_names: list[str]) -> set[str]:
    expanded: set[str] = set()
    for g in genre_names:
        expanded.update(normalize_genre(g))
    return expanded


@dataclass(frozen=True)
class TimeOfDayModifier:
    genre_boost_targets: list[str]
    genre_boost_amount: float
    emotional_intensity_bonus: float
    darkness_bonus: float


_TIME_MODIFIERS: dict[str, TimeOfDayModifier] = {
    "late_night": TimeOfDayModifier(
        genre_boost_targets=["Drama", "Romance", "Documentary", "Animation"],
        genre_boost_amount=0.1,
        emotional_intensity_bonus=-0.05,
        darkness_bonus=0.05,
    ),
    "morning": TimeOfDayModifier(
        genre_boost_targets=["Comedy", "Adventure", "Action", "Animation", "Family"],
        genre_boost_amount=0.1,
        emotional_intensity_bonus=-0.05,
        darkness_bonus=-0.05,
    ),
    "afternoon": TimeOfDayModifier(
        genre_boost_targets=[],
        genre_boost_amount=0.0,
        emotional_intensity_bonus=0.0,
        darkness_bonus=0.0,
    ),
    "evening": TimeOfDayModifier(
        genre_boost_targets=[],
        genre_boost_amount=0.0,
        emotional_intensity_bonus=0.0,
        darkness_bonus=0.0,
    ),
}


def get_time_of_day_modifier(time_of_day: str, mood: MoodType) -> TimeOfDayModifier:
    return _TIME_MODIFIERS.get(time_of_day, _TIME_MODIFIERS["afternoon"])
