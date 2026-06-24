"""Integration tests for the catalog-backed search + shortlist endpoints."""

from contextlib import asynccontextmanager

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@asynccontextmanager
async def _client():
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", timeout=30) as c:
            yield c


@pytest.mark.asyncio
async def test_search_finds_known_title():
    async with _client() as c:
        resp = await c.get("/api/search/multi", params={"q": "attack on titan"})
    assert resp.status_code == 200
    titles = [r["title"].lower() for r in resp.json()["results"]]
    assert any("attack on titan" in t for t in titles)


@pytest.mark.asyncio
async def test_search_type_filter():
    async with _client() as c:
        resp = await c.get("/api/search/multi", params={"q": "the", "type": "anime"})
    assert resp.status_code == 200
    assert all(r["media_type"] == "anime" for r in resp.json()["results"])


@pytest.mark.asyncio
async def test_curated_shortlist_is_diverse():
    async with _client() as c:
        resp = await c.get("/api/search/curated-shortlist")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) >= 20
    types = {i["media_type"] for i in items}
    assert len(types) >= 2  # spans multiple media types
    assert all(i["poster_path"] for i in items)


@pytest.mark.asyncio
async def test_status_reports_byok():
    async with _client() as c:
        resp = await c.get("/api/status")
    body = resp.json()
    assert body["catalog"]["size"] >= 300
    assert body["llm"]["mode"] == "byok"
