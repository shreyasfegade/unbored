import pytest
import httpx
from unittest.mock import AsyncMock, MagicMock

from app.services.anilist_service import AniListService
from app.models.media import MediaType, MediaSource


def _graphql_response(data=None, errors=None):
    body = {}
    if data is not None:
        body["data"] = data
    if errors is not None:
        body["errors"] = errors
    return body


def _mock_anime(**overrides):
    anime = {
        "id": 21,
        "title": {"english": "One Piece", "romaji": "ONE PIECE"},
        "coverImage": {
            "extraLarge": "https://img.anilist/extra.jpg",
            "large": "https://img.anilist/large.jpg",
            "medium": None,
        },
        "bannerImage": "https://img.anilist/banner.jpg",
        "genres": ["Action", "Adventure", "Comedy"],
        "tags": [
            {"name": "Pirates", "rank": 95, "isMediaSpoiler": False, "isGeneralSpoiler": False},
            {"name": "Shounen", "rank": 90, "isMediaSpoiler": False, "isGeneralSpoiler": False},
            {"name": "Super Power", "rank": 75, "isMediaSpoiler": False, "isGeneralSpoiler": False},
        ],
        "averageScore": 88,
        "popularity": 500000,
        "description": "A story about pirates.",
        "episodes": 1000,
        "duration": 24,
        "seasonYear": 1999,
        "status": "RELEASING",
    }
    anime.update(overrides)
    return anime


@pytest.fixture
def anilist_service():
    AniListService._instance = None
    service = AniListService()
    yield service


@pytest.fixture
def mock_post(anilist_service):
    mock = AsyncMock()
    anilist_service._client.post = mock
    return mock


# ── Trending Tests ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_trending_success(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Page": {"media": [_mock_anime()]}
    }))

    results = await anilist_service.get_trending()

    assert len(results) == 1
    item = results[0]
    assert item.id == "al_21"
    assert item.source == MediaSource.ANILIST
    assert item.media_type == MediaType.ANIME


# ── Top Rated Tests ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_top_rated_success(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Page": {"media": [_mock_anime(id=1, title={"english": "FMA", "romaji": "Hagane no Renkinjutsushi"})]}
    }))

    results = await anilist_service.get_top_rated()

    assert len(results) == 1
    assert results[0].id == "al_1"


# ── Detail Tests ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_detail_success(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Media": _mock_anime()
    }))

    item = await anilist_service.get_detail(21)

    assert item is not None
    assert item.id == "al_21"
    assert item.title == "One Piece"
    assert item.original_title == "ONE PIECE"
    assert item.poster_path == "https://img.anilist/extra.jpg"
    assert item.backdrop_path == "https://img.anilist/banner.jpg"
    assert "action" in item.genres
    assert "adventure" in item.genres
    assert "comedy" in item.genres
    assert item.vote_average == 8.8
    assert item.vote_count == 500000
    assert item.release_year == 1999
    assert item.runtime_minutes == 24
    assert item.status == "airing"
    assert item.popularity == 500000.0
    assert item.media_type == MediaType.ANIME
    assert item.source == MediaSource.ANILIST


@pytest.mark.asyncio
async def test_get_detail_null_media(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Media": None
    }))

    item = await anilist_service.get_detail(99999)
    assert item is None


# ── Title Preference Tests ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_title_prefers_english(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Media": _mock_anime(title={"english": "Attack on Titan", "romaji": "Shingeki no Kyojin"})
    }))

    item = await anilist_service.get_detail(1)
    assert item is not None
    assert item.title == "Attack on Titan"
    assert item.original_title == "Shingeki no Kyojin"


@pytest.mark.asyncio
async def test_title_falls_back_to_romaji(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Media": _mock_anime(title={"english": None, "romaji": "Kimi no Na wa."})
    }))

    item = await anilist_service.get_detail(1)
    assert item is not None
    assert item.title == "Kimi no Na wa."


# ── Poster Fallback Tests ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_poster_falls_back_to_large(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Media": _mock_anime(coverImage={
            "extraLarge": None,
            "large": "https://img.anilist/large.jpg",
            "medium": None,
        })
    }))

    item = await anilist_service.get_detail(1)
    assert item is not None
    assert item.poster_path == "https://img.anilist/large.jpg"


@pytest.mark.asyncio
async def test_poster_falls_back_to_medium(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Media": _mock_anime(coverImage={
            "extraLarge": None,
            "large": None,
            "medium": "https://img.anilist/medium.jpg",
        })
    }))

    item = await anilist_service.get_detail(1)
    assert item is not None
    assert item.poster_path == "https://img.anilist/medium.jpg"


# ── HTML Tag Stripping Tests ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_html_stripping(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Media": _mock_anime(
            description="A <b>bold</b> tale of <i>adventure</i>.<br><br>Join the journey!",
        )
    }))

    item = await anilist_service.get_detail(1)
    assert item is not None
    assert item.overview == "A bold tale of adventure. Join the journey!"


# ── Tag Filtering Tests ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_spoiler_tags_are_excluded(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Media": _mock_anime(tags=[
            {"name": "Good Tag", "rank": 95, "isMediaSpoiler": False, "isGeneralSpoiler": False},
            {"name": "Spoiler Tag", "rank": 90, "isMediaSpoiler": True, "isGeneralSpoiler": False},
            {"name": "General Spoiler", "rank": 85, "isMediaSpoiler": False, "isGeneralSpoiler": True},
        ])
    }))

    item = await anilist_service.get_detail(1)
    assert item is not None
    assert "good-tag" in item.keywords
    assert "spoiler-tag" not in item.keywords
    assert "general-spoiler" not in item.keywords


@pytest.mark.asyncio
async def test_low_rank_tags_are_excluded(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Media": _mock_anime(tags=[
            {"name": "High Rank", "rank": 95, "isMediaSpoiler": False, "isGeneralSpoiler": False},
            {"name": "Low Rank", "rank": 30, "isMediaSpoiler": False, "isGeneralSpoiler": False},
        ])
    }))

    item = await anilist_service.get_detail(1)
    assert item is not None
    assert "high-rank" in item.keywords
    assert "low-rank" not in item.keywords


@pytest.mark.asyncio
async def test_top_15_tags_only(anilist_service, mock_post):
    tags = []
    for i in range(20):
        tags.append({
            "name": f"Tag {i}",
            "rank": 95 - i,
            "isMediaSpoiler": False,
            "isGeneralSpoiler": False,
        })

    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Media": _mock_anime(tags=tags)
    }))

    item = await anilist_service.get_detail(1)
    assert item is not None
    assert len(item.keywords) == 15
    assert "tag-0" in item.keywords
    assert "tag-14" in item.keywords
    assert "tag-15" not in item.keywords


# ── Genre Extra Keywords Tests ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_extra_keywords_from_genres(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Media": _mock_anime(
            genres=["Slice of Life", "Mecha", "Action"],
            tags=[],
        )
    }))

    item = await anilist_service.get_detail(1)
    assert item is not None
    assert "slice-of-life" in item.keywords
    assert "mecha" in item.keywords
    assert "drama" in item.genres


# ── Score / Average Score Tests ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_average_score_null_returns_zero(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Media": _mock_anime(averageScore=None)
    }))

    item = await anilist_service.get_detail(1)
    assert item is not None
    assert item.vote_average == 0.0


# ── Runtime / Duration Tests ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_duration_null_defaults_to_24(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Media": _mock_anime(duration=None)
    }))

    item = await anilist_service.get_detail(1)
    assert item is not None
    assert item.runtime_minutes == 24


# ── Status Map Tests ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_status_map(anilist_service, mock_post):
    test_map = {
        "FINISHED": "released",
        "RELEASING": "airing",
        "NOT_YET_RELEASED": "upcoming",
        "CANCELLED": "cancelled",
        "HIATUS": "airing",
    }
    for idx, (raw, expected) in enumerate(test_map.items()):
        mock_post.reset_mock()
        mock_post.return_value = _mock_http_response(200, _graphql_response(data={
            "Media": _mock_anime(id=idx + 1, status=raw)
        }))
        item = await anilist_service.get_detail(idx + 1)
        assert item is not None, f"detail returned None for status {raw}"
        assert item.status == expected, f"status mismatch for {raw}: expected {expected}, got {item.status}"


# ── Search Tests ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_search_success(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Page": {"media": [_mock_anime(id=1, title={"english": "Naruto", "romaji": "NARUTO"})]}
    }))

    results = await anilist_service.search("Naruto")
    assert len(results) == 1
    assert results[0].id == "al_1"
    assert results[0].title == "Naruto"


@pytest.mark.asyncio
async def test_search_empty_query(anilist_service):
    results = await anilist_service.search("")
    assert results == []


# ── Search Caching Tests ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_search_cache_hit(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Page": {"media": [_mock_anime()]}
    }))

    await anilist_service.search("One Piece")
    assert mock_post.call_count == 1

    await anilist_service.search("One Piece")
    assert mock_post.call_count == 1


@pytest.mark.asyncio
async def test_search_cache_expiry(anilist_service, mock_post, monkeypatch):
    monkeypatch.setattr(
        "app.services.anilist_service.SEARCH_CACHE_TTL", 0
    )

    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Page": {"media": [_mock_anime()]}
    }))

    await anilist_service.search("Test")
    assert mock_post.call_count == 1

    await anilist_service.search("Test")
    assert mock_post.call_count == 2


# ── GraphQL Error Tests ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_graphql_errors_raise_value_error(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(
        data={"Page": None},
        errors=[{"message": "Too many requests"}, {"message": "Invalid query"}],
    ))

    with pytest.raises(ValueError, match="AniList GraphQL errors"):
        await anilist_service.get_trending()


# ── HTTP Error Retry Tests ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_429_waits_for_retry_after_then_succeeds(anilist_service, mock_post):
    fail_response = _mock_http_response(429, headers={"Retry-After": "1"})
    success_body = _graphql_response(data={
        "Page": {"media": [_mock_anime()]}
    })

    mock_post.side_effect = [
        fail_response,
        fail_response,
        _mock_http_response(200, success_body),
    ]

    results = await anilist_service.get_trending()
    assert len(results) == 1
    assert mock_post.call_count == 3


@pytest.mark.asyncio
async def test_429_max_retries_exhausted(anilist_service, mock_post, monkeypatch):
    import app.services.anilist_service as svc
    monkeypatch.setattr(svc, "MAX_RETRIES", 2)
    monkeypatch.setattr(svc, "RETRY_BASE_DELAY", 0.01)

    mock_post.side_effect = [
        _mock_http_response(429, headers={"Retry-After": "1"}),
        _mock_http_response(429, headers={"Retry-After": "1"}),
    ]

    with pytest.raises(RuntimeError, match="failed after"):
        await anilist_service.get_trending()


@pytest.mark.asyncio
async def test_500_retries_then_fails(anilist_service, mock_post, monkeypatch):
    import app.services.anilist_service as svc
    monkeypatch.setattr(svc, "MAX_RETRIES", 2)
    monkeypatch.setattr(svc, "RETRY_BASE_DELAY", 0.01)

    mock_post.return_value = _mock_http_response(500)

    with pytest.raises(RuntimeError, match="failed after"):
        await anilist_service.get_trending()

    assert mock_post.call_count == 2


@pytest.mark.asyncio
async def test_timeout_retries(anilist_service, mock_post, monkeypatch):
    import app.services.anilist_service as svc
    monkeypatch.setattr(svc, "MAX_RETRIES", 2)
    monkeypatch.setattr(svc, "RETRY_BASE_DELAY", 0.01)

    mock_post.side_effect = httpx.TimeoutException("timeout")

    with pytest.raises(RuntimeError, match="failed after"):
        await anilist_service.get_trending()

    assert mock_post.call_count == 2


# ── Genre Mapping Tests ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_genre_map_resolves_correctly(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Media": _mock_anime(genres=["Sci-Fi", "Psychological", "Supernatural", "Action"])
    }))

    item = await anilist_service.get_detail(1)
    assert item is not None
    assert "sci-fi" in item.genres
    assert "thriller" in item.genres
    assert "fantasy" in item.genres
    assert "action" in item.genres


@pytest.mark.asyncio
async def test_unknown_genre_kept_as_is(anilist_service, mock_post):
    mock_post.return_value = _mock_http_response(200, _graphql_response(data={
        "Media": _mock_anime(genres=["Isekai"])
    }))

    item = await anilist_service.get_detail(1)
    assert item is not None
    assert "isekai" in item.genres


# ── Close Tests ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_close(anilist_service):
    aclose_mock = AsyncMock()
    anilist_service._client.aclose = aclose_mock
    await anilist_service.close()
    aclose_mock.assert_called_once()


# ── Helpers ────────────────────────────────────────────────────────────────

def _mock_http_response(status_code, body=None, headers=None):
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
