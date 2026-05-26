"""Integration tests for recommendation endpoints with mocked services."""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.models.media import MediaItem, MediaSource, MediaType
from app.models.mood import ConfidenceLevel, MoodType, TimeSlot
from app.models.recommendation import (
    ScoreBreakdown,
    ScoredMediaItem,
    WhyNowResult,
)
from app.models.taste import (
    PacingPreference,
    RecommendationHistoryEntry,
    RuntimePreference,
    UserTasteVector,
)
from app.storage.file_store import FileStore


def _clean_uuid() -> str:
    return str(uuid.uuid4())


def _make_media_item(
    composite_id: str,
    title: str,
    genres: list[str],
    keywords: list[str] | None = None,
    runtime_minutes: int | None = 120,
    vote_average: float = 8.0,
    vote_count: int = 1000,
    source: MediaSource = MediaSource.TMDB_MOVIE,
    media_type: MediaType = MediaType.MOVIE,
    popularity: float = 100.0,
    release_year: int | None = 2024,
) -> MediaItem:
    return MediaItem(
        id=composite_id,
        source=source,
        media_type=media_type,
        title=title,
        original_title=title,
        genres=genres,
        keywords=keywords if keywords is not None else [],
        vote_average=vote_average,
        vote_count=vote_count,
        runtime_minutes=runtime_minutes,
        popularity=popularity,
        release_year=release_year,
    )


def _make_scored_item(media: MediaItem, score: float = 0.85) -> ScoredMediaItem:
    return ScoredMediaItem(
        media=media,
        score=score,
        score_breakdown=ScoreBreakdown(
            genre=0.8, keyword=0.7, mood=0.6, runtime=0.9, rating=0.7, diversity=-0.1,
        ),
    )


@pytest.fixture
def mock_services(monkeypatch):
    """Mock TMDB, AniList, pool, and Gemini on app.state."""
    from app.routers import recommend as rec_module

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

    mock_gemini = MagicMock()
    mock_gemini.generate_why_now = AsyncMock(
        return_value=WhyNowResult(sentence="A solid pick for tonight.", source="gemini")
    )
    mock_gemini.close = AsyncMock()

    app.state.tmdb = mock_tmdb
    app.state.anilist = mock_anilist
    app.state.gemini_service = mock_gemini

    # Clear the in-memory recommendation log
    rec_module._recommendation_log.clear()

    yield mock_tmdb, mock_anilist, mock_gemini

    rec_module._recommendation_log.clear()


@pytest.fixture
def clean_file_store(tmp_path, monkeypatch):
    test_dir = tmp_path / "data"
    monkeypatch.setattr("app.storage.file_store.settings.storage_dir", str(test_dir))
    store = FileStore()
    monkeypatch.setattr("app.routers.recommend.file_store", store)
    # Also patch the taste router's reference
    monkeypatch.setattr("app.routers.taste.file_store", store)
    return store


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ── POST /api/recommend ──────────────────────────────────────


@pytest.mark.asyncio
async def test_recommend_success(mock_services, clean_file_store):
    """Full happy path: candidate pool has scored items, Gemini responds."""
    cand1 = _make_media_item("tmdb_100", "Test Movie", ["action", "thriller"], runtime_minutes=90)
    cand2 = _make_media_item("tmdb_200", "Another", ["drama"], runtime_minutes=80)
    cand3 = _make_media_item("tmdb_300", "Third", ["comedy"], runtime_minutes=85)

    pool = MagicMock()
    pool.candidates = [cand1, cand2, cand3]
    pool.refresh = AsyncMock()

    def _get_candidates(exclude_ids=None):
        exclude_set = set(exclude_ids) if exclude_ids else set()
        return [c for c in [cand1, cand2, cand3] if c.id not in exclude_set]

    pool.get_candidates = MagicMock(side_effect=_get_candidates)

    app.state.pool = pool

    vector = UserTasteVector(
        id=_clean_uuid(),
        genres={"action": 0.8, "drama": 0.5},
        keywords={"epic": 0.6},
        favourites=["tmdb_0", "tmdb_1", "tmdb_2", "tmdb_3", "tmdb_4"],
        watched_ids=["tmdb_0", "tmdb_1"],
    )
    clean_file_store.save_vector(vector)

    async with _client() as client:
        response = await client.post("/api/recommend", json={
            "taste_vector_id": vector.id,
            "mood": "happy_energetic",
            "time_available": "medium",
            "time_of_day": "evening",
            "excluded_ids": [],
        })

    assert response.status_code == 200
    body = response.json()
    assert body["primary"]["media"]["id"] in {"tmdb_100", "tmdb_200", "tmdb_300"}
    assert len(body["alternates"]) == 2
    assert "request_id" in body
    assert body["why_now"]["source"] == "gemini"
    assert body["confidence"] in {"high", "strong", "moderate"}

    # Verify history recorded
    updated = clean_file_store.get_vector(vector.id)
    assert len(updated.recommendation_history) == 1
    assert updated.recommendation_history[0].media_id == body["primary"]["media"]["id"]


@pytest.mark.asyncio
async def test_recommend_404_missing_vector(mock_services, clean_file_store):
    pool = app.state.pool = MagicMock()
    pool.get_candidates = MagicMock(return_value=[])
    pool.candidates = []
    pool.refresh = AsyncMock()

    valid_uuid = _clean_uuid()

    async with _client() as client:
        response = await client.post("/api/recommend", json={
            "taste_vector_id": valid_uuid,
            "mood": "happy_energetic",
            "time_available": "medium",
            "time_of_day": "evening",
            "excluded_ids": [],
        })

    assert response.status_code == 404
    assert response.json()["error_code"] == "TASTE_VECTOR_NOT_FOUND"


@pytest.mark.asyncio
async def test_recommend_404_invalid_uuid(mock_services, clean_file_store):
    pool = app.state.pool = MagicMock()
    pool.get_candidates = MagicMock(return_value=[])
    pool.candidates = []
    pool.refresh = AsyncMock()

    async with _client() as client:
        response = await client.post("/api/recommend", json={
            "taste_vector_id": "not-a-uuid",
            "mood": "happy_energetic",
            "time_available": "medium",
            "time_of_day": "evening",
            "excluded_ids": [],
        })

    assert response.status_code == 404
    assert response.json()["error_code"] == "TASTE_VECTOR_NOT_FOUND"


@pytest.mark.asyncio
async def test_recommend_422_missing_field(mock_services, clean_file_store):
    pool = app.state.pool = MagicMock()
    pool.get_candidates = MagicMock(return_value=[])
    pool.candidates = []
    pool.refresh = AsyncMock()

    async with _client() as client:
        response = await client.post("/api/recommend", json={
            "taste_vector_id": _clean_uuid(),
        })

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_recommend_fallback_when_no_candidates(mock_services, clean_file_store):
    """When 0 candidates match, fallback is returned with MODERATE confidence."""
    pool = app.state.pool = MagicMock()
    pool.candidates = [
        _make_media_item("tmdb_1", "Foo", ["action"], vote_average=9.0),
        _make_media_item("tmdb_2", "Bar", ["drama"], vote_average=8.5),
        _make_media_item("tmdb_3", "Baz", ["comedy"], vote_average=8.0),
    ]
    pool.get_candidates = MagicMock(return_value=pool.candidates)
    pool.refresh = AsyncMock()

    vector = UserTasteVector(
        id=_clean_uuid(),
        genres={"action": 0.8},
        favourites=["tmdb_0", "tmdb_1", "tmdb_2", "tmdb_3", "tmdb_4"],
    )
    clean_file_store.save_vector(vector)

    async with _client() as client:
        response = await client.post("/api/recommend", json={
            "taste_vector_id": vector.id,
            "mood": "happy_energetic",
            "time_available": "short",
            "time_of_day": "morning",
            "excluded_ids": ["tmdb_1", "tmdb_2", "tmdb_3"],
        })

    assert response.status_code == 200
    body = response.json()
    assert body["why_now"]["source"] == "fallback"
    assert body["confidence"] == "moderate"
    assert len(body["alternates"]) == 2


# ── POST /api/recommend/regenerate ───────────────────────────


@pytest.mark.asyncio
async def test_regenerate_success(mock_services, clean_file_store):
    """Regeneration excludes previous primary, increments counter, marks history."""
    cand1 = _make_media_item("tmdb_100", "Movie A", ["action", "thriller"], runtime_minutes=90)
    cand2 = _make_media_item("tmdb_200", "Movie B", ["drama"], runtime_minutes=80)
    cand3 = _make_media_item("tmdb_300", "Movie C", ["comedy"], runtime_minutes=85)
    pool = app.state.pool = MagicMock()
    pool.candidates = [cand1, cand2, cand3]

    def _get_candidates(exclude_ids=None):
        exclude_set = set(exclude_ids) if exclude_ids else set()
        return [c for c in [cand1, cand2, cand3] if c.id not in exclude_set]

    pool.get_candidates = MagicMock(side_effect=_get_candidates)
    pool.refresh = AsyncMock()

    vector = UserTasteVector(
        id=_clean_uuid(),
        genres={"action": 0.8, "drama": 0.5},
        keywords={"epic": 0.6},
        favourites=["tmdb_0", "tmdb_1", "tmdb_2", "tmdb_3", "tmdb_4"],
        regeneration_count=2,
        recommendation_history=[
            RecommendationHistoryEntry(media_id="tmdb_100", was_regenerated=False),
        ],
    )
    clean_file_store.save_vector(vector)

    # Simulate a previous recommendation log entry pointing to tmdb_100
    from app.routers import recommend as rec_module
    request_id = _clean_uuid()
    rec_module._recommendation_log[request_id] = {
        "primary_media_id": "tmdb_100",
        "alternate_media_ids": ["tmdb_200", "tmdb_300"],
    }

    async with _client() as client:
        response = await client.post("/api/recommend/regenerate", json={
            "taste_vector_id": vector.id,
            "mood": "happy_energetic",
            "time_available": "medium",
            "time_of_day": "evening",
            "original_request_id": request_id,
            "excluded_ids": [],
        })

    assert response.status_code == 200
    body = response.json()
    # primary should NOT be tmdb_100
    assert body["primary"]["media"]["id"] != "tmdb_100"

    # Check side effects
    updated = clean_file_store.get_vector(vector.id)
    assert updated.regeneration_count == 3
    assert updated.recommendation_history[0].was_regenerated is True


@pytest.mark.asyncio
async def test_regenerate_404_missing_request_id(mock_services, clean_file_store):
    """Original request ID not in log → 404 PREVIOUS_REQUEST_NOT_FOUND."""
    pool = app.state.pool = MagicMock()
    pool.candidates = []
    pool.get_candidates = MagicMock(return_value=[])
    pool.refresh = AsyncMock()

    vector = UserTasteVector(
        id=_clean_uuid(),
        genres={"action": 0.8},
        favourites=["tmdb_0", "tmdb_1", "tmdb_2", "tmdb_3", "tmdb_4"],
    )
    clean_file_store.save_vector(vector)

    fake_request_id = _clean_uuid()

    async with _client() as client:
        response = await client.post("/api/recommend/regenerate", json={
            "taste_vector_id": vector.id,
            "mood": "happy_energetic",
            "time_available": "medium",
            "time_of_day": "evening",
            "original_request_id": fake_request_id,
            "excluded_ids": [],
        })

    assert response.status_code == 404
    assert response.json()["error_code"] == "PREVIOUS_REQUEST_NOT_FOUND"


@pytest.mark.asyncio
async def test_regenerate_404_missing_vector(mock_services, clean_file_store):
    pool = app.state.pool = MagicMock()
    pool.candidates = []
    pool.get_candidates = MagicMock(return_value=[])
    pool.refresh = AsyncMock()

    valid_uuid = _clean_uuid()

    async with _client() as client:
        response = await client.post("/api/recommend/regenerate", json={
            "taste_vector_id": valid_uuid,
            "mood": "happy_energetic",
            "time_available": "medium",
            "time_of_day": "evening",
            "original_request_id": _clean_uuid(),
            "excluded_ids": [],
        })

    assert response.status_code == 404
    assert response.json()["error_code"] == "TASTE_VECTOR_NOT_FOUND"


@pytest.mark.asyncio
async def test_regenerate_404_invalid_uuid(mock_services, clean_file_store):
    pool = app.state.pool = MagicMock()
    pool.candidates = []
    pool.get_candidates = MagicMock(return_value=[])
    pool.refresh = AsyncMock()

    async with _client() as client:
        response = await client.post("/api/recommend/regenerate", json={
            "taste_vector_id": "bad-uuid",
            "mood": "happy_energetic",
            "time_available": "medium",
            "time_of_day": "evening",
            "original_request_id": _clean_uuid(),
            "excluded_ids": [],
        })

    assert response.status_code == 404
    assert response.json()["error_code"] == "TASTE_VECTOR_NOT_FOUND"
