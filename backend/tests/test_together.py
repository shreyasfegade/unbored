"""Tests for Watch Together group rooms."""

from contextlib import asynccontextmanager

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@asynccontextmanager
async def _client():
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", timeout=30) as c:
            yield c


async def _some_ids(c, n):
    deck = (await c.get("/api/browse/deck", params={"limit": n, "seed": 5})).json()["items"]
    return [i["id"] for i in deck]


@pytest.mark.asyncio
async def test_room_lifecycle_and_blended_pick():
    async with _client() as c:
        host_ids = await _some_ids(c, 6)
        guest_ids = await _some_ids(c, 6)

        created = (await c.post("/api/together/rooms", json={"name": "Ana", "favourite_ids": host_ids})).json()
        code = created["room"]["code"]
        assert len(code) == 4
        assert created["room"]["members"][0]["name"] == "Ana"
        assert created["room"]["members"][0]["favourite_count"] == 6

        joined = await c.post(f"/api/together/rooms/{code}/join", json={"name": "Ben", "favourite_ids": guest_ids})
        assert joined.status_code == 200
        room = joined.json()["room"]
        assert len(room["members"]) == 2
        # Combined taste is deduped across members.
        assert room["combined_favourites"] <= len(set(host_ids + guest_ids))

        # The live room is visible to anyone with the code.
        state = (await c.get(f"/api/together/rooms/{code}")).json()
        assert {m["name"] for m in state["members"]} == {"Ana", "Ben"}
        assert state["expires_in"] > 0

        pick = await c.post(
            f"/api/together/rooms/{code}/pick",
            json={"mood": "thrilled", "time_available": "medium"},
        )
        assert pick.status_code == 200
        body = pick.json()
        assert body["primary"]["media"]["id"]
        assert body["picked_by"] == "engine"


@pytest.mark.asyncio
async def test_unknown_room_is_404():
    async with _client() as c:
        assert (await c.get("/api/together/rooms/ZZZZ")).status_code == 404
        assert (
            await c.post("/api/together/rooms/ZZZZ/join", json={"name": "x", "favourite_ids": []})
        ).status_code == 404


@pytest.mark.asyncio
async def test_member_favourite_ids_are_not_exposed():
    """The room shows names and counts, never anyone's actual titles."""
    async with _client() as c:
        ids = await _some_ids(c, 4)
        created = (await c.post("/api/together/rooms", json={"name": "Ana", "favourite_ids": ids})).json()
        member = created["room"]["members"][0]
        assert "favourite_ids" not in member
        assert set(member.keys()) == {"id", "name", "favourite_count"}
