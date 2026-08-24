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
    # The three curated rows are always present; media-type rows were removed
    # (the filter chips do that job, and they were the source of cross-row
    # repetition). Genre rows fill the rest.
    assert {"trending", "top_rated", "new_releases"} <= keys
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


def test_every_title_appears_in_at_most_one_shelf():
    """The complaint was "half the stuff is repeated throughout" — a title used
    to appear in 5.3 rows on average, up to 10, because the media-type rows
    re-listed everything. Now a title is claimed by exactly one row."""
    from collections import Counter

    from app.services.shelves import build_shelves

    seen: Counter[str] = Counter()
    for shelf in build_shelves():
        for item in shelf["items"]:
            seen[item.id] += 1
    worst = max(seen.values())
    assert worst == 1, f"a title appears in {worst} shelves"


def test_no_shelf_repeats_a_franchise():
    """One show must not fill a row with its own sequels or seasons."""
    from app.services.shelves import build_shelves

    for shelf in build_shelves():
        franchises = [m.franchise for m in shelf["items"] if m.franchise]
        assert len(franchises) == len(set(franchises)), f"{shelf['key']} repeats a franchise"


def test_genre_rows_actually_fit_their_genre():
    """The old "rarest genre" rule filed dramas under Music and left no Action
    row at all. Every title in a genre row must genuinely carry that genre."""
    from app.services.shelves import build_shelves, effective_genres

    genre_rows = [s for s in build_shelves() if s["key"].startswith("genre:")]
    assert genre_rows, "expected genre rows"
    # The specific regression: Action was dropped entirely before.
    assert any(s["key"] == "genre:action" for s in genre_rows), "no Action row"

    for shelf in genre_rows:
        slug = shelf["key"].split(":", 1)[1]
        for m in shelf["items"]:
            assert slug in effective_genres(m), (
                f"{m.title!r} is in {shelf['key']} but its genres are {m.genres}"
            )


def test_curated_shelves_span_media_types():
    """AniList popularity is ~1000x TMDB's, so ranking the raw numbers together
    made the front-page rows 100% anime. The curated rows must stay mixed."""
    from collections import Counter

    from app.services.shelves import build_shelves

    for shelf in build_shelves():
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
