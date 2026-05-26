import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.media import MediaItem, MediaType, MediaSource
from app.models.taste import (
    UserTasteVector,
    UpdateTasteRequest,
    PacingPreference,
    RuntimePreference,
)
from app.services.taste_builder import (
    TasteBuilder,
    NoRecommendationError,
    _parse_composite_id,
)


def _make_candidate(
    id: str,
    title: str,
    original_title: str,
    genres: list[str],
    keywords: list[str] | None = None,
    media_type: MediaType = MediaType.MOVIE,
    source: MediaSource = MediaSource.TMDB_MOVIE,
    runtime_minutes: int | None = None,
    vote_average: float = 8.0,
    vote_count: int = 1000,
    popularity: float = 0.0,
) -> MediaItem:
    return MediaItem(
        id=id,
        source=source,
        media_type=media_type,
        title=title,
        original_title=original_title,
        genres=genres,
        keywords=keywords if keywords is not None else [],
        runtime_minutes=runtime_minutes,
        vote_average=vote_average,
        vote_count=vote_count,
        popularity=popularity,
    )


def _make_tmdb_mock(return_items: list[MediaItem]) -> MagicMock:
    mock = MagicMock()
    mock.get_movie_detail = AsyncMock()
    mock.get_tv_detail = AsyncMock()
    mock.get_movie_keywords = AsyncMock(return_value=[])
    mock.get_tv_keywords = AsyncMock(return_value=[])

    async def get_movie_detail(movie_id):
        for item in return_items:
            if item.id == f"tmdb_{movie_id}" and item.source == MediaSource.TMDB_MOVIE:
                return item
        return None

    async def get_tv_detail(tv_id):
        for item in return_items:
            if item.id == f"tmdb_{tv_id}" and item.source == MediaSource.TMDB_TV:
                return item
        return None

    mock.get_movie_detail = AsyncMock(side_effect=get_movie_detail)
    mock.get_tv_detail = AsyncMock(side_effect=get_tv_detail)
    return mock


def _make_anilist_mock(return_items: list[MediaItem]) -> MagicMock:
    mock = MagicMock()

    async def get_detail(anilist_id):
        for item in return_items:
            if item.id == f"al_{anilist_id}":
                return item
        return None

    mock.get_detail = AsyncMock(side_effect=get_detail)
    return mock


def _make_pool_mock(candidates: list[MediaItem]) -> MagicMock:
    mock = MagicMock()
    mock.candidates = candidates
    return mock


# ── _parse_composite_id ──────────────────────────────────────


def test_parse_tmdb_movie():
    tmdb_id, anilist_id, source = _parse_composite_id("tmdb_movie_550")
    assert tmdb_id == 550
    assert anilist_id is None
    assert source == MediaSource.TMDB_MOVIE


def test_parse_tmdb_tv():
    tmdb_id, anilist_id, source = _parse_composite_id("tmdb_tv_1396")
    assert tmdb_id == 1396
    assert anilist_id is None
    assert source == MediaSource.TMDB_TV


def test_parse_anilist():
    tmdb_id, anilist_id, source = _parse_composite_id("anilist_16498")
    assert tmdb_id is None
    assert anilist_id == 16498
    assert source == MediaSource.ANILIST


def test_parse_short_tmdb():
    tmdb_id, anilist_id, source = _parse_composite_id("tmdb_155")
    assert tmdb_id == 155
    assert anilist_id is None
    assert source == MediaSource.TMDB_MOVIE


def test_parse_short_al():
    tmdb_id, anilist_id, source = _parse_composite_id("al_1535")
    assert tmdb_id is None
    assert anilist_id == 1535
    assert source == MediaSource.ANILIST


def test_parse_invalid():
    tmdb_id, anilist_id, source = _parse_composite_id("invalid")
    assert tmdb_id is None
    assert anilist_id is None
    assert source is None


# ── build_from_favourites ────────────────────────────────────


@pytest.mark.asyncio
async def test_build_generates_genre_weights():
    items = [
        _make_candidate(
            id="tmdb_155",
            title="Dark Knight",
            original_title="Dark Knight",
            genres=["action", "thriller", "drama"],
            keywords=["dark", "psychological"],
            runtime_minutes=152,
            source=MediaSource.TMDB_MOVIE,
        ),
        _make_candidate(
            id="tmdb_27205",
            title="Inception",
            original_title="Inception",
            genres=["action", "science fiction", "thriller"],
            keywords=["mind-bending", "complex narrative"],
            runtime_minutes=148,
            source=MediaSource.TMDB_MOVIE,
        ),
        _make_candidate(
            id="tmdb_603",
            title="Matrix",
            original_title="Matrix",
            genres=["action", "science fiction"],
            keywords=["mind-bending", "dystopia"],
            runtime_minutes=136,
            source=MediaSource.TMDB_MOVIE,
        ),
        _make_candidate(
            id="tmdb_157336",
            title="Interstellar",
            original_title="Interstellar",
            genres=["adventure", "drama", "science fiction"],
            keywords=["space", "emotional"],
            runtime_minutes=169,
            source=MediaSource.TMDB_MOVIE,
        ),
        _make_candidate(
            id="tmdb_120",
            title="LOTR",
            original_title="LOTR",
            genres=["adventure", "fantasy"],
            keywords=["epic", "journey"],
            runtime_minutes=178,
            source=MediaSource.TMDB_MOVIE,
        ),
    ]
    tmdb_mock = _make_tmdb_mock(items)
    anilist_mock = _make_anilist_mock([])
    pool_mock = _make_pool_mock([])

    builder = TasteBuilder(tmdb_mock, anilist_mock, pool_mock)
    favourite_ids = ["tmdb_155", "tmdb_27205", "tmdb_603", "tmdb_157336", "tmdb_120"]

    with patch("app.services.taste_builder.file_store.save_vector"):
        vector = await builder.build_from_favourites(favourite_ids)

    assert "action" in vector.genres
    assert "science fiction" in vector.genres
    assert len(vector.favourites) == 5
    assert len(vector.watched_ids) == 5
    assert vector.onboarding_completed is True
    assert vector.archetype_applied is not None  # Cold start should match an archetype


@pytest.mark.asyncio
async def test_build_pacing_fast():
    items = [
        _make_candidate(
            id=f"tmdb_{i}",
            title=f"Movie {i}",
            original_title=f"Movie {i}",
            genres=["action", "thriller"],
            keywords=[],
            runtime_minutes=120,
            source=MediaSource.TMDB_MOVIE,
        )
        for i in range(5)
    ]
    tmdb_mock = _make_tmdb_mock(items)
    anilist_mock = _make_anilist_mock([])
    pool_mock = _make_pool_mock([])

    builder = TasteBuilder(tmdb_mock, anilist_mock, pool_mock)
    ids = [item.id for item in items]

    with patch("app.services.taste_builder.file_store.save_vector"):
        vector = await builder.build_from_favourites(ids)

    assert vector.pacing_preference == PacingPreference.FAST


@pytest.mark.asyncio
async def test_build_runtime_median():
    items = [
        _make_candidate(
            id=f"tmdb_{i}",
            title=f"Movie {i}",
            original_title=f"Movie {i}",
            genres=["drama"],
            keywords=[],
            runtime_minutes=25 if i < 3 else 120,
            source=MediaSource.TMDB_MOVIE,
        )
        for i in range(5)
    ]
    tmdb_mock = _make_tmdb_mock(items)
    anilist_mock = _make_anilist_mock([])
    pool_mock = _make_pool_mock([])

    builder = TasteBuilder(tmdb_mock, anilist_mock, pool_mock)
    ids = [item.id for item in items]

    with patch("app.services.taste_builder.file_store.save_vector"):
        vector = await builder.build_from_favourites(ids)

    assert vector.runtime_preference == RuntimePreference.SHORT


@pytest.mark.asyncio
async def test_build_includes_anime():
    items = [
        _make_candidate(
            id=f"al_{1000 + i}",
            title=f"Anime {i}",
            original_title=f"Anime {i}",
            genres=["action", "animation"],
            keywords=["shonen"],
            media_type=MediaType.ANIME,
            source=MediaSource.ANILIST,
            runtime_minutes=24,
        )
        for i in range(5)
    ]
    tmdb_mock = _make_tmdb_mock([])
    anilist_mock = _make_anilist_mock(items)
    pool_mock = _make_pool_mock([])

    builder = TasteBuilder(tmdb_mock, anilist_mock, pool_mock)
    ids = [item.id for item in items]

    with patch("app.services.taste_builder.file_store.save_vector"):
        vector = await builder.build_from_favourites(ids)

    assert vector.animation_affinity == 1.0
    assert vector.genres.get("animation", 0) >= 0.5


@pytest.mark.asyncio
async def test_build_uses_pool_cache():
    pool_items = [
        _make_candidate(
            id="tmdb_155",
            title="Pool Item",
            original_title="Pool Item",
            genres=["action"],
            keywords=["pool-kw"],
            runtime_minutes=120,
            source=MediaSource.TMDB_MOVIE,
        ),
    ]
    tmdb_mock = _make_tmdb_mock([])
    anilist_mock = _make_anilist_mock([])
    pool_mock = _make_pool_mock(pool_items)

    builder = TasteBuilder(tmdb_mock, anilist_mock, pool_mock)

    with patch("app.services.taste_builder.file_store.save_vector"):
        await builder.build_from_favourites(["tmdb_155"])

    # TMDB should NOT have been called — pool had it with keywords
    tmdb_mock.get_movie_detail.assert_not_called()


@pytest.mark.asyncio
async def test_build_raises_on_empty():
    tmdb_mock = _make_tmdb_mock([])
    anilist_mock = _make_anilist_mock([])
    pool_mock = _make_pool_mock([])

    builder = TasteBuilder(tmdb_mock, anilist_mock, pool_mock)

    with pytest.raises(ValueError, match="No valid items"):
        await builder.build_from_favourites(["tmdb_999"])


# ── update_with_enrichment ───────────────────────────────────


@pytest.mark.asyncio
async def test_update_adds_new_favourites():
    existing_items = [
        _make_candidate(
            id=f"tmdb_{i}",
            title=f"Movie {i}",
            original_title=f"Movie {i}",
            genres=["action"],
            keywords=[],
            runtime_minutes=120,
            source=MediaSource.TMDB_MOVIE,
        )
        for i in range(5)
    ]
    new_items = [
        _make_candidate(
            id="tmdb_100",
            title="New Movie",
            original_title="New Movie",
            genres=["comedy"],
            keywords=["fun"],
            runtime_minutes=90,
            source=MediaSource.TMDB_MOVIE,
        ),
        _make_candidate(
            id="tmdb_101",
            title="New Movie 2",
            original_title="New Movie 2",
            genres=["comedy"],
            keywords=["fun"],
            runtime_minutes=100,
            source=MediaSource.TMDB_MOVIE,
        ),
    ]

    all_items = existing_items + new_items
    tmdb_mock = _make_tmdb_mock(all_items)
    anilist_mock = _make_anilist_mock([])
    pool_mock = _make_pool_mock([])

    builder = TasteBuilder(tmdb_mock, anilist_mock, pool_mock)

    vector = UserTasteVector(
        id="test-id",
        genres={"action": 1.0},
        keywords={},
        favourites=[item.id for item in existing_items],
        watched_ids=[item.id for item in existing_items],
    )

    request = UpdateTasteRequest(
        add_favourites=["tmdb_100", "tmdb_101"],
    )

    with patch("app.services.taste_builder.file_store.save_vector"):
        result = await builder.update_with_enrichment(vector, request)

    assert "comedy" in result.genres
    assert len(result.favourites) == 7
    assert "tmdb_100" in result.favourites


@pytest.mark.asyncio
async def test_update_applies_manual_overrides():
    items = [
        _make_candidate(
            id=f"tmdb_{i}",
            title=f"Movie {i}",
            original_title=f"Movie {i}",
            genres=["action"],
            keywords=[],
            runtime_minutes=120,
            source=MediaSource.TMDB_MOVIE,
        )
        for i in range(5)
    ]
    tmdb_mock = _make_tmdb_mock(items)
    anilist_mock = _make_anilist_mock([])
    pool_mock = _make_pool_mock([])

    builder = TasteBuilder(tmdb_mock, anilist_mock, pool_mock)

    vector = UserTasteVector(
        id="test-id",
        genres={"action": 1.0},
        keywords={},
        pacing_preference=PacingPreference.FAST,
        emotional_intensity=0.3,
        favourites=[item.id for item in items],
        watched_ids=[item.id for item in items],
    )

    request = UpdateTasteRequest(
        pacing_preference=PacingPreference.SLOW,
        emotional_intensity=0.8,
    )

    with patch("app.services.taste_builder.file_store.save_vector"):
        result = await builder.update_with_enrichment(vector, request)

    assert result.pacing_preference == PacingPreference.SLOW
    assert result.emotional_intensity == 0.8


@pytest.mark.asyncio
async def test_update_adds_watched_ids():
    items = [
        _make_candidate(
            id=f"tmdb_{i}",
            title=f"Movie {i}",
            original_title=f"Movie {i}",
            genres=["action"],
            keywords=[],
            runtime_minutes=120,
            source=MediaSource.TMDB_MOVIE,
        )
        for i in range(5)
    ]
    tmdb_mock = _make_tmdb_mock(items)
    anilist_mock = _make_anilist_mock([])
    pool_mock = _make_pool_mock([])

    builder = TasteBuilder(tmdb_mock, anilist_mock, pool_mock)

    vector = UserTasteVector(
        id="test-id",
        genres={"action": 1.0},
        keywords={},
        favourites=[item.id for item in items],
        watched_ids=[item.id for item in items],
    )

    request = UpdateTasteRequest(
        add_watched_ids=["tmdb_999"],
    )

    with patch("app.services.taste_builder.file_store.save_vector"):
        result = await builder.update_with_enrichment(vector, request)

    assert "tmdb_999" in result.watched_ids


@pytest.mark.asyncio
async def test_update_ensures_favourites_in_watched():
    items = [
        _make_candidate(
            id=f"tmdb_{i}",
            title=f"Movie {i}",
            original_title=f"Movie {i}",
            genres=["action"],
            keywords=[],
            runtime_minutes=120,
            source=MediaSource.TMDB_MOVIE,
        )
        for i in range(5)
    ]
    tmdb_mock = _make_tmdb_mock(items)
    anilist_mock = _make_anilist_mock([])
    pool_mock = _make_pool_mock([])

    builder = TasteBuilder(tmdb_mock, anilist_mock, pool_mock)

    # watched_ids is missing one of the favourites
    fav_ids = [item.id for item in items]
    vector = UserTasteVector(
        id="test-id",
        genres={"action": 1.0},
        keywords={},
        favourites=fav_ids,
        watched_ids=fav_ids[:3],  # Only 3 watched
    )

    request = UpdateTasteRequest()

    with patch("app.services.taste_builder.file_store.save_vector"):
        result = await builder.update_with_enrichment(vector, request)

    for fid in fav_ids:
        assert fid in result.watched_ids
