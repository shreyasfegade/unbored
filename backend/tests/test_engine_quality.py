"""Engine *quality* checks.

The rest of the suite verifies mechanics (does runtime_fit return a float, does
the router 404). This asserts *properties* of the output over fixed,
catalog-derived taste profiles — recency tracks the profile era, moods produce
varied picks, disjoint tastes give disjoint results, confidence stays earned,
short slots prefer shorter runtimes — so a weight change that quietly degrades
quality fails here instead of silently shipping.

These are intentionally loose (properties, not golden outputs) so healthy tuning
doesn't churn them, but tight enough to fail on a real regression.
"""

from __future__ import annotations

import random
import statistics

import pytest

from app.engine.content import ContentIndex
from app.engine.engine import RecommendationEngine
from app.models.media import MediaType
from app.models.mood import EraPreference, MoodType, TimeSlot
from app.services.catalog import load_catalog, load_embeddings

MOODS = [m.value for m in MoodType]


@pytest.fixture(scope="module")
def catalog():
    return load_catalog()


@pytest.fixture(scope="module")
def index(catalog):
    return ContentIndex(catalog, load_embeddings())


def _movies(catalog):
    return [c for c in catalog if c.media_type == MediaType.MOVIE]


def _profile_by_genre(catalog, genre: str, n: int = 5) -> list[str]:
    items = [c for c in _movies(catalog) if genre in {g.lower() for g in c.genres}]
    items.sort(key=lambda c: c.popularity, reverse=True)
    return [c.id for c in items[:n]]


def _profile_modern(catalog, n: int = 5) -> list[str]:
    items = [c for c in _movies(catalog) if (c.release_year or 0) >= 2018]
    items.sort(key=lambda c: c.popularity, reverse=True)
    return [c.id for c in items[:n]]


def _run(index, catalog, liked, mood, *, era=EraPreference.ANY, slot=TimeSlot.MEDIUM, mt="movie"):
    cand = [c for c in catalog if c.id not in set(liked)]
    engine = RecommendationEngine(
        index, liked_ids=liked, mood=mood, time_available=slot, media_type=mt, era=era,
    )
    return engine.recommend(cand, shortlist_size=8)


def _year_of(item):
    return item.media.release_year or item.media.year


# ── 1. Recency sanity ─────────────────────────────────────────────
def test_recency_tracks_profile_era(index, catalog):
    liked = _profile_modern(catalog)
    med_liked = statistics.median([catalog_year(catalog, i) for i in liked])
    result = _run(index, catalog, liked, "thrilled", era=EraPreference.ANY)
    years = [y for s in result.ranked[:10] if (y := _year_of(s))]
    med_top = statistics.median(years)
    # A modern taste must not be answered with the old canon by default.
    assert med_top >= med_liked - 20, f"top-10 median {med_top} vs profile {med_liked}"
    assert min(years) >= 1990, f"pre-1990 title surfaced for a modern profile: {min(years)}"


def catalog_year(catalog, cid):
    for c in catalog:
        if c.id == cid:
            return c.release_year or c.year or 2015
    return 2015


# ── 2. Mood separation ────────────────────────────────────────────
def test_moods_produce_varied_primaries(index, catalog):
    liked = _profile_modern(catalog)
    primaries = set()
    for mood in MOODS:
        r = _run(index, catalog, liked, mood)
        primaries.add(r.primary.media.id)
    # 7 moods should not collapse to one or two picks.
    assert len(primaries) >= 4, f"only {len(primaries)} distinct picks across 7 moods"


# ── 3. Taste sensitivity ──────────────────────────────────────────
def test_disjoint_tastes_give_disjoint_results(index, catalog):
    horror = _profile_by_genre(catalog, "horror")
    romance = _profile_by_genre(catalog, "romance")
    if len(horror) < 3 or len(romance) < 3:
        pytest.skip("catalog lacks enough horror/romance to test")
    top_h = {s.media.id for s in _run(index, catalog, horror, "thrilled").ranked[:10]}
    top_r = {s.media.id for s in _run(index, catalog, romance, "want_to_cry").ranked[:10]}
    overlap = len(top_h & top_r)
    assert overlap <= 3, f"horror and romance fans share {overlap}/10 top picks"


# ── 4. Confidence calibration ─────────────────────────────────────
def test_confidence_not_always_high(index, catalog):
    movies = _movies(catalog)
    rng = random.Random(42)
    highs = 0
    trials = 40
    for _ in range(trials):
        liked = [c.id for c in rng.sample(movies, 5)]
        r = _run(index, catalog, liked, rng.choice(MOODS))
        if r.confidence.value == "high":
            highs += 1
    # HIGH should be earned, not the default.
    assert highs / trials < 0.6, f"HIGH in {highs}/{trials} random profiles"


# ── 5. Runtime honesty ────────────────────────────────────────────
def test_short_slot_prefers_shorter(index, catalog):
    liked = _profile_modern(catalog)
    short = _run(index, catalog, liked, "happy_energetic", slot=TimeSlot.SHORT, mt="movie")
    long = _run(index, catalog, liked, "happy_energetic", slot=TimeSlot.LONG, mt="movie")
    short_rt = statistics.median([s.media.runtime_minutes or 100 for s in short.ranked[:10]])
    long_rt = statistics.median([s.media.runtime_minutes or 100 for s in long.ranked[:10]])
    assert short_rt <= long_rt, f"SHORT median {short_rt} not <= LONG median {long_rt}"


# ── 6. No self-recommendation, no repeats across a regenerate chain ─
def test_no_self_recommendation_and_no_repeats(index, catalog):
    liked = _profile_modern(catalog)
    excluded = set(liked)
    seen = set()
    for _ in range(3):
        cand = [c for c in catalog if c.id not in excluded]
        engine = RecommendationEngine(
            index, liked_ids=liked, mood="thrilled", time_available=TimeSlot.MEDIUM, media_type="movie",
        )
        r = engine.recommend(cand)
        pid = r.primary.media.id
        assert pid not in liked, "recommended one of the user's own favourites"
        assert pid not in seen, "regenerate returned a repeat"
        seen.add(pid)
        excluded.add(pid)


# ── 7. Genre-boost (query expansion) actually biases the result ───
def test_genre_boost_surfaces_genre(index, catalog):
    liked = _profile_modern(catalog)
    cand = [c for c in catalog if c.id not in set(liked)]
    plain = RecommendationEngine(
        index, liked_ids=liked, mood="thrilled", time_available=TimeSlot.MEDIUM, media_type="movie",
    ).recommend(cand)
    boosted = RecommendationEngine(
        index, liked_ids=liked, mood="thrilled", time_available=TimeSlot.MEDIUM, media_type="movie",
        genre_boosts={"horror": 1.0},
    ).recommend(cand)

    def horror_count(res):
        return sum(1 for s in res.ranked[:10] if "horror" in {g.lower() for g in s.media.genres})

    assert horror_count(boosted) >= horror_count(plain), "genre boost did not increase horror presence"
