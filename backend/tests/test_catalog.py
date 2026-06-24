"""Tests for the self-owned catalog and the candidate pool that serves it."""

import pytest

from app.models.media import MediaItem, MediaType
from app.services.candidate_pool import CandidatePool
from app.services.catalog import load_catalog


def test_catalog_loads_and_validates():
    items = load_catalog()
    assert len(items) >= 300
    assert all(isinstance(i, MediaItem) for i in items)


def test_catalog_spans_all_media_types():
    types = {i.media_type for i in load_catalog()}
    assert {MediaType.MOVIE, MediaType.TV, MediaType.ANIME} <= types


def test_catalog_items_are_rich():
    items = load_catalog()
    with_overview = sum(1 for i in items if (i.overview or "").strip())
    assert with_overview / len(items) > 0.8  # most have real text for TF-IDF


@pytest.mark.asyncio
async def test_pool_serves_catalog():
    pool = CandidatePool()
    await pool.refresh()
    assert len(pool.candidates) >= 300


@pytest.mark.asyncio
async def test_pool_exclusions():
    pool = CandidatePool()
    await pool.refresh()
    first = pool.candidates[0].id
    remaining = pool.get_candidates(exclude_ids=[first])
    assert all(c.id != first for c in remaining)
    assert len(remaining) == len(pool.candidates) - 1
