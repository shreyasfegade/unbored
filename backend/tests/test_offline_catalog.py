"""Tests for the bundled offline catalog and demo-mode candidate pool."""

from unittest.mock import MagicMock

import pytest

from app.models.media import MediaItem, MediaType
from app.services.candidate_pool import CandidatePool
from app.services.offline_catalog import load_offline_catalog


def test_offline_catalog_loads_and_validates():
    items = load_offline_catalog()
    assert len(items) >= 30
    assert all(isinstance(i, MediaItem) for i in items)


def test_offline_catalog_has_variety():
    items = load_offline_catalog()
    types = {i.media_type for i in items}
    assert {MediaType.MOVIE, MediaType.TV, MediaType.ANIME} <= types
    # At least a few short titles so the "short" time slot has options.
    assert sum(1 for i in items if i.runtime_minutes and i.runtime_minutes <= 40) >= 5


def test_offline_catalog_passes_vote_floors():
    # Recommendation endpoint filters TMDB >= 7.0 and AniList >= 7.5.
    for i in load_offline_catalog():
        floor = 7.5 if i.media_type == MediaType.ANIME else 7.0
        assert i.vote_average >= floor, f"{i.title} below vote floor"


@pytest.mark.asyncio
async def test_pool_demo_mode_uses_offline_catalog(monkeypatch):
    monkeypatch.setattr("app.services.candidate_pool.settings.tmdb_api_key", "")
    # has_tmdb is a cached_property; clear any cached value.
    monkeypatch.setattr(
        "app.services.candidate_pool.settings",
        _settings_stub(has_tmdb=False),
    )
    pool = CandidatePool(MagicMock(), MagicMock())
    await pool.refresh()
    assert len(pool.candidates) >= 30


def _settings_stub(*, has_tmdb: bool):
    stub = MagicMock()
    stub.has_tmdb = has_tmdb
    return stub
