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
        shelves = (await c.get("/api/browse/shelves")).json()["shelves"]
        # Pick a real genre row rather than hardcoding one: which genres earn a
        # row depends on the catalog.
        key = next(s["key"] for s in shelves if s["key"].startswith("genre:") and s["count"] > 12)
        first = (await c.get(f"/api/browse/shelf/{key}", params={"offset": 0, "limit": 6})).json()
        assert first["key"] == key
        assert 0 < len(first["items"]) <= 6
        assert all(it["poster_path"] for it in first["items"])
        # Chain to the next page using next_offset.
        assert first["next_offset"] == 6
        second = (await c.get(f"/api/browse/shelf/{key}", params={"offset": 6, "limit": 6})).json()
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


def test_titles_do_not_repeat_across_many_shelves():
    """The complaint was "half the stuff is repeated throughout" — a title used
    to appear in 5.3 rows on average and up to 10."""
    from collections import Counter

    from app.routers.browse import _shelves

    seen: Counter[str] = Counter()
    for shelf in _shelves():
        for item in shelf["items"]:
            seen[item.id] += 1
    counts = list(seen.values())
    average = sum(counts) / len(counts)
    assert average <= 2.5, f"titles appear in {average:.1f} rows on average"
    assert max(counts) <= 4, f"one title appears in {max(counts)} rows"


def test_no_shelf_repeats_a_franchise():
    """One show must not fill a row with its own sequels or seasons."""
    from app.routers.browse import _shelves

    for shelf in _shelves():
        franchises = [m.franchise for m in shelf["items"] if m.franchise]
        assert len(franchises) == len(set(franchises)), f"{shelf['key']} repeats a franchise"


def test_curated_shelves_span_media_types():
    """AniList popularity is ~1000x TMDB's, so ranking the raw numbers together
    made the front-page rows 100% anime.

    Only the curated rows are checked: a genre row legitimately reflects its
    genre (there are no history TV shows in the catalog, so that row is all
    films), whereas Trending and Critically Acclaimed are meant to represent
    the whole library.
    """
    from collections import Counter

    from app.routers.browse import _shelves

    for shelf in _shelves():
        if shelf["key"] not in {"trending", "top_rated"}:
            continue
        head = shelf["items"][:20]
        kinds = Counter(m.media_type.value for m in head)
        assert len(kinds) >= 2, f"{shelf['key']} is entirely {list(kinds)}"
        kind, count = kinds.most_common(1)[0]
        assert count / len(head) <= 0.6, (
            f"{shelf['key']} is {count}/{len(head)} {kind}"
        )


@pytest.mark.asyncio
async def test_deck_is_diverse_and_unique():
    async with _client() as c:
        resp = await c.get("/api/browse/deck", params={"limit": 30, "seed": 7})
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 30
    ids = [i["id"] for i in items]
    assert len(set(ids)) == len(ids), "deck repeated a title"
    assert all(i["poster_path"] for i in items)
    # Round-robining across genre pools should not yield one-note runs.
    lead_genres = {i["genres"][0] for i in items if i["genres"]}
    assert len(lead_genres) >= 4, f"deck only spans {lead_genres}"


@pytest.mark.asyncio
async def test_deck_honours_exclude_and_media_type():
    async with _client() as c:
        first = (await c.get("/api/browse/deck", params={"limit": 10, "seed": 1})).json()["items"]
        drop = ",".join(i["id"] for i in first[:5])
        second = (await c.get(
            "/api/browse/deck", params={"limit": 10, "seed": 1, "exclude": drop}
        )).json()["items"]
        typed = (await c.get(
            "/api/browse/deck", params={"limit": 10, "media_type": "movie", "seed": 3}
        )).json()["items"]
    assert not ({i["id"] for i in second} & set(drop.split(",")))
    assert typed and all(i["media_type"] == "movie" for i in typed)


@pytest.mark.asyncio
async def test_unknown_shelf_is_404():
    async with _client() as c:
        resp = await c.get("/api/browse/shelf/genre:nonexistent")
    assert resp.status_code == 404
