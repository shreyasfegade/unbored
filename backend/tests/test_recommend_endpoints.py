"""Integration tests for recommendation + LLM endpoints.

These run against the real catalog + content index (built by the app lifespan),
mocking only the per-request LLM provider for the AI path.
"""

import tempfile
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@asynccontextmanager
async def _client(monkeypatch):
    import app.storage.file_store as fs
    monkeypatch.setattr(fs.settings, "storage_dir", tempfile.mkdtemp())
    fs.file_store.__init__()
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", timeout=30) as c:
            yield c


async def _make_taste(c: AsyncClient) -> str:
    shortlist = (await c.get("/api/search/curated-shortlist")).json()["items"]
    fav_ids = [m["id"] for m in shortlist[:5]]
    resp = await c.post("/api/taste", json={"favourite_ids": fav_ids})
    assert resp.status_code == 201
    return resp.json()["id"]


def _fake_provider(payload: str):
    p = MagicMock()
    p.name = "deepseek"
    p.model = "deepseek-chat"
    p.generate = AsyncMock(return_value=payload)
    return p


@pytest.mark.asyncio
async def test_recommend_engine_only(monkeypatch):
    async with _client(monkeypatch) as c:
        tv = await _make_taste(c)
        resp = await c.post("/api/recommend", json={
            "taste_vector_id": tv, "mood": "thrilled", "time_available": "long",
            "time_of_day": "evening", "media_type": "movie",
        })
    assert resp.status_code == 200
    body = resp.json()
    assert body["picked_by"] == "engine"
    assert body["provider"] is None
    assert body["primary"]["media"]["media_type"] == "movie"
    assert len(body["alternates"]) == 2
    assert body["rationale"]
    assert body["confidence"] in {"high", "strong", "moderate"}
    sb = body["primary"]["score_breakdown"]
    assert set(sb) == {"relevance", "mood", "runtime", "quality"}


@pytest.mark.asyncio
async def test_recommend_media_type_anime(monkeypatch):
    async with _client(monkeypatch) as c:
        tv = await _make_taste(c)
        resp = await c.post("/api/recommend", json={
            "taste_vector_id": tv, "mood": "happy_energetic", "time_available": "short",
            "time_of_day": "evening", "media_type": "anime",
        })
    assert resp.json()["primary"]["media"]["media_type"] == "anime"


@pytest.mark.asyncio
async def test_recommend_ai_path(monkeypatch):
    async with _client(monkeypatch) as c:
        tv = await _make_taste(c)
        app.state.provider_cache.get = lambda name, key: _fake_provider('{"pick": 2, "alt": [1, 3], "why": "A perfect match for your taste."}')
        resp = await c.post("/api/recommend", headers={"X-LLM-Provider": "deepseek", "X-LLM-Key": "k"}, json={
            "taste_vector_id": tv, "mood": "mindblown_curious", "time_available": "long",
            "time_of_day": "evening", "media_type": "surprise",
        })
    body = resp.json()
    assert body["picked_by"] == "ai"
    assert body["provider"] == "deepseek"
    assert body["rationale"] == "A perfect match for your taste."
    assert len(body["alternates"]) == 2


@pytest.mark.asyncio
async def test_recommend_ai_falls_back_on_bad_json(monkeypatch):
    async with _client(monkeypatch) as c:
        tv = await _make_taste(c)
        app.state.provider_cache.get = lambda name, key: _fake_provider("not json at all")
        resp = await c.post("/api/recommend", headers={"X-LLM-Provider": "deepseek", "X-LLM-Key": "k"}, json={
            "taste_vector_id": tv, "mood": "thrilled", "time_available": "long",
            "time_of_day": "evening", "media_type": "movie",
        })
    # Bad LLM output → engine pick, never an error.
    assert resp.json()["picked_by"] == "engine"


@pytest.mark.asyncio
async def test_recommend_404_for_unknown_taste(monkeypatch):
    async with _client(monkeypatch) as c:
        resp = await c.post("/api/recommend", json={
            "taste_vector_id": "00000000-0000-4000-8000-000000000000",
            "mood": "thrilled", "time_available": "long", "time_of_day": "evening",
        })
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_regenerate_excludes_previous(monkeypatch):
    async with _client(monkeypatch) as c:
        tv = await _make_taste(c)
        first = (await c.post("/api/recommend", json={
            "taste_vector_id": tv, "mood": "thrilled", "time_available": "long",
            "time_of_day": "evening", "media_type": "movie",
        })).json()
        regen = await c.post("/api/recommend/regenerate", json={
            "taste_vector_id": tv, "mood": "thrilled", "time_available": "long",
            "time_of_day": "evening", "media_type": "movie",
            "original_request_id": first["request_id"], "excluded_ids": [],
        })
    assert regen.status_code == 200
    assert regen.json()["primary"]["media"]["id"] != first["primary"]["media"]["id"]


@pytest.mark.asyncio
async def test_llm_validate_ok(monkeypatch):
    async with _client(monkeypatch) as c:
        app.state.provider_cache.get = lambda name, key: _fake_provider("ok")
        resp = await c.post("/api/llm/validate", headers={"X-LLM-Provider": "deepseek", "X-LLM-Key": "k"})
    body = resp.json()
    assert body["ok"] is True and body["provider"] == "deepseek"


@pytest.mark.asyncio
async def test_llm_validate_missing_key(monkeypatch):
    async with _client(monkeypatch) as c:
        resp = await c.post("/api/llm/validate")
    assert resp.json()["ok"] is False
