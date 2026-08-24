"""The tuning sliders must be a true no-op at zero and move the ranking in the
promised direction when pushed."""

from contextlib import asynccontextmanager

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@asynccontextmanager
async def _client():
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", timeout=30) as c:
            yield c


def _base(favs, **tuning):
    body = {
        "favourite_ids": favs,
        "mood": "thrilled",
        "time_available": "medium",
        "time_of_day": "evening",
        "media_type": "surprise",
        "era": "any",
        "excluded_ids": [],
    }
    if tuning:
        body["tuning"] = tuning
    return body


async def _favs(c, n=6):
    deck = (await c.get("/api/browse/deck", params={"limit": n, "seed": 11})).json()["items"]
    return [i["id"] for i in deck]


@pytest.mark.asyncio
async def test_zero_tuning_matches_no_tuning():
    async with _client() as c:
        favs = await _favs(c)
        none = (await c.post("/api/recommend", json=_base(favs))).json()
        zero = (await c.post(
            "/api/recommend",
            json=_base(favs, adventurous=0, obscurity=0, acclaim=0, freshness=0),
        )).json()
    assert none["primary"]["media"]["id"] == zero["primary"]["media"]["id"]


@pytest.mark.asyncio
async def test_hidden_gems_lowers_popularity():
    """Pushing toward hidden gems should, on average across moods, surface a less
    popular pick than pushing toward crowd-pleasers."""
    async with _client() as c:
        favs = await _favs(c)
        moods = ["thrilled", "want_to_laugh", "mindblown_curious", "tired_low"]
        gems, crowd = [], []
        for m in moods:
            g = _base(favs, obscurity=1.0)
            g["mood"] = m
            k = _base(favs, obscurity=-1.0)
            k["mood"] = m
            gems.append((await c.post("/api/recommend", json=g)).json()["primary"]["media"])
            crowd.append((await c.post("/api/recommend", json=k)).json()["primary"]["media"])
    avg_gem = sum(x["popularity_norm"] for x in gems) / len(gems)
    avg_crowd = sum(x["popularity_norm"] for x in crowd) / len(crowd)
    assert avg_gem < avg_crowd, f"gems {avg_gem:.3f} not below crowd {avg_crowd:.3f}"


@pytest.mark.asyncio
async def test_acclaim_raises_rating():
    async with _client() as c:
        favs = await _favs(c)
        moods = ["thrilled", "want_to_laugh", "mindblown_curious", "tired_low"]
        high, low = [], []
        for m in moods:
            a = _base(favs, acclaim=1.0)
            a["mood"] = m
            b = _base(favs, acclaim=-1.0)
            b["mood"] = m
            high.append((await c.post("/api/recommend", json=a)).json()["primary"]["media"])
            low.append((await c.post("/api/recommend", json=b)).json()["primary"]["media"])
    avg_high = sum(x["vote_average"] for x in high) / len(high)
    avg_low = sum(x["vote_average"] for x in low) / len(low)
    assert avg_high >= avg_low, f"acclaimed {avg_high:.2f} below anything-goes {avg_low:.2f}"
