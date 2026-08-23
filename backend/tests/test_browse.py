"""Tests for the browse endpoints (shelves + paginated rows)."""

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
async def test_shelves_are_well_formed():
    async with _client() as c:
        resp = await c.get("/api/browse/shelves")
    assert resp.status_code == 200
    shelves = resp.json()["shelves"]
    assert len(shelves) >= 8
    keys = {s["key"] for s in shelves}
    # Curated + type rows are always present.
    assert {"trending", "top_rated", "movie", "tv", "anime"} <= keys
    assert any(k.startswith("genre:") for k in keys)
    assert all(s["count"] > 0 for s in shelves)


@pytest.mark.asyncio
async def test_shelf_paginates_and_only_has_posters():
    async with _client() as c:
        first = (await c.get("/api/browse/shelf/genre:action", params={"offset": 0, "limit": 6})).json()
        assert first["key"] == "genre:action"
        assert 0 < len(first["items"]) <= 6
        assert all(it["poster_path"] for it in first["items"])
        # Chain to the next page using next_offset.
        assert first["next_offset"] == 6
        second = (await c.get("/api/browse/shelf/genre:action", params={"offset": 6, "limit": 6})).json()
    first_ids = {it["id"] for it in first["items"]}
    second_ids = {it["id"] for it in second["items"]}
    assert first_ids.isdisjoint(second_ids)


@pytest.mark.asyncio
async def test_shelf_media_type_filter():
    async with _client() as c:
        resp = await c.get("/api/browse/shelf/trending", params={"media_type": "anime", "limit": 10})
    body = resp.json()
    assert body["items"], "expected some anime in trending"
    assert all(it["media_type"] == "anime" for it in body["items"])


@pytest.mark.asyncio
async def test_unknown_shelf_is_404():
    async with _client() as c:
        resp = await c.get("/api/browse/shelf/genre:nonexistent")
    assert resp.status_code == 404
