"""Tone modelling for mood-aware ranking.

Every title is placed on five interpretable tone axes — energy, darkness,
warmth, intensity, humor — derived from its genres plus a curated keyword
lexicon (and a few inferred signals). Each mood maps to a target point in the
same space, so "mood fit" is a smooth distance rather than a crude on/off
genre toggle.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

from app.models.media import MediaItem

_DATA = Path(__file__).resolve().parent.parent / "data"
N_AXES = 5
_MAX_DIST = math.sqrt(N_AXES)
_BASELINE = 0.5


@lru_cache(maxsize=1)
def _lexicon() -> dict:
    return json.loads((_DATA / "tone_lexicon.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _mood_targets() -> dict[str, list[float]]:
    raw = json.loads((_DATA / "mood_targets.json").read_text(encoding="utf-8"))
    return raw["moods"]


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def tone_vector(item: MediaItem) -> list[float]:
    """Return the item's 5-axis tone vector in [0,1]."""
    lex = _lexicon()
    genre_deltas: dict[str, list[float]] = lex["genres"]
    keyword_deltas: dict[str, list[float]] = lex["keywords"]

    vec = [_BASELINE] * N_AXES

    for genre in item.genres:
        deltas = genre_deltas.get(genre.lower().strip())
        if deltas:
            for i in range(N_AXES):
                vec[i] += deltas[i]

    # Keyword + overview lexicon hits (overview matched on whole-word basis).
    haystack_tokens = {kw.lower().strip() for kw in item.keywords}
    overview = (item.overview or "").lower()
    for token, deltas in keyword_deltas.items():
        hit = token in haystack_tokens or token in overview
        if hit:
            for i in range(N_AXES):
                vec[i] += deltas[i] * 0.6  # softer than genre signal

    # A couple of inferred nudges from structure.
    if item.runtime_minutes and item.runtime_minutes > 140:
        vec[3] += 0.08  # long films skew more intense
    if item.vote_average and item.vote_average >= 8.3:
        vec[3] += 0.05

    return [_clamp(v) for v in vec]


# Tone axes, in order: 0 energy, 1 darkness, 2 warmth, 3 intensity, 4 humor.
_AXIS_DARKNESS = 1
_AXIS_INTENSITY = 3
_AXIS_HUMOR = 4
_AXIS_ENERGY = 0


def mood_target(
    mood: str | None,
    *,
    taste: dict[str, float] | None = None,
    time_of_day: str | None = None,
) -> list[float] | None:
    """The mood's target point, personalised by the user's standing taste and
    the time of day. Returns ``None`` when there's no mood to match.

    ``taste`` carries the dimensions the engine used to ignore entirely
    (darkness_preference, humor_affinity, emotional_intensity) — each nudges the
    matching axis toward the user, so two people in the same mood don't get the
    same tone target.
    """
    if not mood:
        return None
    base = _mood_targets().get(mood)
    if base is None:
        return None
    target = list(base)

    if taste:
        def nudge(axis: int, key: str) -> None:
            pref = taste.get(key)
            if pref is not None:
                target[axis] = _clamp(0.75 * target[axis] + 0.25 * pref)

        nudge(_AXIS_DARKNESS, "darkness_preference")
        nudge(_AXIS_HUMOR, "humor_affinity")
        nudge(_AXIS_INTENSITY, "emotional_intensity")

    # Late at night, pull the energy target down a touch — calmer picks fit.
    if time_of_day == "late_night":
        target[_AXIS_ENERGY] = _clamp(target[_AXIS_ENERGY] - 0.12)

    return [_clamp(v) for v in target]


def mood_fit_to_target(item: MediaItem, target: list[float] | None) -> float:
    """How well an item's tone matches a (possibly personalised) target, in [0,1]."""
    if target is None:
        return 0.5
    vec = tone_vector(item)
    dist = math.sqrt(sum((vec[i] - target[i]) ** 2 for i in range(N_AXES)))
    return _clamp(1.0 - dist / _MAX_DIST)


def mood_fit(item: MediaItem, mood: str | None) -> float:
    """Return how well an item's tone matches the mood, in [0,1]. 0.5 if no mood."""
    return mood_fit_to_target(item, mood_target(mood))
