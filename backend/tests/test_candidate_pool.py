import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport

from app.models.media import MediaItem, MediaType, MediaSource
from app.services.candidate_pool import CandidatePool
from app.services.tmdb_service import TMDBService
from app.services.anilist_service import AniListService


@pytest.fixture(autouse=True)
def _force_live_mode(monkeypatch):
    """Most pool tests exercise the live TMDB/AniList path. Force live mode so
    they don't short-circuit to the demo offline catalog (no key in CI)."""
    stub = MagicMock()
    stub.has_tmdb = True
    monkeypatch.setattr("app.services.candidate_pool.settings", stub)


def _create_mock_item(
    id: str,
    title: str,
    source: MediaSource,
    tmdb_id: int | None = None,
    anilist_id: int | None = None,
) -> MediaItem:
    return MediaItem(
        id=id,
        source=source,
        tmdb_id=tmdb_id,
        anilist_id=anilist_id,
        title=title,
        original_title=title,
        overview="Sample overview",
        media_type=MediaType.MOVIE if source != MediaSource.ANILIST else MediaType.ANIME,
    )


@pytest.fixture
def mock_tmdb():
    service = MagicMock(spec=TMDBService)
    service.get_full_candidate_pool = AsyncMock(return_value=[])
    service.initialize = AsyncMock()
    service.close = AsyncMock()
    service._movie_genre_map = {28: "Action"}
    return service


@pytest.fixture
def mock_anilist():
    service = MagicMock(spec=AniListService)
    service.get_trending = AsyncMock(return_value=[])
    service.get_top_rated = AsyncMock(return_value=[])
    service.close = AsyncMock()
    return service


def test_candidate_pool_init(mock_tmdb, mock_anilist):
    pool = CandidatePool(mock_tmdb, mock_anilist)
    assert pool.tmdb == mock_tmdb
    assert pool.anilist == mock_anilist
    assert len(pool.candidates) == 0
    assert pool.last_refresh is None


@pytest.mark.asyncio
async def test_candidate_pool_refresh_success(mock_tmdb, mock_anilist):
    tmdb_items = [
        _create_mock_item("tmdb_1", "Movie One", MediaSource.TMDB_MOVIE, tmdb_id=1),
        _create_mock_item("tmdb_2", "TV Show Two", MediaSource.TMDB_TV, tmdb_id=2),
    ]
    anilist_trending = [
        _create_mock_item("al_10", "Anime One", MediaSource.ANILIST, anilist_id=10),
    ]
    anilist_top = [
        _create_mock_item("al_11", "Anime Two", MediaSource.ANILIST, anilist_id=11),
    ]
    mock_tmdb.get_full_candidate_pool.return_value = tmdb_items
    mock_anilist.get_trending.return_value = anilist_trending
    mock_anilist.get_top_rated.return_value = anilist_top

    pool = CandidatePool(mock_tmdb, mock_anilist)
    await pool.refresh()

    assert len(pool.candidates) == 4
    assert pool.last_refresh is not None
    assert mock_tmdb.get_full_candidate_pool.call_count == 1
    assert mock_anilist.get_trending.call_count == 2
    assert mock_anilist.get_top_rated.call_count == 2


@pytest.mark.asyncio
async def test_candidate_pool_exact_deduplication(mock_tmdb, mock_anilist):
    item1 = _create_mock_item("tmdb_1", "Movie One", MediaSource.TMDB_MOVIE, tmdb_id=1)

    mock_tmdb.get_full_candidate_pool.return_value = [item1, item1]
    mock_anilist.get_trending.return_value = [
        _create_mock_item("al_10", "Anime One", MediaSource.ANILIST, anilist_id=10),
        _create_mock_item("al_10", "Anime One", MediaSource.ANILIST, anilist_id=10),
    ]
    mock_anilist.get_top_rated.return_value = []

    pool = CandidatePool(mock_tmdb, mock_anilist)
    await pool.refresh()

    assert len(pool.candidates) == 2
    ids = {item.id for item in pool.candidates}
    assert ids == {"tmdb_1", "al_10"}


@pytest.mark.asyncio
async def test_candidate_pool_fuzzy_title_deduplication(mock_tmdb, mock_anilist):
    tmdb_item = _create_mock_item("tmdb_100", "Spirited Away", MediaSource.TMDB_MOVIE, tmdb_id=100)
    al_item = _create_mock_item("al_200", "Spirited Away", MediaSource.ANILIST, anilist_id=200)

    mock_tmdb.get_full_candidate_pool.return_value = [tmdb_item]
    mock_anilist.get_trending.return_value = [al_item]
    mock_anilist.get_top_rated.return_value = []

    pool = CandidatePool(mock_tmdb, mock_anilist)
    await pool.refresh()

    assert len(pool.candidates) == 1
    retained_item = pool.candidates[0]
    assert retained_item.id == "al_200"
    assert retained_item.tmdb_id == 100


@pytest.mark.asyncio
async def test_candidate_pool_get_candidates_exclusions(mock_tmdb, mock_anilist):
    items = [
        _create_mock_item("tmdb_1", "Movie One", MediaSource.TMDB_MOVIE, tmdb_id=1),
        _create_mock_item("tmdb_2", "Movie Two", MediaSource.TMDB_MOVIE, tmdb_id=2),
        _create_mock_item("tmdb_3", "Movie Three", MediaSource.TMDB_MOVIE, tmdb_id=3),
    ]
    mock_tmdb.get_full_candidate_pool.return_value = items
    mock_anilist.get_trending.return_value = []
    mock_anilist.get_top_rated.return_value = []

    pool = CandidatePool(mock_tmdb, mock_anilist)
    await pool.refresh()

    res = pool.get_candidates(exclude_ids=["tmdb_2"])
    assert len(res) == 2
    assert {r.id for r in res} == {"tmdb_1", "tmdb_3"}


@pytest.mark.asyncio
async def test_main_lifespan_integration(monkeypatch):
    monkeypatch.setattr("app.config.settings.tmdb_api_key", "test_key")

    mock_tmdb_instance = MagicMock(spec=TMDBService)
    mock_tmdb_instance.initialize = AsyncMock()
    mock_tmdb_instance.get_full_candidate_pool = AsyncMock(return_value=[])
    mock_tmdb_instance.close = AsyncMock()
    mock_tmdb_instance._movie_genre_map = {28: "Action"}

    mock_anilist_instance = MagicMock(spec=AniListService)
    mock_anilist_instance.get_trending = AsyncMock(return_value=[])
    mock_anilist_instance.get_top_rated = AsyncMock(return_value=[])
    mock_anilist_instance.close = AsyncMock()

    from app.services.tmdb_service import TMDBService as RealTMDB
    from app.services.anilist_service import AniListService as RealAniList

    with patch.object(RealTMDB, "__new__", return_value=mock_tmdb_instance), \
         patch.object(RealAniList, "__new__", return_value=mock_anilist_instance):

        from app.main import app

        transport = ASGITransport(app=app)
        async with app.router.lifespan_context(app):
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                assert app.state.tmdb == mock_tmdb_instance
                assert app.state.anilist == mock_anilist_instance
                assert isinstance(app.state.pool, CandidatePool)

                response = await client.get("/api/health")
                assert response.status_code == 200
                data = response.json()
                assert data["status"] == "ok"
                # Live sources are mocked empty, so the pool falls back to the
                # bundled offline catalog rather than being empty.
                assert data["candidate_pool_size"] >= 30

                status_resp = await client.get("/api/status")
                assert status_resp.status_code == 200
                status_data = status_resp.json()
                assert status_data["catalog"]["tmdb_genres_loaded"] is True
                assert "llm" in status_data
