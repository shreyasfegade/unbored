"""The batch media endpoint that replaced N per-item requests on enrich."""

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
async def test_batch_resolves_known_ids_in_order_and_skips_unknown():
    async with _client() as c:
        deck = (await c.get("/api/browse/deck", params={"limit": 4, "seed": 3})).json()["items"]
        ids = [d["id"] for d in deck]
        resp = await c.get("/api/media/batch", params={"ids": ",".join([ids[0], "nope_999", ids[1]])})
    assert resp.status_code == 200
    got = [i["id"] for i in resp.json()["items"]]
    assert got == [ids[0], ids[1]]  # order preserved, unknown dropped


@pytest.mark.asyncio
async def test_batch_missing_param_is_422():
    async with _client() as c:
        assert (await c.get("/api/media/batch")).status_code == 422
