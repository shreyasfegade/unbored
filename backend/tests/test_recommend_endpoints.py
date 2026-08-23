"""Integration tests for the stateless recommendation + LLM endpoints.

These run against the real catalog + content index (built by the app lifespan),
mocking only the per-request LLM provider for the AI path. The API keeps no
per-user state: the request carries favourite_ids and excluded_ids directly.
"""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services.curator import clear_cache as clear_curator_cache
from app.services.query_expansion import clear_cache as clear_expansion_cache


@asynccontextmanager
async def _client():
    clear_curator_cache()
    clear_expansion_cache()
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", timeout=30) as c:
            yield c


async def _fav_ids(c: AsyncClient, n: int = 5) -> list[str]:
    shortlist = (await c.get("/api/search/curated-shortlist")).json()["items"]
    return [m["id"] for m in shortlist[:n]]


def _fake_provider(payload: str):
    p = MagicMock()
    p.name = "deepseek"
    p.model = "deepseek-chat"
    p.generate = AsyncMock(return_value=payload)
    return p


@pytest.mark.asyncio
async def test_recommend_engine_only():
    async with _client() as c:
        favs = await _fav_ids(c)
        resp = await c.post("/api/recommend", json={
            "favourite_ids": favs, "mood": "thrilled", "time_available": "long",
            "time_of_day": "evening", "media_type": "movie",
        })
    assert resp.status_code == 200
    body = resp.json()
    assert body["picked_by"] == "engine"
    assert body["provider"] is None
    assert body["primary"]["media"]["media_type"] == "movie"
    assert len(body["alternates"]) == 2
    assert body["rationale"]
    assert body["primary"]["rationale"]
    assert body["confidence"] in {"high", "strong", "moderate"}
    sb = body["primary"]["score_breakdown"]
    assert set(sb) == {"relevance", "mood", "runtime", "quality", "recency"}
    assert body["ai_status"] == "off"
    assert body["media_type_applied"] is True


@pytest.mark.asyncio
async def test_recommend_media_type_anime():
    async with _client() as c:
        favs = await _fav_ids(c)
        resp = await c.post("/api/recommend", json={
            "favourite_ids": favs, "mood": "happy_energetic", "time_available": "short",
            "time_of_day": "evening", "media_type": "anime",
        })
    assert resp.json()["primary"]["media"]["media_type"] == "anime"


@pytest.mark.asyncio
async def test_recommend_era_biases_year():
    """Classic vs modern should pull the pick's era in opposite directions."""
    async with _client() as c:
        favs = await _fav_ids(c)
        base = {"favourite_ids": favs, "mood": "thrilled", "time_available": "long",
                "time_of_day": "evening", "media_type": "movie"}
        modern = (await c.post("/api/recommend", json={**base, "era": "modern"})).json()
        classic = (await c.post("/api/recommend", json={**base, "era": "classic"})).json()
    modern_year = modern["primary"]["media"]["release_year"] or 0
    classic_year = classic["primary"]["media"]["release_year"] or 9999
    assert modern_year >= classic_year


@pytest.mark.asyncio
async def test_recommend_ai_path_expands_and_curates():
    async with _client() as c:
        favs = await _fav_ids(c)
        # First call = query expansion (genres), second = curation.
        app.state.provider_cache.get = lambda name, key: _fake_provider(
            '{"pick": 2, "alt": [1, 3], "why": "A perfect match for your taste.", '
            '"alt_why": ["Close second.", "Also great."]}'
        )
        resp = await c.post(
            "/api/recommend",
            headers={"X-LLM-Provider": "deepseek", "X-LLM-Key": "k"},
            json={"favourite_ids": favs, "mood": "mindblown_curious", "time_available": "long",
                  "time_of_day": "evening", "media_type": "surprise"},
        )
    body = resp.json()
    assert body["picked_by"] == "ai"
    assert body["provider"] == "deepseek"
    assert body["ai_status"] == "used"
    assert body["rationale"] == "A perfect match for your taste."
    assert len(body["alternates"]) == 2


@pytest.mark.asyncio
async def test_recommend_ai_falls_back_on_bad_json():
    async with _client() as c:
        favs = await _fav_ids(c)
        app.state.provider_cache.get = lambda name, key: _fake_provider("not json at all")
        resp = await c.post(
            "/api/recommend",
            headers={"X-LLM-Provider": "deepseek", "X-LLM-Key": "k"},
            json={"favourite_ids": favs, "mood": "thrilled", "time_available": "long",
                  "time_of_day": "evening", "media_type": "movie"},
        )
    body = resp.json()
    # Bad LLM output → engine pick, never an error, and ai_status reflects it.
    assert body["picked_by"] == "engine"
    assert body["ai_status"] == "error"


@pytest.mark.asyncio
async def test_recommend_empty_favourites_is_cold_start_demo():
    """No favourites is allowed — the visitor gets a strong cold-start pick so
    they can try the product before naming any favourites."""
    async with _client() as c:
        resp = await c.post("/api/recommend", json={
            "favourite_ids": [], "mood": "thrilled", "time_available": "long",
            "time_of_day": "evening",
        })
    assert resp.status_code == 200
    assert resp.json()["primary"]["media"]["id"]


@pytest.mark.asyncio
async def test_recommend_ignores_unknown_favourite_ids():
    """Unknown ids don't crash; a valid subset still yields a pick."""
    async with _client() as c:
        favs = await _fav_ids(c, 3)
        resp = await c.post("/api/recommend", json={
            "favourite_ids": favs + ["tmdb_does_not_exist", "al_000"],
            "mood": "thrilled", "time_available": "long", "time_of_day": "evening",
        })
    assert resp.status_code == 200
    assert resp.json()["primary"]["media"]["id"]


@pytest.mark.asyncio
async def test_regenerate_via_excluded_ids():
    """'Try again' is just another /recommend with the previous pick excluded."""
    async with _client() as c:
        favs = await _fav_ids(c)
        base = {"favourite_ids": favs, "mood": "thrilled", "time_available": "long",
                "time_of_day": "evening", "media_type": "movie"}
        first = (await c.post("/api/recommend", json=base)).json()
        prev_id = first["primary"]["media"]["id"]
        regen = await c.post("/api/recommend", json={**base, "excluded_ids": [prev_id]})
    assert regen.status_code == 200
    assert regen.json()["primary"]["media"]["id"] != prev_id


@pytest.mark.asyncio
async def test_llm_validate_ok():
    async with _client() as c:
        app.state.provider_cache.get = lambda name, key: _fake_provider("ok")
        resp = await c.post("/api/llm/validate", headers={"X-LLM-Provider": "deepseek", "X-LLM-Key": "k"})
    body = resp.json()
    assert body["ok"] is True and body["provider"] == "deepseek"


@pytest.mark.asyncio
async def test_llm_validate_missing_key():
    async with _client() as c:
        resp = await c.post("/api/llm/validate")
    assert resp.json()["ok"] is False
