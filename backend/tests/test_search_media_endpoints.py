"""Integration tests for search and media detail endpoints with mocked services."""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.models.media import MediaItem, MediaSource, MediaType
from app.models.taste import UserTasteVector
from app.storage.file_store import FileStore


def _make_media_item(
    composite_id: str,
    title: str,
    genres: list[str] | None = None,
    source: MediaSource = MediaSource.TMDB_MOVIE,
    media_type: MediaType = MediaType.MOVIE,
    **kwargs,
) -> MediaItem:
    defaults = dict(
        id=composite_id,
        source=source,
        title=title,
        original_title=title,
        genres=genres or [],
        media_type=media_type,
        vote_average=8.0,
        vote_count=1000,
        popularity=100.0,
    )
    defaults.update(kwargs)
    return MediaItem(**defaults)


@pytest.fixture
def mock_services(monkeypatch):
    mock_tmdb = MagicMock()
    mock_tmdb.initialize = AsyncMock()
    mock_tmdb.close = AsyncMock()
    mock_tmdb.search_multi = AsyncMock(return_value=[])
    mock_tmdb.get_movie_detail = AsyncMock(return_value=None)
    mock_tmdb.get_tv_detail = AsyncMock(return_value=None)

    mock_anilist = MagicMock()
    mock_anilist.search = AsyncMock(return_value=[])
    mock_anilist.get_detail = AsyncMock(return_value=None)
    mock_anilist.close = AsyncMock()

    app.state.tmdb = mock_tmdb
    app.state.anilist = mock_anilist
    yield mock_tmdb, mock_anilist


@pytest.fixture
def clean_file_store(tmp_path, monkeypatch):
    test_dir = tmp_path / "data"
    monkeypatch.setattr("app.storage.file_store.settings.storage_dir", str(test_dir))
    store = FileStore()
    monkeypatch.setattr("app.routers.taste.file_store", store)
    return store


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ── GET /api/search/multi ────────────────────────────────────


@pytest.mark.asyncio
async def test_search_success(mock_services):
    tmdb, anilist = mock_services
    tmdb.search_multi.return_value = [
        _make_media_item("tmdb_1", "Inception", genres=["action", "sci-fi"]),
        _make_media_item("tmdb_2", "Inception 2", genres=["action"]),
    ]
    anilist.search.return_value = [
        _make_media_item("al_1", "Inception: The Anime", genres=["anime"], source=MediaSource.ANILIST, media_type=MediaType.ANIME),
    ]

    async with _client() as client:
        resp = await client.get("/api/search/multi?q=inception&page=1")

    assert resp.status_code == 200
    body = resp.json()
    assert body["query"] == "inception"
    assert body["total_results"] == 3
    assert len(body["results"]) >= 1
    assert any(r["id"] == "tmdb_1" for r in body["results"])


@pytest.mark.asyncio
async def test_search_deduplication(mock_services):
    tmdb, anilist = mock_services
    tmdb.search_multi.return_value = [
        _make_media_item("tmdb_1", "Interstellar", genres=["sci-fi"]),
    ]
    anilist.search.return_value = [
        _make_media_item("al_1", "Interstellar", genres=["sci-fi"], source=MediaSource.ANILIST, media_type=MediaType.ANIME),
        _make_media_item("al_2", "Another Anime", genres=["drama"], source=MediaSource.ANILIST, media_type=MediaType.ANIME),
    ]

    async with _client() as client:
        resp = await client.get("/api/search/multi?q=interstellar&page=1")

    assert resp.status_code == 200
    body = resp.json()
    # "Interstellar" from AniList should be deduped, only "Another Anime" remains
    anilist_ids = [r["id"] for r in body["results"] if r["id"].startswith("al_")]
    assert len(anilist_ids) == 1
    assert anilist_ids[0] == "al_2"


@pytest.mark.asyncio
async def test_search_validation_too_short(mock_services):
    async with _client() as client:
        resp = await client.get("/api/search/multi?q=a&page=1")
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_search_validation_too_long(mock_services):
    async with _client() as client:
        resp = await client.get("/api/search/multi?q=" + "x" * 101 + "&page=1")
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_search_partial_failure_tmdb(mock_services):
    tmdb, anilist = mock_services
    tmdb.search_multi.side_effect = Exception("TMDB down")
    anilist.search.return_value = [
        _make_media_item("al_1", "Solo AniList", source=MediaSource.ANILIST, media_type=MediaType.ANIME),
    ]

    async with _client() as client:
        resp = await client.get("/api/search/multi?q=solo&page=1")

    assert resp.status_code == 200
    body = resp.json()
    assert body["total_results"] == 1


@pytest.mark.asyncio
async def test_search_both_failures(mock_services):
    tmdb, anilist = mock_services
    tmdb.search_multi.side_effect = Exception("TMDB down")
    anilist.search.side_effect = Exception("AniList down")

    async with _client() as client:
        resp = await client.get("/api/search/multi?q=nothing&page=1")

    assert resp.status_code == 502


# ── GET /api/media/* ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_media_movie_detail_success(mock_services):
    tmdb, anilist = mock_services
    tmdb.get_movie_detail.return_value = _make_media_item(
        "tmdb_550", "Fight Club", genres=["drama", "thriller"],
        cast=["Brad Pitt", "Edward Norton"], director="David Fincher",
        year=1999,
    )

    async with _client() as client:
        resp = await client.get("/api/media/movie/550")

    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Fight Club"
    assert "Brad Pitt" in body["cast"]
    assert body["director"] == "David Fincher"
    assert body["year"] == 1999


@pytest.mark.asyncio
async def test_media_movie_not_found(mock_services):
    tmdb, anilist = mock_services
    tmdb.get_movie_detail.return_value = None

    async with _client() as client:
        resp = await client.get("/api/media/movie/99999999")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_media_tv_detail_success(mock_services):
    tmdb, anilist = mock_services
    tmdb.get_tv_detail.return_value = _make_media_item(
        "tmdb_1399", "Game of Thrones",
        source=MediaSource.TMDB_TV, media_type=MediaType.TV,
        genres=["drama", "fantasy"], episode_count=73,
    )

    async with _client() as client:
        resp = await client.get("/api/media/tv/1399")

    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Game of Thrones"
    assert body["episode_count"] == 73


@pytest.mark.asyncio
async def test_media_anime_detail_success(mock_services):
    tmdb, anilist = mock_services
    anilist.get_detail.return_value = _make_media_item(
        "al_1", "Attack on Titan",
        source=MediaSource.ANILIST, media_type=MediaType.ANIME,
        genres=["action", "anime"], studio="WIT Studio", year=2013,
    )

    async with _client() as client:
        resp = await client.get("/api/media/anime/1")

    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Attack on Titan"
    assert body["studio"] == "WIT Studio"


@pytest.mark.asyncio
async def test_media_invalid_id(mock_services):
    async with _client() as client:
        resp = await client.get("/api/media/movie/0")
    assert resp.status_code == 422  # gt=0

    async with _client() as client:
        resp = await client.get("/api/media/movie/-1")
    assert resp.status_code == 422


# ── POST /api/taste/{id}/youtube ─────────────────────────────


@pytest.mark.asyncio
async def test_youtube_import_success(mock_services, clean_file_store):
    vector = UserTasteVector(
        id=str(uuid.uuid4()),
        genres={"action": 0.5},
        favourites=["tmdb_1", "tmdb_2", "tmdb_3", "tmdb_4", "tmdb_5"],
    )
    clean_file_store.save_vector(vector)

    json_content = '[{"title": "Best Action Movies 2024", "subtitles": [{"name": "MovieClips"}], "time": "2024-05-15T12:00:00Z"}]'

    async with _client() as client:
        resp = await client.post(
            f"/api/taste/{vector.id}/youtube",
            files={"file": ("history.json", json_content.encode("utf-8"), "application/json")},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["total_videos_parsed"] == 1


@pytest.mark.asyncio
async def test_youtube_import_missing_vector(mock_services, clean_file_store):
    valid_uuid = str(uuid.uuid4())
    async with _client() as client:
        resp = await client.post(
            f"/api/taste/{valid_uuid}/youtube",
            files={"file": ("history.json", b"[]", "application/json")},
        )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_youtube_import_invalid_uuid(mock_services, clean_file_store):
    async with _client() as client:
        resp = await client.post(
            "/api/taste/bad-uuid/youtube",
            files={"file": ("history.json", b"[]", "application/json")},
        )
    assert resp.status_code == 404
