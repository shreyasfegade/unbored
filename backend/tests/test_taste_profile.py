"""Tests for the taste profile endpoint."""

from contextlib import asynccontextmanager

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services.catalog import load_catalog


@asynccontextmanager
async def _client():
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", timeout=30) as c:
            yield c


def _ids_for_genre(genre: str, n: int = 6) -> list[str]:
    items = [c for c in load_catalog() if genre in {g.lower() for g in c.genres}]
    items.sort(key=lambda c: c.popularity, reverse=True)
    return [c.id for c in items[:n]]


@pytest.mark.asyncio
async def test_profile_reflects_the_dominant_genre():
    ids = _ids_for_genre("horror")
    if len(ids) < 3:
        pytest.skip("catalog lacks enough horror titles")
    async with _client() as c:
        resp = await c.post("/api/taste/profile", json={"favourite_ids": ids})
    assert resp.status_code == 200
    body = resp.json()
    assert body["resolved"] == len(ids)
    assert "horror" in {g["name"] for g in body["genres"]}
    assert body["decades"] and body["media_types"]
    assert 0.0 <= body["tone"]["darkness_preference"] <= 1.0
    assert sum(g["share"] for g in body["genres"]) <= 1.0001


@pytest.mark.asyncio
async def test_profile_with_no_favourites_is_empty_not_an_error():
    async with _client() as c:
        resp = await c.post("/api/taste/profile", json={"favourite_ids": []})
    assert resp.status_code == 200
    body = resp.json()
    assert body["resolved"] == 0 and body["genres"] == []


@pytest.mark.asyncio
async def test_profile_ignores_unknown_ids():
    real = _ids_for_genre("drama", 3)
    async with _client() as c:
        resp = await c.post(
            "/api/taste/profile",
            json={"favourite_ids": real + ["tmdb_does_not_exist", "al_000"]},
        )
    body = resp.json()
    assert body["resolved"] == len(real)
    assert body["requested"] == len(real) + 2
