"""Where-to-watch, trailers and IMDb ids pulled out of TMDB / AniList payloads."""

import httpx
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.services.anilist_service import AniListService
from app.services.enrichment import (
    anilist_trailer,
    anilist_watch,
    tmdb_imdb_id,
    tmdb_trailer,
    tmdb_watch,
)
from app.services.tmdb_service import DETAIL_APPEND, TMDBService

PROVIDERS = {
    "watch/providers": {
        "results": {
            "IN": {
                "link": "https://www.themoviedb.org/movie/550/watch?locale=IN",
                "flatrate": [
                    {"provider_id": 8, "provider_name": "Netflix", "logo_path": "/n.jpg", "display_priority": 2},
                    {"provider_id": 119, "provider_name": "Amazon Prime Video", "logo_path": "/p.jpg", "display_priority": 1},
                ],
                "rent": [{"provider_id": 3, "provider_name": "Google Play Movies", "logo_path": "/g.jpg"}],
            },
            "US": {"link": "x", "flatrate": [{"provider_id": 15, "provider_name": "Hulu"}]},
        }
    }
}


def test_watch_keeps_india_only_in_display_order():
    w = tmdb_watch(PROVIDERS)
    assert list(w) == ["IN"]
    assert [p["name"] for p in w["IN"]["flatrate"]] == ["Amazon Prime Video", "Netflix"]
    assert w["IN"]["rent"] == [{"id": 3, "name": "Google Play Movies", "logo": "/g.jpg"}]
    assert "buy" not in w["IN"]
    assert w["IN"]["link"].endswith("locale=IN")


def test_watch_absent_means_none():
    assert tmdb_watch({}) is None
    assert tmdb_watch({"watch/providers": {"results": {"IN": {"link": "x"}}}}) is None


def _video(key, type_="Trailer", official=True, published="2020-01-01T00:00:00.000Z", site="YouTube"):
    return {"key": key, "type": type_, "official": official, "published_at": published, "site": site}


def test_trailer_prefers_official_trailers_then_newest():
    data = {"videos": {"results": [
        _video("teaser", "Teaser"),
        _video("fan", official=False, published="2024-01-01T00:00:00.000Z"),
        _video("old"),
        _video("new", published="2022-05-01T00:00:00.000Z"),
        _video("vimeo", site="Vimeo"),
        _video("clip", "Clip"),
    ]}}
    assert tmdb_trailer(data) == {"site": "youtube", "key": "new"}


def test_trailer_falls_back_to_teaser_and_then_none():
    assert tmdb_trailer({"videos": {"results": [_video("t", "Teaser", official=False)]}})["key"] == "t"
    assert tmdb_trailer({"videos": {"results": [_video("c", "Clip")]}}) is None
    assert tmdb_trailer({}) is None


def test_imdb_id():
    assert tmdb_imdb_id({"external_ids": {"imdb_id": "tt0137523"}}) == "tt0137523"
    assert tmdb_imdb_id({"imdb_id": "tt0137523"}) == "tt0137523"
    assert tmdb_imdb_id({"external_ids": {"imdb_id": ""}}) is None
    assert tmdb_imdb_id({}) is None


def test_anilist_streaming_links_and_trailer():
    media = {
        "trailer": {"id": "abc123", "site": "youtube"},
        "externalLinks": [
            {"site": "Crunchyroll", "url": "https://crunchyroll.com/x", "type": "STREAMING"},
            {"site": "Crunchyroll", "url": "https://crunchyroll.com/y", "type": "STREAMING"},
            {"site": "Twitter", "url": "https://twitter.com/x", "type": "SOCIAL"},
        ],
    }
    assert anilist_trailer(media) == {"site": "youtube", "key": "abc123"}
    assert anilist_watch(media) == {"any": {"links": [{"name": "Crunchyroll", "url": "https://crunchyroll.com/x"}]}}
    assert anilist_trailer({"trailer": {"id": "x", "site": "dailymotion"}}) is None
    assert anilist_watch({}) is None


def _response(body):
    r = MagicMock(spec=httpx.Response)
    r.status_code = 200
    r.json.return_value = body
    r.raise_for_status = MagicMock()
    return r


@pytest.mark.asyncio
async def test_movie_detail_asks_for_and_stores_enrichments(monkeypatch):
    monkeypatch.setattr("app.services.tmdb_service.settings.tmdb_api_key", "k")
    TMDBService._instance = None
    svc = TMDBService()
    svc._client.request = AsyncMock(return_value=_response({
        "id": 550, "title": "Fight Club", "overview": "x", "genres": [], "vote_average": 8.4,
        "vote_count": 100, "release_date": "1999-10-15", "runtime": 139,
        "external_ids": {"imdb_id": "tt0137523"},
        "videos": {"results": [_video("k1")]},
        **PROVIDERS,
    }))
    movie = await svc.get_movie_detail(550)
    params = svc._client.request.call_args.kwargs.get("params") or svc._client.request.call_args.args[2]
    assert params["append_to_response"] == DETAIL_APPEND
    assert movie.imdb_id == "tt0137523"
    assert movie.trailer == {"site": "youtube", "key": "k1"}
    assert movie.watch["IN"]["flatrate"][0]["name"] == "Amazon Prime Video"


@pytest.mark.asyncio
async def test_anilist_items_carry_trailer_and_links():
    AniListService._instance = None
    svc = AniListService()
    anime = {
        "id": 1, "title": {"english": "X", "romaji": "X"}, "coverImage": {}, "genres": ["Action"],
        "tags": [], "averageScore": 80, "popularity": 10, "description": "d", "duration": 24,
        "trailer": {"id": "yt1", "site": "youtube"},
        "externalLinks": [{"site": "Netflix", "url": "https://netflix.com/t", "type": "STREAMING"}],
    }
    svc._client.post = AsyncMock(return_value=_response({"data": {"Page": {"media": [anime]}}}))
    [item] = await svc.get_trending()
    assert item.trailer == {"site": "youtube", "key": "yt1"}
    assert item.watch == {"any": {"links": [{"name": "Netflix", "url": "https://netflix.com/t"}]}}
