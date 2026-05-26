import pytest
from app.engine.scorer import (
    WeightedScorer,
    W_GENRE,
    W_KEYWORD,
    W_MOOD,
    W_RUNTIME,
    W_RATING,
    W_DIVERSITY,
)
from app.engine.confidence import calculate_confidence
from app.engine.diversity import calculate_diversity_score
from app.models.media import MediaItem, MediaType, MediaSource
from app.models.mood import MoodType, TimeSlot, ConfidenceLevel
from app.models.taste import UserTasteVector


def _make_candidate(
    id: str = "tmdb_1",
    source: MediaSource = MediaSource.TMDB_MOVIE,
    media_type: MediaType = MediaType.MOVIE,
    title: str = "Test",
    original_title: str = "Test",
    genres: list[str] | None = None,
    keywords: list[str] | None = None,
    vote_average: float = 8.0,
    vote_count: int = 1000,
    runtime_minutes: int | None = None,
    **kwargs,
) -> MediaItem:
    return MediaItem(
        id=id,
        source=source,
        media_type=media_type,
        title=title,
        original_title=original_title,
        genres=genres if genres is not None else [],
        keywords=keywords if keywords is not None else [],
        vote_average=vote_average,
        vote_count=vote_count,
        runtime_minutes=runtime_minutes,
        **kwargs,
    )


# ── Weight sanity ─────────────────────────────────────────────


def test_weights_sum_to_one():
    assert abs((W_GENRE + W_KEYWORD + W_MOOD + W_RUNTIME + W_RATING + W_DIVERSITY) - 1.0) < 1e-9


# ── Inferred properties ───────────────────────────────────────


def test_inferred_emotional_intensity_drama():
    c = _make_candidate(genres=["drama", "thriller"], vote_average=9.0, runtime_minutes=130)
    assert c.inferred_emotional_intensity == 0.75


def test_inferred_emotional_intensity_mild():
    c = _make_candidate(genres=["comedy"], vote_average=7.0)
    assert c.inferred_emotional_intensity == 0.3


def test_inferred_pacing_fast():
    c = _make_candidate(genres=["action", "thriller"])
    assert c.inferred_pacing == "fast"


def test_inferred_pacing_slow():
    c = _make_candidate(genres=["drama", "romance"])
    assert c.inferred_pacing == "slow"


def test_inferred_pacing_mixed():
    c = _make_candidate(genres=["action", "drama"])
    assert c.inferred_pacing == "mixed"


def test_inferred_darkness_horror():
    c = _make_candidate(genres=["horror", "thriller"])
    assert c.inferred_darkness == 0.8


def test_inferred_darkness_comedy():
    c = _make_candidate(genres=["comedy", "family"])
    assert c.inferred_darkness == 0.15


# ── Genre scoring ─────────────────────────────────────────────


def test_genre_score_full_match():
    tv = UserTasteVector(id="t", genres={"action": 1.0, "thriller": 1.0})
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    c = _make_candidate(genres=["action", "thriller"], vote_average=8.0, vote_count=1000)
    assert scorer._genre_score(c) == pytest.approx(1.0)


def test_genre_score_no_match():
    tv = UserTasteVector(id="t", genres={"comedy": 1.0})
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    c = _make_candidate(genres=["action", "thriller"], vote_average=8.0, vote_count=1000)
    assert scorer._genre_score(c) == pytest.approx(0.0)


def test_genre_score_empty_genres():
    tv = UserTasteVector(id="t", genres={"action": 1.0})
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    c = _make_candidate(genres=[], vote_average=8.0, vote_count=1000)
    assert scorer._genre_score(c) == 0.0


def test_genre_score_partial_match():
    tv = UserTasteVector(id="t", genres={"action": 0.8, "comedy": 0.6})
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    c = _make_candidate(genres=["action", "drama", "romance"], vote_average=8.0, vote_count=1000)
    assert scorer._genre_score(c) == pytest.approx(0.8 / 3, abs=1e-4)


def test_genre_score_with_mood_boost():
    tv = UserTasteVector(id="t", genres={"science fiction": 1.0})
    scorer = WeightedScorer(tv, MoodType.MINDBLOWN_CURIOUS, TimeSlot.MEDIUM, "afternoon", [])
    c = _make_candidate(genres=["science fiction"], vote_average=8.0, vote_count=1000)
    assert scorer._genre_score(c) == pytest.approx(1.3)


def test_genre_score_with_mood_penalize():
    tv = UserTasteVector(id="t", genres={"drama": 1.0})
    scorer = WeightedScorer(tv, MoodType.WANT_TO_LAUGH, TimeSlot.MEDIUM, "afternoon", [])
    c = _make_candidate(genres=["drama"], vote_average=8.0, vote_count=1000)
    assert scorer._genre_score(c) == pytest.approx(0.7)


def test_genre_score_case_insensitive():
    tv = UserTasteVector(id="t", genres={"science fiction": 1.0})
    scorer = WeightedScorer(tv, MoodType.MINDBLOWN_CURIOUS, TimeSlot.MEDIUM, "afternoon", [])
    c = _make_candidate(genres=["Science Fiction"], vote_average=8.0, vote_count=1000)
    assert scorer._genre_score(c) == pytest.approx(1.3)


# ── Runtime scoring ───────────────────────────────────────────


def test_runtime_ideal_short():
    tv = UserTasteVector(id="t", genres={})
    scorer = WeightedScorer(tv, None, TimeSlot.SHORT, "afternoon", [])
    c = _make_candidate(runtime_minutes=25)
    assert scorer._runtime_score(c) == 1.0


def test_runtime_acceptable_medium():
    tv = UserTasteVector(id="t", genres={})
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    c = _make_candidate(runtime_minutes=110)
    assert scorer._runtime_score(c) == 0.5


def test_runtime_outside_long():
    tv = UserTasteVector(id="t", genres={})
    scorer = WeightedScorer(tv, None, TimeSlot.LONG, "afternoon", [])
    c = _make_candidate(runtime_minutes=20)
    assert scorer._runtime_score(c) == 0.0


def test_runtime_anime_default():
    tv = UserTasteVector(id="t", genres={})
    scorer = WeightedScorer(tv, None, TimeSlot.SHORT, "afternoon", [])
    c = _make_candidate(
        id="al_8",
        source=MediaSource.ANILIST,
        media_type=MediaType.ANIME,
        title="Test Anime",
        original_title="Test Anime",
    )
    assert scorer._runtime_score(c) == 1.0


def test_runtime_tv_default():
    tv = UserTasteVector(id="t", genres={})
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    c = _make_candidate(
        source=MediaSource.TMDB_TV,
        media_type=MediaType.TV,
    )
    assert scorer._runtime_score(c) == 0.5


# ── Rating scoring ────────────────────────────────────────────


def test_rating_below_threshold():
    tv = UserTasteVector(id="t", genres={})
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    c = _make_candidate(vote_average=6.5, vote_count=1000)
    assert scorer._rating_score(c) == 0.0


def test_rating_above_threshold():
    tv = UserTasteVector(id="t", genres={})
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    c = _make_candidate(vote_average=8.5, vote_count=5000)
    assert scorer._rating_score(c) == pytest.approx(0.5)


def test_rating_low_vote_count_penalty():
    tv = UserTasteVector(id="t", genres={})
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    c = _make_candidate(vote_average=9.0, vote_count=50)
    assert scorer._rating_score(c) == pytest.approx(0.3333, abs=1e-3)


def test_rating_anime_threshold():
    tv = UserTasteVector(id="t", genres={})
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    c = _make_candidate(
        id="al_12",
        source=MediaSource.ANILIST,
        media_type=MediaType.ANIME,
        title="Test Anime",
        original_title="Test Anime",
        vote_average=7.2,
        vote_count=5000,
    )
    assert scorer._rating_score(c) == 0.0


# ── Diversity scoring ─────────────────────────────────────────


def test_diversity_no_history():
    assert calculate_diversity_score(["action", "drama"], []) == 1.0


def test_diversity_no_overlap():
    assert calculate_diversity_score(["comedy"], ["action", "drama"]) == 1.0


def test_diversity_one_overlap():
    assert calculate_diversity_score(["action", "drama"], ["action"]) == 0.5


def test_diversity_two_overlaps():
    assert calculate_diversity_score(["action"], ["action", "action"]) == 0.0


def test_diversity_within_scorer():
    tv = UserTasteVector(id="t", genres={})
    history = [
        _make_candidate(id="h1", genres=["action"], title="Hist1", original_title="Hist1"),
        _make_candidate(id="h2", genres=["drama"], title="Hist2", original_title="Hist2"),
    ]
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", history)
    c = _make_candidate(genres=["action", "thriller"])
    score = scorer._diversity_score(c)
    assert score == 0.5


# ── Mood scoring ──────────────────────────────────────────────


def test_mood_none_returns_neutral():
    tv = UserTasteVector(id="t", genres={})
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    c = _make_candidate(genres=["action"])
    assert scorer._mood_score(c) == 0.5


def test_mood_boost():
    tv = UserTasteVector(
        id="t",
        genres={"science fiction": 1.0},
        keywords={"mind-bending": 1.0},
        emotional_intensity=0.5,
        darkness_preference=0.5,
        pacing_preference="mixed",
    )
    scorer = WeightedScorer(tv, MoodType.MINDBLOWN_CURIOUS, TimeSlot.MEDIUM, "afternoon", [])
    c = _make_candidate(genres=["science fiction"], keywords=["mind-bending"])
    assert scorer._mood_score(c) >= 0.5


# ── Confidence levels ─────────────────────────────────────────


def test_confidence_high():
    assert calculate_confidence(0.75) == ConfidenceLevel.HIGH
    assert calculate_confidence(0.90) == ConfidenceLevel.HIGH


def test_confidence_strong():
    assert calculate_confidence(0.60) == ConfidenceLevel.STRONG
    assert calculate_confidence(0.74) == ConfidenceLevel.STRONG


def test_confidence_moderate():
    assert calculate_confidence(0.59) == ConfidenceLevel.MODERATE
    assert calculate_confidence(0.0) == ConfidenceLevel.MODERATE


# ── Batch scoring ─────────────────────────────────────────────


def test_score_batch_filters_watched():
    tv = UserTasteVector(id="t", genres={"action": 1.0}, watched_ids=["tmdb_watched"])
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    candidates = [
        _make_candidate(id="tmdb_watched", title="Watched", original_title="Watched", genres=["action"]),
        _make_candidate(id="tmdb_unwatched", title="Unwatched", original_title="Unwatched", genres=["action"]),
    ]
    results = scorer.score_batch(candidates)
    result_ids = [r.media.id for r in results]
    assert "tmdb_watched" not in result_ids
    assert "tmdb_unwatched" in result_ids


def test_score_batch_sorted_descending():
    tv = UserTasteVector(id="t", genres={"action": 1.0, "comedy": 0.1})
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    candidates = [
        _make_candidate(
            id="tmdb_low",
            title="Low Score",
            original_title="Low Score",
            genres=["comedy"],
            vote_average=7.5,
            vote_count=1000,
            runtime_minutes=90,
        ),
        _make_candidate(
            id="tmdb_high",
            title="High Score",
            original_title="High Score",
            genres=["action"],
            vote_average=9.0,
            vote_count=10000,
            runtime_minutes=90,
        ),
    ]
    results = scorer.score_batch(candidates)
    assert results[0].media.id == "tmdb_high"
    assert results[1].media.id == "tmdb_low"
    assert results[0].score >= results[1].score


def test_score_batch_normalizes_genre():
    tv = UserTasteVector(id="t", genres={"action": 0.1, "drama": 0.9})
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    candidates = [
        _make_candidate(id="a", title="A", original_title="A", genres=["drama"], vote_average=8.0, vote_count=1000),
        _make_candidate(id="b", title="B", original_title="B", genres=["action"], vote_average=8.0, vote_count=1000),
    ]
    results = scorer.score_batch(candidates)
    assert results[0].media.id == "a"


def test_score_batch_anime_uses_anilist_threshold():
    tv = UserTasteVector(id="t", genres={"action": 1.0})
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    candidates = [
        _make_candidate(
            id="al_low",
            source=MediaSource.ANILIST,
            media_type=MediaType.ANIME,
            title="Anime Low",
            original_title="Anime Low",
            genres=["action"],
            vote_average=7.2,
            vote_count=5000,
        ),
        _make_candidate(
            id="tmdb_ok",
            source=MediaSource.TMDB_MOVIE,
            media_type=MediaType.MOVIE,
            title="Movie OK",
            original_title="Movie OK",
            genres=["action"],
            vote_average=7.2,
            vote_count=5000,
        ),
    ]
    results = scorer.score_batch(candidates)
    result_ids = [r.media.id for r in results]
    assert "al_low" not in result_ids
    assert "tmdb_ok" in result_ids


def test_score_batch_returns_scored_media_items():
    tv = UserTasteVector(id="t", genres={"action": 1.0})
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    c = _make_candidate(genres=["action"], vote_average=9.0, vote_count=10000, runtime_minutes=90)
    results = scorer.score_batch([c])
    assert len(results) == 1
    scored = results[0]
    assert scored.media.id == c.id
    assert 0.0 <= scored.score <= 1.0
    assert scored.score_breakdown is not None
    assert -1.0 <= scored.score_breakdown.diversity <= 0.0
    assert 0.0 <= scored.score_breakdown.genre <= 1.0
    assert 0.0 <= scored.score_breakdown.keyword <= 1.0
    assert 0.0 <= scored.score_breakdown.mood <= 1.0
    assert 0.0 <= scored.score_breakdown.runtime <= 1.0
    assert 0.0 <= scored.score_breakdown.rating <= 1.0


def test_score_batch_empty_returns_empty():
    tv = UserTasteVector(id="t", genres={}, watched_ids=[])
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    results = scorer.score_batch([])
    assert results == []


def test_score_batch_all_filtered_returns_empty():
    tv = UserTasteVector(id="t", genres={}, watched_ids=["tmdb_1", "tmdb_2"])
    scorer = WeightedScorer(tv, None, TimeSlot.MEDIUM, "afternoon", [])
    candidates = [
        _make_candidate(id="tmdb_1", title="W1", original_title="W1", genres=["action"]),
        _make_candidate(id="tmdb_2", title="W2", original_title="W2", genres=["action"]),
    ]
    results = scorer.score_batch(candidates)
    assert results == []


# ── ScoreBreakdown constraints ────────────────────────────────


def test_score_breakdown_diversity_range():
    from app.models.recommendation import ScoreBreakdown
    breakdown = ScoreBreakdown(
        genre=0.5,
        keyword=0.5,
        mood=0.5,
        runtime=0.5,
        rating=0.5,
        diversity=-0.2,
    )
    assert breakdown.diversity == -0.2

    breakdown = ScoreBreakdown(
        genre=0.5,
        keyword=0.5,
        mood=0.5,
        runtime=0.5,
        rating=0.5,
        diversity=0.0,
    )
    assert breakdown.diversity == 0.0

    breakdown = ScoreBreakdown(
        genre=0.5,
        keyword=0.5,
        mood=0.5,
        runtime=0.5,
        rating=0.5,
        diversity=-1.0,
    )
    assert breakdown.diversity == -1.0
