import pytest
import httpx
from unittest.mock import AsyncMock, MagicMock, patch, call

from app.services.tmdb_service import (
    TMDBService,
    TMDBConfigError,
    TMDBNotFoundError,
    TMDBRateLimitError,
    TMDBServiceError,
)
from app.services import tmdb_constants


@pytest.fixture
def tmdb_service(monkeypatch):
    monkeypatch.setattr("app.services.tmdb_service.settings.tmdb_api_key", "test_key")
    TMDBService._instance = None
    service = TMDBService()
    yield service


@pytest.fixture
def mock_http(tmdb_service):
    mock = AsyncMock()
    tmdb_service._client.request = mock
    return mock


# ── Genre Loading Tests ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_load_genre_maps_success(tmdb_service, mock_http):
    responses = [
        {"genres": [{"id": 28, "name": "Action"}, {"id": 35, "name": "Comedy"}]},
        {"genres": [{"id": 10759, "name": "Action & Adventure"}, {"id": 16, "name": "Animation"}]},
    ]
    mock_http.side_effect = [
        _mock_response(200, body=r) for r in responses
    ]

    await tmdb_service._load_genre_maps()

    assert tmdb_service._movie_genre_map[28] == "Action"
    assert tmdb_service._movie_genre_map[35] == "Comedy"
    assert tmdb_service._tv_genre_map[10759] == "Action & Adventure"
    assert 16 in tmdb_service._tv_genre_map


@pytest.mark.asyncio
async def test_load_genre_maps_fallback(tmdb_service, mock_http):
    mock_http.side_effect = httpx.TimeoutException("timeout")

    await tmdb_service._load_genre_maps()

    assert 28 in tmdb_service._movie_genre_map
    assert 10759 in tmdb_service._tv_genre_map


# ── Movie List Normalization Tests ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_popular_movies_normalization(tmdb_service, mock_http):
    mock_http.return_value = _mock_response(200, body={
        "page": 1, "results": [
            {
                "id": 550, "title": "Fight Club", "overview": "...",
                "poster_path": "/fc.jpg", "backdrop_path": "/fc-bg.jpg",
                "genre_ids": [18, 53],
                "vote_average": 8.4, "vote_count": 26280,
                "release_date": "1999-10-15", "popularity": 73.2,
            }
        ],
        "total_pages": 1, "total_results": 1,
    })

    movies = await tmdb_service.get_popular_movies(pages=1)

    assert len(movies) == 1
    m = movies[0]
    assert m.id == "tmdb_550"
    assert m.source.value == "tmdb_movie"
    assert m.title == "Fight Club"
    assert m.poster_path == "https://image.tmdb.org/t/p/w500/fc.jpg"
    assert m.backdrop_path == "https://image.tmdb.org/t/p/w780/fc-bg.jpg"
    assert "drama" in m.genres
    assert m.release_year == 1999


@pytest.mark.asyncio
async def test_get_popular_tv_normalization(tmdb_service, mock_http):
    mock_http.return_value = _mock_response(200, body={
        "page": 1, "results": [
            {
                "id": 1399, "name": "Game of Thrones", "overview": "...",
                "poster_path": "/got.jpg", "backdrop_path": "/got-bg.jpg",
                "genre_ids": [10765, 18],
                "vote_average": 8.4, "vote_count": 21687,
                "first_air_date": "2011-04-17", "popularity": 420.3,
            }
        ],
        "total_pages": 1, "total_results": 1,
    })

    shows = await tmdb_service.get_popular_tv(pages=1)

    assert len(shows) == 1
    s = shows[0]
    assert s.id == "tmdb_1399"
    assert s.source.value == "tmdb_tv"
    assert s.title == "Game of Thrones"
    assert s.release_year == 2011
    assert "sci-fi" in s.genres
    assert "fantasy" in s.genres


# ── Movie Detail Tests ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_movie_detail_success(tmdb_service, mock_http):
    mock_http.return_value = _mock_response(200, body={
        "id": 550, "title": "Fight Club",
        "overview": "An insomniac office worker...",
        "poster_path": "/fightclub.jpg", "backdrop_path": "/backdrop.jpg",
        "genres": [{"id": 18, "name": "Drama"}],
        "vote_average": 8.4, "vote_count": 26280,
        "release_date": "1999-10-15", "runtime": 139,
        "status": "Released", "popularity": 73.2,
        "keywords": {
            "keywords": [
                {"id": 825, "name": "support group"},
                {"id": 851, "name": "mind bending"},
            ]
        },
    })

    movie = await tmdb_service.get_movie_detail(550)

    assert movie is not None
    assert movie.id == "tmdb_550"
    assert movie.title == "Fight Club"
    assert movie.genres == ["drama"]
    assert movie.keywords == ["support-group", "mind-bending"]
    assert movie.release_year == 1999
    assert movie.runtime_minutes == 139


@pytest.mark.asyncio
async def test_get_tv_detail_success_keywords_results(tmdb_service, mock_http):
    mock_http.return_value = _mock_response(200, body={
        "id": 1399, "name": "Game of Thrones",
        "overview": "Winter is coming.",
        "poster_path": "/got.jpg", "backdrop_path": "/got-bg.jpg",
        "genres": [{"id": 18, "name": "Drama"}],
        "vote_average": 8.4, "vote_count": 21000,
        "first_air_date": "2011-04-17", "episode_run_time": [60],
        "status": "Ended", "popularity": 420.0,
        "keywords": {
            "results": [
                {"id": 12, "name": "based on novel or book"},
            ]
        },
    })

    show = await tmdb_service.get_tv_detail(1399)

    assert show is not None
    assert show.id == "tmdb_1399"
    assert show.title == "Game of Thrones"
    assert show.keywords == ["based-on-novel-or-book"]
    assert show.runtime_minutes == 60


@pytest.mark.asyncio
async def test_get_movie_detail_not_found(tmdb_service, mock_http):
    mock_http.return_value = _mock_response(404)

    movie = await tmdb_service.get_movie_detail(99999)
    assert movie is None


@pytest.mark.asyncio
async def test_get_tv_detail_not_found(tmdb_service, mock_http):
    mock_http.return_value = _mock_response(404)

    show = await tmdb_service.get_tv_detail(99999)
    assert show is None


# ── Null Poster / Empty Runtime Tests ──────────────────────────────────────

@pytest.mark.asyncio
async def test_null_poster_returns_placeholder(tmdb_service, mock_http):
    mock_http.return_value = _mock_response(200, body={
        "page": 1, "results": [
            {
                "id": 1, "title": "No Poster", "overview": "",
                "poster_path": None, "backdrop_path": None,
                "genre_ids": [18],
                "vote_average": 7.5, "vote_count": 500,
                "release_date": "2020-01-01", "popularity": 1.0,
            }
        ],
        "total_pages": 1, "total_results": 1,
    })

    movies = await tmdb_service.get_popular_movies(pages=1)
    assert movies[0].poster_path == tmdb_constants.POSTER_PLACEHOLDER
    assert movies[0].backdrop_path is None


@pytest.mark.asyncio
async def test_empty_episode_runtime(tmdb_service, mock_http):
    mock_http.return_value = _mock_response(200, body={
        "id": 1, "name": "No Runtime", "overview": "",
        "poster_path": None, "backdrop_path": None,
        "genres": [], "vote_average": 7.0, "vote_count": 500,
        "first_air_date": "2020-01-01", "episode_run_time": [],
        "status": "Returning Series", "popularity": 1.0,
        "keywords": {"results": []},
    })

    show = await tmdb_service.get_tv_detail(1)
    assert show is not None
    assert show.runtime_minutes is None


# ── Search Multi Tests ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_search_multi_filters_persons(tmdb_service, mock_http):
    mock_http.return_value = _mock_response(200, body={
        "page": 1, "results": [
            {"id": 27205, "media_type": "movie", "title": "Inception",
             "overview": "", "poster_path": None, "backdrop_path": None,
             "genre_ids": [28], "vote_average": 8.4, "vote_count": 30000,
             "release_date": "2010-07-15", "popularity": 50.0},
            {"id": 123, "media_type": "person", "name": "Some Actor",
             "known_for_department": "Acting"},
            {"id": 44217, "media_type": "tv", "name": "Vikings",
             "overview": "", "poster_path": None, "backdrop_path": None,
             "genre_ids": [10759], "vote_average": 8.0, "vote_count": 20000,
             "first_air_date": "2013-03-03", "popularity": 60.0},
        ],
        "total_pages": 1, "total_results": 3,
    })

    results = await tmdb_service.search_multi("test")

    assert len(results) == 2
    ids = {r.id for r in results}
    assert ids == {"tmdb_27205", "tmdb_44217"}
    assert all(r.media_type.value in ("movie", "tv") for r in results)


@pytest.mark.asyncio
async def test_search_multi_empty_query(tmdb_service):
    results = await tmdb_service.search_multi("")
    assert results == []


# ── Error Handling & Retry Tests ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_request_invalid_key_raises(tmdb_service, mock_http):
    mock_http.return_value = _mock_response(401)

    with pytest.raises(TMDBConfigError):
        await tmdb_service._request("GET", "/test")


@pytest.mark.asyncio
async def test_request_rate_limit_retries_then_fails(tmdb_service, mock_http):
    mock_http.return_value = _mock_response(429)

    with pytest.raises(TMDBServiceError):
        await tmdb_service._request("GET", "/test")

    assert mock_http.call_count == 3


@pytest.mark.asyncio
async def test_request_server_error_retries_then_fails(tmdb_service, mock_http):
    mock_http.return_value = _mock_response(500)

    with pytest.raises(TMDBServiceError):
        await tmdb_service._request("GET", "/test")

    assert mock_http.call_count == 3


@pytest.mark.asyncio
async def test_request_timeout_retries(tmdb_service, mock_http):
    mock_http.side_effect = httpx.TimeoutException("timeout")

    with pytest.raises(TMDBServiceError):
        await tmdb_service._request("GET", "/test")

    assert mock_http.call_count == 3


# ── Caching Tests ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cache_hit_avoids_http(tmdb_service, mock_http):
    mock_http.return_value = _mock_response(200, body={
        "id": 550, "title": "Fight Club",
        "overview": "...", "poster_path": None, "backdrop_path": None,
        "genres": [{"id": 18, "name": "Drama"}],
        "vote_average": 8.4, "vote_count": 26280,
        "release_date": "1999-10-15", "runtime": 139,
        "status": "Released", "popularity": 73.2,
        "keywords": {"keywords": [{"id": 825, "name": "test key"}]},
    })

    await tmdb_service.get_movie_detail(550)
    assert mock_http.call_count == 1

    await tmdb_service.get_movie_detail(550)
    assert mock_http.call_count == 1


@pytest.mark.asyncio
async def test_cache_expiry_triggers_refetch(tmdb_service, mock_http, monkeypatch):
    monkeypatch.setattr(
        "app.services.tmdb_service.CACHE_TTL_DETAIL", 0
    )

    mock_http.return_value = _mock_response(200, body={
        "id": 550, "title": "Fight Club",
        "overview": "...", "poster_path": None, "backdrop_path": None,
        "genres": [{"id": 18, "name": "Drama"}],
        "vote_average": 8.4, "vote_count": 26280,
        "release_date": "1999-10-15", "runtime": 139,
        "status": "Released", "popularity": 73.2,
        "keywords": {"keywords": [{"id": 825, "name": "test key"}]},
    })

    await tmdb_service.get_movie_detail(550)
    assert mock_http.call_count == 1

    await tmdb_service.get_movie_detail(550)
    assert mock_http.call_count == 2


# ── Concurrent Keywords Enrichment Test ────────────────────────────────────

@pytest.mark.asyncio
async def test_get_movie_keywords_standalone(tmdb_service, mock_http):
    mock_http.return_value = _mock_response(200, body={
        "id": 550,
        "keywords": [
            {"id": 825, "name": "support group"},
            {"id": 851, "name": "dual identity"},
        ],
    })

    keywords = await tmdb_service.get_movie_keywords(550)
    assert keywords == ["support group", "dual identity"]


@pytest.mark.asyncio
async def test_get_tv_keywords_standalone_uses_results(tmdb_service, mock_http):
    mock_http.return_value = _mock_response(200, body={
        "id": 1399,
        "results": [
            {"id": 34, "name": "fantasy"},
            {"id": 818, "name": "based on novel or book"},
        ],
    })

    keywords = await tmdb_service.get_tv_keywords(1399)
    assert keywords == ["fantasy", "based on novel or book"]


# ── Trending Tests ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_trending_movies(tmdb_service, mock_http):
    mock_http.return_value = _mock_response(200, body={
        "page": 1, "results": [
            {"id": 100, "title": "Trending Movie", "overview": "",
             "poster_path": None, "backdrop_path": None,
             "genre_ids": [28], "vote_average": 7.0, "vote_count": 500,
             "release_date": "2024-01-01", "popularity": 100.0},
        ],
        "total_pages": 1, "total_results": 1,
    })

    movies = await tmdb_service.get_trending_movies()
    assert len(movies) == 1
    assert movies[0].id == "tmdb_100"


@pytest.mark.asyncio
async def test_get_trending_tv(tmdb_service, mock_http):
    mock_http.return_value = _mock_response(200, body={
        "page": 1, "results": [
            {"id": 200, "name": "Trending Show", "overview": "",
             "poster_path": None, "backdrop_path": None,
             "genre_ids": [18], "vote_average": 8.0, "vote_count": 1000,
             "first_air_date": "2024-01-01", "popularity": 90.0},
        ],
        "total_pages": 1, "total_results": 1,
    })

    shows = await tmdb_service.get_trending_tv()
    assert len(shows) == 1
    assert shows[0].id == "tmdb_200"


# ── Helpers ────────────────────────────────────────────────────────────────

def _mock_response(status_code: int, body=None, headers=None):
    if headers is None:
        headers = {}
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.headers = httpx.Headers(headers)
    resp.raise_for_status = MagicMock()
    if status_code >= 400:
        resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            message="error",
            request=MagicMock(),
            response=resp,
        )
    if body is not None:
        resp.json.return_value = body
    return resp
