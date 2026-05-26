import pytest
from app.models.mood import MoodType, TimeSlot
from app.models.media import MediaItem, MediaType, MediaSource
from app.models.taste import UserTasteVector, PacingPreference
from app.services.taste_builder import (
    load_archetypes,
    match_archetypes,
    is_cold_start,
    augment_with_archetype,
    apply_cold_start_augmentation,
    get_archetype_strength,
    get_fallback_recommendation,
    NoRecommendationError,
)


def _make_vector(
    genres: dict[str, float] | None = None,
    keywords: dict[str, float] | None = None,
    pacing: PacingPreference = PacingPreference.MIXED,
    emotional_intensity: float = 0.5,
    darkness: float = 0.5,
    favourites_count: int = 5,
    **kwargs,
) -> UserTasteVector:
    return UserTasteVector(
        id=f"tv-{favourites_count}",
        genres=genres if genres is not None else {},
        keywords=keywords if keywords is not None else {},
        pacing_preference=pacing,
        emotional_intensity=emotional_intensity,
        darkness_preference=darkness,
        favourites=[f"tmdb_{i}" for i in range(favourites_count)],
        **kwargs,
    )


def _make_candidate(
    id: str = "tmdb_1",
    title: str = "Test",
    original_title: str = "Test",
    genres: list[str] | None = None,
    media_type: MediaType = MediaType.MOVIE,
    source: MediaSource = MediaSource.TMDB_MOVIE,
    vote_average: float = 8.0,
    popularity: float = 10.0,
    runtime_minutes: int | None = 90,
) -> MediaItem:
    return MediaItem(
        id=id,
        source=source,
        media_type=media_type,
        title=title,
        original_title=original_title,
        genres=genres if genres is not None else [],
        keywords=[],
        vote_average=vote_average,
        vote_count=1000,
        runtime_minutes=runtime_minutes,
        popularity=popularity,
    )


# ── Archetype loading ────────────────────────────────────────


def test_load_archetypes_returns_8():
    archetypes = load_archetypes()
    assert len(archetypes) == 8


def test_load_archetypes_is_cached():
    info_before = load_archetypes.cache_info()
    load_archetypes()
    info_after = load_archetypes.cache_info()
    assert info_after.hits >= 1


def test_all_archetypes_have_required_fields():
    archetypes = load_archetypes()
    for a in archetypes:
        assert "id" in a
        assert "trigger_genres" in a
        assert "trigger_threshold" in a
        assert "boost_genres" in a
        assert "boost_keywords" in a
        assert "pacing_hint" in a
        assert "emotional_intensity_hint" in a
        assert "darkness_hint" in a


# ── is_cold_start ────────────────────────────────────────────


def test_cold_start_few_items():
    vector = _make_vector(
        genres={"action": 0.5},
        keywords={"explosion": 0.2},
        favourites_count=5,
    )
    assert is_cold_start(vector) is True


def test_cold_start_enough_genres():
    vector = _make_vector(
        genres={"action": 0.5, "comedy": 0.5, "drama": 0.5},
        keywords={"explosion": 0.2, "fun": 0.2, "dark": 0.2, "tense": 0.2, "epic": 0.2},
        favourites_count=5,
    )
    assert is_cold_start(vector) is False


def test_cold_start_many_items():
    vector = _make_vector(
        genres={"action": 0.5},
        keywords={"explosion": 0.2},
        favourites_count=10,
    )
    assert is_cold_start(vector) is False


# ── match_archetypes ─────────────────────────────────────────


def test_match_action_junkie():
    vector = _make_vector(
        genres={"action": 0.8, "adventure": 0.5, "science fiction": 0.4},
        keywords={"explosion": 0.25},
        favourites_count=5,
    )
    matches = match_archetypes(vector)
    assert len(matches) >= 1
    assert matches[0][0]["id"] == "action_junkie"


def test_match_horror_enthusiast():
    vector = _make_vector(
        genres={"horror": 0.9, "thriller": 0.5},
        keywords={},
        favourites_count=5,
    )
    matches = match_archetypes(vector)
    assert len(matches) >= 1
    assert matches[0][0]["id"] == "horror_enthusiast"


def test_match_anime_devotee():
    vector = _make_vector(
        genres={"animation": 0.9, "fantasy": 0.5},
        keywords={},
        favourites_count=5,
    )
    matches = match_archetypes(vector)
    assert len(matches) >= 1
    assert matches[0][0]["id"] == "anime_devotee"


def test_match_scifi_explorer():
    vector = _make_vector(
        genres={"science fiction": 0.9},
        keywords={},
        favourites_count=5,
    )
    matches = match_archetypes(vector)
    assert len(matches) >= 1
    assert matches[0][0]["id"] == "scifi_explorer"


def test_match_no_archetype():
    vector = _make_vector(
        genres={"documentary": 0.5},
        keywords={},
        favourites_count=5,
    )
    matches = match_archetypes(vector)
    assert matches == []


def test_match_case_insensitive_genres():
    vector = _make_vector(
        genres={"Science fiction": 0.9},
        keywords={},
        favourites_count=5,
    )
    matches = match_archetypes(vector)
    assert matches == []


def test_match_multiple_archetypes_sorted():
    vector = _make_vector(
        genres={"horror": 0.8, "action": 0.6, "science fiction": 0.2},
        keywords={},
        favourites_count=5,
    )
    matches = match_archetypes(vector)
    assert len(matches) >= 1
    assert matches[0][1] >= matches[-1][1]


# ── augment_with_archetype ───────────────────────────────────


def test_augment_adds_genre_boosts():
    vector = _make_vector(genres={"thriller": 0.3}, keywords={})
    archetype = load_archetypes()[0]  # cinephile_dark
    result = augment_with_archetype(vector, archetype, strength=1.0)
    assert result.genres["thriller"] == 0.55  # 0.3 + 0.25
    assert result.genres["crime"] == 0.2
    assert result.genres["mystery"] == 0.2


def test_augment_adds_keyword_boosts():
    vector = _make_vector(genres={}, keywords={})
    archetype = load_archetypes()[0]  # cinephile_dark
    result = augment_with_archetype(vector, archetype, strength=1.0)
    assert result.keywords["neo-noir"] == 0.3
    assert result.keywords["plot twist"] == 0.3


def test_augment_caps_values_at_1():
    vector = _make_vector(genres={"thriller": 0.9}, keywords={})
    archetype = load_archetypes()[0]
    result = augment_with_archetype(vector, archetype, strength=1.0)
    assert result.genres["thriller"] == 1.0


def test_augment_applies_pacing_hint():
    vector = _make_vector(genres={"action": 0.5}, pacing=PacingPreference.MIXED)
    archetype = load_archetypes()[2]  # action_junkie: pacing_hint = "fast"
    result = augment_with_archetype(vector, archetype)
    assert result.pacing_preference == PacingPreference.FAST


def test_augment_preserves_existing_pacing_non_mixed():
    vector = _make_vector(genres={"action": 0.5}, pacing=PacingPreference.SLOW)
    archetype = load_archetypes()[2]  # action_junkie: pacing_hint = "fast"
    result = augment_with_archetype(vector, archetype)
    assert result.pacing_preference == PacingPreference.SLOW


def test_augment_sets_archetype_applied():
    vector = _make_vector(genres={"thriller": 0.5})
    archetype = load_archetypes()[0]
    result = augment_with_archetype(vector, archetype)
    assert result.archetype_applied == "cinephile_dark"


def test_augment_blends_emotional_intensity():
    vector = _make_vector(genres={"drama": 0.5}, emotional_intensity=0.4)
    archetype = load_archetypes()[0]  # emotional_intensity_hint = 0.7
    result = augment_with_archetype(vector, archetype)
    assert result.emotional_intensity == pytest.approx(0.4 * 0.7 + 0.7 * 0.3, abs=0.01)


def test_augment_blends_darkness():
    vector = _make_vector(genres={"drama": 0.5}, darkness=0.4)
    archetype = load_archetypes()[0]  # darkness_hint = 0.8
    result = augment_with_archetype(vector, archetype)
    assert result.darkness_preference == pytest.approx(0.4 * 0.7 + 0.8 * 0.3, abs=0.01)


def test_augment_half_strength():
    vector = _make_vector(genres={}, keywords={})
    archetype = load_archetypes()[0]
    result = augment_with_archetype(vector, archetype, strength=0.5)
    assert result.genres["thriller"] == 0.12  # round(0.25 * 0.5, 2) = 0.12
    assert result.keywords["neo-noir"] == 0.15  # round(0.3 * 0.5, 2) = 0.15


# ── apply_cold_start_augmentation ────────────────────────────


def test_apply_cold_start_augments():
    vector = _make_vector(
        genres={"action": 0.8, "adventure": 0.5, "science fiction": 0.4},
        keywords={},
        favourites_count=5,
    )
    result = apply_cold_start_augmentation(vector)
    assert result.archetype_applied == "action_junkie"


def test_apply_cold_start_skips_if_not_cold():
    vector = _make_vector(
        genres={"action": 0.5, "comedy": 0.5, "drama": 0.5},
        keywords={"a": 0.2, "b": 0.2, "c": 0.2, "d": 0.2, "e": 0.2},
        favourites_count=5,
    )
    result = apply_cold_start_augmentation(vector)
    assert result.archetype_applied is None


def test_apply_cold_start_forced_match():
    vector = _make_vector(
        genres={"documentary": 0.5},
        keywords={},
        favourites_count=5,
    )
    result = apply_cold_start_augmentation(vector)
    assert result.archetype_applied is not None


# ── get_archetype_strength ───────────────────────────────────


def test_strength_cold():
    vector = _make_vector(favourites_count=5)
    assert get_archetype_strength(vector) == 1.0


def test_strength_warming():
    vector = _make_vector(favourites_count=12)
    assert get_archetype_strength(vector) == 0.5


def test_strength_fading():
    vector = _make_vector(favourites_count=22)
    assert get_archetype_strength(vector) == 0.25


def test_strength_gone():
    vector = _make_vector(favourites_count=35)
    assert get_archetype_strength(vector) == 0.0


# ── Fallback recommendation ──────────────────────────────────


def test_fallback_returns_primary_and_two_alternates():
    pool_candidates = [
        _make_candidate(id="tmdb_1", title="Movie 1", original_title="Movie 1", popularity=100.0, runtime_minutes=90),
        _make_candidate(id="tmdb_2", title="Movie 2", original_title="Movie 2", popularity=80.0, runtime_minutes=90),
        _make_candidate(id="tmdb_3", title="Movie 3", original_title="Movie 3", popularity=60.0, runtime_minutes=90),
        _make_candidate(id="tmdb_4", title="Movie 4", original_title="Movie 4", popularity=40.0, runtime_minutes=90),
    ]

    class FakePool:
        def get_candidates(self, exclude_ids=None):
            exclude_set = set(exclude_ids or [])
            return [c for c in pool_candidates if c.id not in exclude_set]

    pool = FakePool()
    result = get_fallback_recommendation(pool, TimeSlot.MEDIUM, MoodType.HAPPY_ENERGETIC, [])

    assert result.primary.media.id == "tmdb_1"
    assert len(result.alternates) == 2
    assert result.alternates[0].media.id == "tmdb_2"
    assert result.alternates[1].media.id == "tmdb_3"
    assert result.confidence == "moderate"
    assert result.primary.score == 0.35


def test_fallback_filters_below_rating():
    pool_candidates = [
        _make_candidate(id="tmdb_bad", title="Bad", original_title="Bad", vote_average=5.0, popularity=100.0, runtime_minutes=90),
        _make_candidate(id="tmdb_ok", title="OK", original_title="OK", vote_average=7.0, popularity=80.0, runtime_minutes=90),
    ]

    class FakePool:
        def get_candidates(self, exclude_ids=None):
            return pool_candidates

    pool = FakePool()
    result = get_fallback_recommendation(pool, TimeSlot.MEDIUM, MoodType.HAPPY_ENERGETIC, [])
    assert result.primary.media.id == "tmdb_ok"


def test_fallback_relaxes_filters_when_few_candidates():
    pool_candidates = [
        _make_candidate(id="tmdb_1", title="Only", original_title="Only", vote_average=5.5, popularity=10.0, runtime_minutes=200),
    ]

    class FakePool:
        def get_candidates(self, exclude_ids=None):
            return pool_candidates

    pool = FakePool()
    result = get_fallback_recommendation(pool, TimeSlot.SHORT, MoodType.HAPPY_ENERGETIC, [])
    assert len(result.alternates) == 2


def test_fallback_excludes_ids():
    pool_candidates = [
        _make_candidate(id="tmdb_1", title="Movie 1", original_title="Movie 1", popularity=100.0, runtime_minutes=90),
        _make_candidate(id="tmdb_2", title="Movie 2", original_title="Movie 2", popularity=80.0, runtime_minutes=90),
        _make_candidate(id="tmdb_3", title="Movie 3", original_title="Movie 3", popularity=60.0, runtime_minutes=90),
    ]

    class FakePool:
        def get_candidates(self, exclude_ids=None):
            exclude_set = set(exclude_ids or [])
            return [c for c in pool_candidates if c.id not in exclude_set]

    pool = FakePool()
    result = get_fallback_recommendation(pool, TimeSlot.MEDIUM, MoodType.HAPPY_ENERGETIC, ["tmdb_1"])
    assert result.primary.media.id == "tmdb_2"


def test_fallback_raises_when_no_candidates():
    pool_candidates: list[MediaItem] = []

    class FakePool:
        def get_candidates(self, exclude_ids=None):
            return pool_candidates

    pool = FakePool()
    with pytest.raises(NoRecommendationError):
        get_fallback_recommendation(pool, TimeSlot.MEDIUM, MoodType.HAPPY_ENERGETIC, [])
