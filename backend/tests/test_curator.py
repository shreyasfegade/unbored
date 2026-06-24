"""Tests for the LLM curator (prompt building + robust JSON parsing)."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.media import MediaItem, MediaType, MediaSource
from app.services.curator import _parse, build_user_prompt, curate


def _item(id: str, title: str, genres: list[str], year: int = 2020) -> MediaItem:
    return MediaItem(
        id=id, source=MediaSource.TMDB_MOVIE, media_type=MediaType.MOVIE,
        title=title, original_title=title, genres=genres, release_year=year,
    )


_SHORTLIST = [
    _item("a", "Memento", ["thriller", "mystery"]),
    _item("b", "Tenet", ["action", "sci-fi"]),
    _item("c", "Heat", ["crime", "thriller"]),
]


def test_prompt_is_token_frugal():
    prompt = build_user_prompt(["Inception", "Whiplash"], "thrilled", "long", "movie", _SHORTLIST)
    assert "Inception" in prompt and "Whiplash" in prompt
    assert "1. Memento (2020)" in prompt
    assert "JSON" in prompt
    # No bulky overviews leaked into the prompt.
    assert "overview" not in prompt.lower()


@pytest.mark.parametrize(
    "raw,pick,alts",
    [
        ('{"pick": 2, "alt": [1, 3], "why": "Great."}', 1, [0, 2]),
        ('Here you go: {"pick": 1, "alt": [2], "why": "Nice"} done', 0, [1]),
        ('{"pick": 3, "alt": [3, 1], "why": "x"}', 2, [0]),  # self-ref alt dropped
    ],
)
def test_parse_valid(raw, pick, alts):
    res = _parse(raw, 3)
    assert res is not None
    assert res.primary_index == pick
    assert res.alternate_indices == alts


@pytest.mark.parametrize("raw", ["not json", "{}", '{"pick": 9}', '{"pick": "x"}', ""])
def test_parse_invalid(raw):
    assert _parse(raw, 3) is None


@pytest.mark.asyncio
async def test_curate_success():
    provider = MagicMock()
    provider.generate = AsyncMock(return_value='{"pick": 1, "alt": [2, 3], "why": "Fits you."}')
    res = await curate(
        provider, liked_titles=["Inception"], mood="thrilled",
        time_available="long", media_type="movie", shortlist=_SHORTLIST,
    )
    assert res is not None and res.primary_index == 0 and res.why == "Fits you."


@pytest.mark.asyncio
async def test_curate_returns_none_on_provider_failure():
    provider = MagicMock()
    provider.generate = AsyncMock(return_value=None)
    res = await curate(
        provider, liked_titles=["Inception"], mood="thrilled",
        time_available="long", media_type="movie", shortlist=_SHORTLIST,
    )
    assert res is None
