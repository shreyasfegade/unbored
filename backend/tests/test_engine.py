"""Tests for the content-based recommendation engine (BM25 + kNN/centroid + tone + MMR)."""

import pytest

from app.engine.content import ContentIndex, cosine
from app.engine.engine import RecommendationEngine, quality_prior, runtime_fit
from app.engine.tone import mood_fit, tone_vector
from app.models.media import MediaItem, MediaSource, MediaType
from app.models.mood import ConfidenceLevel, TimeSlot


def make_item(
    id: str,
    title: str,
    genres: list[str],
    *,
    keywords: list[str] | None = None,
    overview: str = "",
    runtime: int | None = 110,
    rating: float = 7.8,
    votes: int = 2000,
    mtype: MediaType = MediaType.MOVIE,
    source: MediaSource = MediaSource.TMDB_MOVIE,
) -> MediaItem:
    return MediaItem(
        id=id, source=source, title=title, original_title=title, overview=overview,
        genres=genres, keywords=keywords or [], vote_average=rating, vote_count=votes,
        runtime_minutes=runtime, media_type=mtype,
    )


# ── content / BM25 ──────────────────────────────────────────


def test_cosine_identical_is_one():
    items = [
        make_item("a", "Inception", ["action", "sci-fi"], keywords=["dream", "heist"],
                  overview="A thief enters dreams to plant an idea."),
        make_item("b", "Tenet", ["action", "sci-fi"], keywords=["time", "spy"]),
    ]
    idx = ContentIndex(items)
    assert cosine(idx.vector("a"), idx.vector("a")) == pytest.approx(1.0, abs=1e-6)
    assert 0.0 <= cosine(idx.vector("a"), idx.vector("b")) < 1.0


def test_relevance_prefers_similar_content():
    liked = [
        make_item("L1", "Heat", ["crime", "thriller"], keywords=["heist", "neo-noir"],
                  overview="A detective hunts a crew of professional bank robbers."),
        make_item("L2", "Sicario", ["crime", "thriller"], keywords=["cartel", "tense"],
                  overview="An idealistic agent is drawn into a brutal cartel war."),
    ]
    near = make_item("C1", "The Town", ["crime", "thriller"], keywords=["heist", "tense"],
                     overview="A career bank robber tries to leave the life behind.")
    far = make_item("C2", "Paddington", ["family", "comedy"], keywords=["wholesome", "bear"],
                    overview="A polite bear from Peru moves in with a London family.")
    idx = ContentIndex(liked + [near, far])
    centroid = idx.centroid(["L1", "L2"])
    lv = idx.liked_vectors(["L1", "L2"])
    assert idx.relevance("C1", centroid, lv) > idx.relevance("C2", centroid, lv)


def test_knn_preserves_split_taste():
    # User loves horror AND rom-coms — centroid alone would wash both out.
    liked = [
        make_item("H1", "Hereditary", ["horror"], keywords=["dread", "grief"], overview="A family unravels after a death."),
        make_item("H2", "The Witch", ["horror"], keywords=["dread", "folk"], overview="A family faces evil in the woods."),
        make_item("R1", "Notting Hill", ["romance", "comedy"], keywords=["love"], overview="A bookseller falls for a film star."),
        make_item("R2", "About Time", ["romance", "comedy"], keywords=["love"], overview="A man who can time travel finds love."),
    ]
    horror_cand = make_item("HC", "Midsommar", ["horror"], keywords=["dread", "folk"], overview="A grieving woman joins a sinister festival.")
    neutral = make_item("NC", "Planet Earth", ["documentary"], keywords=["nature"], overview="A documentary about wildlife and landscapes.")
    idx = ContentIndex(liked + [horror_cand, neutral])
    centroid = idx.centroid(["H1", "H2", "R1", "R2"])
    lv = idx.liked_vectors(["H1", "H2", "R1", "R2"])
    # A candidate matching ONE taste cluster (horror) must beat one matching
    # neither, even though the centroid is split across horror + rom-com.
    assert idx.relevance("HC", centroid, lv) > idx.relevance("NC", centroid, lv)


# ── tone / mood ─────────────────────────────────────────────


def test_tone_vector_in_range():
    item = make_item("x", "Mad Max", ["action", "adventure"], keywords=["high-octane"])
    vec = tone_vector(item)
    assert len(vec) == 5 and all(0.0 <= v <= 1.0 for v in vec)


def test_mood_fit_matches_expected_mood():
    comedy = make_item("c", "Superbad", ["comedy"], keywords=["funny", "hilarious"])
    horror = make_item("h", "Sinister", ["horror"], keywords=["dread", "brutal"])
    assert mood_fit(comedy, "want_to_laugh") > mood_fit(horror, "want_to_laugh")
    assert mood_fit(horror, "thrilled") > mood_fit(comedy, "thrilled")


def test_mood_fit_none_is_neutral():
    assert mood_fit(make_item("a", "X", ["drama"]), None) == 0.5


# ── runtime / quality ───────────────────────────────────────


def test_runtime_fit_peaks_at_center():
    short = make_item("s", "Short", ["comedy"], runtime=25)
    long = make_item("l", "Long", ["drama"], runtime=170)
    assert runtime_fit(short, TimeSlot.SHORT) > runtime_fit(long, TimeSlot.SHORT)
    assert runtime_fit(long, TimeSlot.LONG) > runtime_fit(short, TimeSlot.LONG)


def test_quality_prior_rewards_rating_not_just_votes():
    high_rated_low_votes = make_item("a", "Gem", ["drama"], rating=8.6, votes=90)
    mid_rated_many_votes = make_item("b", "Meh", ["drama"], rating=7.0, votes=5000)
    # The old engine penalised the gem; the Bayesian prior should not invert them.
    assert quality_prior(high_rated_low_votes) > 0.2
    assert quality_prior(make_item("c", "Great", ["drama"], rating=8.6, votes=8000)) > quality_prior(mid_rated_many_votes)


# ── engine end to end ───────────────────────────────────────


def _catalog() -> list[MediaItem]:
    return [
        make_item("L1", "Whiplash", ["drama", "music"], keywords=["obsession", "jazz"], overview="A drummer is pushed by a brutal teacher.", rating=8.4),
        make_item("L2", "Black Swan", ["drama", "thriller"], keywords=["obsession", "ballet"], overview="A ballerina loses herself in a role.", rating=8.0),
        make_item("c_drama", "The Wrestler", ["drama"], keywords=["obsession", "comeback"], overview="An aging wrestler chases one last match.", rating=7.9, runtime=109),
        make_item("c_comedy", "Booksmart", ["comedy"], keywords=["funny", "friendship"], overview="Two overachievers cram a lifetime of fun into one night.", rating=7.1, runtime=102),
        make_item("c_horror", "It Follows", ["horror"], keywords=["dread", "atmospheric"], overview="A curse passes between people.", rating=7.0, runtime=100),
        make_item("c_action", "John Wick", ["action", "thriller"], keywords=["revenge", "high-octane"], overview="A hitman comes out of retirement.", rating=7.4, runtime=101),
        make_item("c_anime", "Your Lie in April", ["drama", "music"], keywords=["emotional"], overview="A pianist rediscovers music.", rating=8.6, runtime=24, mtype=MediaType.ANIME, source=MediaSource.ANILIST),
    ]


def test_engine_recommends_relevant_pick():
    items = _catalog()
    idx = ContentIndex(items)
    engine = RecommendationEngine(idx, liked_ids=["L1", "L2"], mood="want_to_cry", time_available=TimeSlot.LONG)
    candidates = [i for i in items if i.id not in {"L1", "L2"}]
    result = engine.recommend(candidates)
    assert result is not None
    # The drama/music-obsession candidates should rank above pure comedy/action.
    top_ids = [s.media.id for s in result.ranked[:2]]
    assert "c_drama" in top_ids or "c_anime" in top_ids
    assert len(result.alternates) == 2
    assert result.confidence in {ConfidenceLevel.HIGH, ConfidenceLevel.STRONG, ConfidenceLevel.MODERATE}


def test_engine_media_type_filter():
    items = _catalog()
    idx = ContentIndex(items)
    engine = RecommendationEngine(idx, liked_ids=["L1"], mood=None, time_available=TimeSlot.SHORT, media_type="anime")
    candidates = [i for i in items if i.id != "L1"]
    result = engine.recommend(candidates)
    assert result is not None
    assert result.primary.media.media_type == MediaType.ANIME


def test_engine_alternates_are_distinct_from_primary():
    items = _catalog()
    idx = ContentIndex(items)
    engine = RecommendationEngine(idx, liked_ids=["L1", "L2"], mood="happy_energetic", time_available=TimeSlot.MEDIUM)
    result = engine.recommend([i for i in items if i.id not in {"L1", "L2"}])
    assert result is not None
    ids = [result.primary.media.id] + [a.media.id for a in result.alternates]
    assert len(set(ids)) == len(ids)  # no duplicates
