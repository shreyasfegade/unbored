"""Integration tests for taste endpoints using FastAPI TestClient with mocked services."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.models.media import MediaItem, MediaSource, MediaType
from app.models.taste import UserTasteVector, PacingPreference
from app.storage.file_store import FileStore


def _clean_uuid() -> str:
    return str(uuid.uuid4())


def _make_media_item(
    id: str,
    title: str,
    genres: list[str],
    keywords: list[str] | None = None,
    runtime_minutes: int | None = None,
    source: MediaSource = MediaSource.TMDB_MOVIE,
    media_type: MediaType = MediaType.MOVIE,
) -> MediaItem:
    return MediaItem(
        id=id,
        source=source,
        media_type=media_type,
        title=title,
        original_title=title,
        genres=genres,
        keywords=keywords if keywords is not None else [],
        vote_average=8.0,
        vote_count=1000,
        runtime_minutes=runtime_minutes,
        popularity=50.0,
    )


@pytest.fixture
def mock_services(monkeypatch):
    """Mock TMDB, AniList, pool, and file store for isolated testing."""
    mock_tmdb = MagicMock()
    mock_tmdb.initialize = AsyncMock()
    mock_tmdb.close = AsyncMock()
    mock_tmdb.get_movie_detail = AsyncMock(return_value=None)
    mock_tmdb.get_tv_detail = AsyncMock(return_value=None)
    mock_tmdb.get_movie_keywords = AsyncMock(return_value=[])
    mock_tmdb.get_tv_keywords = AsyncMock(return_value=[])

    mock_anilist = MagicMock()
    mock_anilist.get_detail = AsyncMock(return_value=None)
    mock_anilist.close = AsyncMock()

    mock_pool = MagicMock()
    mock_pool.candidates = []
    mock_pool.refresh = AsyncMock()
    mock_pool.get_candidates = MagicMock(return_value=[])

    # Set on app.state directly — bypasses lifespan
    app.state.tmdb = mock_tmdb
    app.state.anilist = mock_anilist
    app.state.pool = mock_pool

    return mock_tmdb, mock_anilist, mock_pool


@pytest.fixture
def clean_file_store(tmp_path, monkeypatch):
    """Provide a clean FileStore pointed at tmp_path."""
    test_dir = tmp_path / "data"
    monkeypatch.setattr("app.storage.file_store.settings.storage_dir", str(test_dir))
    store = FileStore()
    monkeypatch.setattr("app.routers.taste.file_store", store)
    return store


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ── POST /api/taste ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_taste_returns_201(mock_services, clean_file_store):
    items = [_make_media_item(f"tmdb_{i}", f"Movie {i}", ["action", "drama"],
                              runtime_minutes=120) for i in range(5)]
    mock_services[0].get_movie_detail = AsyncMock(side_effect=items)

    async with _client() as client:
        response = await client.post("/api/taste", json={
            "favourite_ids": [f"tmdb_{i}" for i in range(5)],
        })

    assert response.status_code == 201
    body = response.json()
    assert "id" in body
    assert "genres" in body
    assert len(body["favourites"]) == 5
    assert body["onboarding_completed"] is True


@pytest.mark.asyncio
async def test_create_taste_returns_422_too_few_favourites(mock_services, clean_file_store):
    async with _client() as client:
        response = await client.post("/api/taste", json={
            "favourite_ids": ["tmdb_0", "tmdb_1"],
        })

    assert response.status_code == 422
    body = response.json()
    assert body["error_code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_create_taste_returns_422_too_many_favourites(mock_services, clean_file_store):
    async with _client() as client:
        response = await client.post("/api/taste", json={
            "favourite_ids": [f"tmdb_{i}" for i in range(10)],
        })

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_taste_returns_422_invalid_json(mock_services, clean_file_store):
    async with _client() as client:
        response = await client.post("/api/taste", content="not json", headers={"Content-Type": "application/json"})

    assert response.status_code in (422, 400)


# ── GET /api/taste/{vector_id} ───────────────────────────────


@pytest.mark.asyncio
async def test_get_taste_returns_200(mock_services, clean_file_store):
    vector = UserTasteVector(
        id=_clean_uuid(),
        genres={"action": 0.8},
        keywords={"epic": 0.5},
        favourites=["tmdb_0", "tmdb_1", "tmdb_2", "tmdb_3", "tmdb_4"],
    )
    clean_file_store.save_vector(vector)

    async with _client() as client:
        response = await client.get(f"/api/taste/{vector.id}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == vector.id
    assert body["genres"]["action"] == 0.8


@pytest.mark.asyncio
async def test_get_taste_returns_404_not_found(mock_services, clean_file_store):
    valid_uuid = _clean_uuid()

    async with _client() as client:
        response = await client.get(f"/api/taste/{valid_uuid}")

    assert response.status_code == 404
    body = response.json()
    assert body["error_code"] == "TASTE_VECTOR_NOT_FOUND"


@pytest.mark.asyncio
async def test_get_taste_returns_404_invalid_uuid(mock_services, clean_file_store):
    async with _client() as client:
        response = await client.get("/api/taste/not-a-uuid")

    assert response.status_code == 404
    body = response.json()
    assert body["error_code"] == "TASTE_VECTOR_NOT_FOUND"


# ── PUT /api/taste/{vector_id} ───────────────────────────────


@pytest.mark.asyncio
async def test_update_taste_returns_200(mock_services, clean_file_store):
    # Need 5 existing + 2 new = 7 items for the mock
    items = [_make_media_item(f"tmdb_{i}", f"Movie {i}", ["drama"], runtime_minutes=120) for i in range(7)]
    mock_services[0].get_movie_detail = AsyncMock(side_effect=items)

    vector = UserTasteVector(
        id=_clean_uuid(),
        genres={"drama": 1.0},
        keywords={},
        favourites=[f"tmdb_{i}" for i in range(5)],
        watched_ids=[f"tmdb_{i}" for i in range(5)],
    )
    clean_file_store.save_vector(vector)

    async with _client() as client:
        response = await client.put(f"/api/taste/{vector.id}", json={
            "add_favourites": [f"tmdb_{i}" for i in range(5, 7)],
        })

    assert response.status_code == 200
    body = response.json()
    assert len(body["favourites"]) == 7


@pytest.mark.asyncio
async def test_update_taste_returns_200_manual_overrides(mock_services, clean_file_store):
    items = [_make_media_item(f"tmdb_{i}", f"Movie {i}", ["drama"], runtime_minutes=120) for i in range(5)]
    mock_services[0].get_movie_detail = AsyncMock(side_effect=items)

    vector = UserTasteVector(
        id=_clean_uuid(),
        genres={"drama": 1.0},
        pacing_preference=PacingPreference.FAST,
        emotional_intensity=0.5,
        favourites=[f"tmdb_{i}" for i in range(5)],
        watched_ids=[f"tmdb_{i}" for i in range(5)],
    )
    clean_file_store.save_vector(vector)

    async with _client() as client:
        response = await client.put(f"/api/taste/{vector.id}", json={
            "pacing_preference": "slow",
            "emotional_intensity": 0.9,
            "darkness_preference": 0.8,
        })

    assert response.status_code == 200
    body = response.json()
    assert body["pacing_preference"] == "slow"
    assert body["emotional_intensity"] == 0.9
    assert body["darkness_preference"] == 0.8


@pytest.mark.asyncio
async def test_update_taste_returns_422_empty_update(mock_services, clean_file_store):
    vector = UserTasteVector(
        id=_clean_uuid(),
        genres={"drama": 1.0},
        favourites=["tmdb_0", "tmdb_1", "tmdb_2", "tmdb_3", "tmdb_4"],
    )
    clean_file_store.save_vector(vector)

    async with _client() as client:
        response = await client.put(f"/api/taste/{vector.id}", json={})

    assert response.status_code == 422
    body = response.json()
    assert body["error_code"] == "VALIDATION_ERROR"
    assert "At least one field" in body["detail"]


@pytest.mark.asyncio
async def test_update_taste_returns_422_out_of_bounds_weight(mock_services, clean_file_store):
    vector = UserTasteVector(
        id=_clean_uuid(),
        genres={"drama": 1.0},
        favourites=["tmdb_0", "tmdb_1", "tmdb_2", "tmdb_3", "tmdb_4"],
    )
    clean_file_store.save_vector(vector)

    async with _client() as client:
        response = await client.put(f"/api/taste/{vector.id}", json={
            "genre_overrides": {"action": 1.5},
        })

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_update_taste_returns_404_invalid_uuid(mock_services, clean_file_store):
    async with _client() as client:
        response = await client.put("/api/taste/not-a-uuid", json={
            "pacing_preference": "fast",
        })

    assert response.status_code == 404
    body = response.json()
    assert body["error_code"] == "TASTE_VECTOR_NOT_FOUND"


@pytest.mark.asyncio
async def test_update_taste_returns_404_not_found(mock_services, clean_file_store):
    valid_uuid = _clean_uuid()

    async with _client() as client:
        response = await client.put(f"/api/taste/{valid_uuid}", json={
            "pacing_preference": "fast",
        })

    assert response.status_code == 404
    body = response.json()
    assert body["error_code"] == "TASTE_VECTOR_NOT_FOUND"


@pytest.mark.asyncio
async def test_update_taste_returns_200_add_watched_ids(mock_services, clean_file_store):
    items = [_make_media_item(f"tmdb_{i}", f"Movie {i}", ["drama"], runtime_minutes=120) for i in range(5)]
    mock_services[0].get_movie_detail = AsyncMock(side_effect=items)

    vector = UserTasteVector(
        id=_clean_uuid(),
        genres={"drama": 1.0},
        favourites=[f"tmdb_{i}" for i in range(5)],
        watched_ids=[],
    )
    clean_file_store.save_vector(vector)

    async with _client() as client:
        response = await client.put(f"/api/taste/{vector.id}", json={
            "add_watched_ids": ["tmdb_100", "tmdb_200"],
        })

    assert response.status_code == 200
    body = response.json()
    assert "tmdb_100" in body["watched_ids"]
    assert "tmdb_200" in body["watched_ids"]
