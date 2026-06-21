"""Tests for the provider-agnostic WhyNowService and its helpers."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.recommendation import WhyNowContext
from app.services.why_now import (
    FALLBACK_SENTENCES,
    FORBIDDEN_PATTERNS,
    WhyNowService,
    _WhyNowCache,
    build_user_prompt,
    get_fallback,
    make_cache_key,
    post_process,
    validate,
)


@pytest.fixture
def sample_context() -> WhyNowContext:
    return WhyNowContext(
        title="Blade Runner 2049",
        year=2017,
        genres=["Science Fiction", "Drama", "Mystery"],
        runtime_minutes=164,
        rating=7.5,
        top_keywords=["dystopia", "android", "neo-noir", "sequel", "replicant"],
        time_of_day="late_night",
        time_available="long",
        genre_score_pct=78,
        keyword_score_pct=62,
        media_id="tmdb_335984",
        mood="mindblown",
    )


def _settings(ttl: int = 3600) -> MagicMock:
    s = MagicMock()
    s.llm_cache_ttl_seconds = ttl
    return s


# ── Prompt building ─────────────────────────────────────────


def test_build_user_prompt(sample_context):
    prompt = build_user_prompt(sample_context)
    assert "Blade Runner 2049 (2017)" in prompt
    assert "Science Fiction, Drama, Mystery" in prompt
    assert "164 minutes" in prompt
    assert "7.5/10" in prompt
    assert "late night" in prompt
    assert "2+ hours" in prompt
    assert "genre overlap (78%)" in prompt
    assert "Write one sentence." in prompt


def test_build_user_prompt_empty_collections():
    ctx = WhyNowContext(
        title="Test", year=2020, genres=[], runtime_minutes=90, rating=7.0,
        top_keywords=[], time_of_day="morning", time_available="short",
        genre_score_pct=50, keyword_score_pct=50, media_id="tmdb_1", mood="happy",
    )
    prompt = build_user_prompt(ctx)
    assert "Genres: Unknown" in prompt
    assert "Keywords: None" in prompt


# ── post_process ────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw,expected",
    [
        ('"Hello."', "Hello."),
        ("'Hello.'", "Hello."),
        ("First sentence. Second sentence.", "First sentence."),
        ("Great fit! But also more.", "Great fit!"),
        ("No ending", "No ending."),
        ("Wow!", "Wow!"),
        ("Right?", "Right?"),
    ],
)
def test_post_process(raw, expected):
    assert post_process(raw) == expected


# ── validate ────────────────────────────────────────────────


def test_validate_clean():
    assert validate("Late-night pacing makes this a perfect fit.") is True


@pytest.mark.parametrize("pattern", FORBIDDEN_PATTERNS)
def test_validate_rejects_forbidden(pattern):
    assert validate(f"This is a {pattern} pick.") is False


def test_validate_case_insensitive():
    assert validate("You Seem tired today.") is False


# ── fallback + cache key ────────────────────────────────────


def test_fallback_deterministic_and_valid():
    a = get_fallback("Inception", "evening")
    assert a == get_fallback("Inception", "evening")
    assert a in FALLBACK_SENTENCES


def test_cache_key_components(sample_context):
    key = make_cache_key(sample_context)
    assert key.startswith("whynow:")
    assert "tmdb_335984" in key and "mindblown" in key


def test_cache_set_get_expiry():
    cache = _WhyNowCache(ttl_seconds=60)
    cache.set("k", "v")
    assert cache.get("k") == "v"
    assert cache.get("missing") is None
    expired = _WhyNowCache(ttl_seconds=0)
    expired.set("k", "v")
    assert expired.get("k") is None


# ── Service behaviour (mocked provider) ─────────────────────


@pytest.mark.asyncio
async def test_offline_uses_fallback(sample_context):
    service = WhyNowService(_settings(), provider=None)
    result = await service.generate_why_now(sample_context)
    assert result.source == "fallback"
    assert result.provider is None
    assert result.sentence in FALLBACK_SENTENCES


@pytest.mark.asyncio
async def test_provider_success(sample_context):
    provider = MagicMock()
    provider.name = "deepseek"
    provider.model = "deepseek-chat"
    provider.generate = AsyncMock(return_value="Neo-noir atmosphere fits this late hour.")
    service = WhyNowService(_settings(), provider=provider)

    result = await service.generate_why_now(sample_context)
    assert result.source == "llm"
    assert result.provider == "deepseek"
    assert result.sentence == "Neo-noir atmosphere fits this late hour."


@pytest.mark.asyncio
async def test_cache_hit_skips_provider(sample_context):
    provider = MagicMock()
    provider.name = "gemini"
    provider.model = "gemini-2.0-flash"
    provider.generate = AsyncMock(return_value="Cached sentence here.")
    service = WhyNowService(_settings(), provider=provider)

    first = await service.generate_why_now(sample_context)
    assert first.source == "llm"

    provider.generate.reset_mock()
    second = await service.generate_why_now(sample_context)
    assert second.source == "cache"
    assert second.sentence == "Cached sentence here."
    provider.generate.assert_not_called()


@pytest.mark.asyncio
async def test_provider_failure_falls_back(sample_context):
    provider = MagicMock()
    provider.name = "openai"
    provider.model = "gpt-4o-mini"
    provider.generate = AsyncMock(return_value=None)
    service = WhyNowService(_settings(), provider=provider)

    result = await service.generate_why_now(sample_context)
    assert result.source == "fallback"
    assert result.sentence in FALLBACK_SENTENCES


@pytest.mark.asyncio
async def test_forbidden_output_falls_back(sample_context):
    provider = MagicMock()
    provider.name = "gemini"
    provider.model = "gemini-2.0-flash"
    provider.generate = AsyncMock(return_value="A great film for when you're feeling lonely.")
    service = WhyNowService(_settings(), provider=provider)

    result = await service.generate_why_now(sample_context)
    assert result.source == "fallback"


@pytest.mark.asyncio
async def test_status_reports_provider():
    provider = MagicMock()
    provider.name = "deepseek"
    provider.model = "deepseek-chat"
    provider.label = "deepseek · deepseek-chat"
    service = WhyNowService(_settings(), provider=provider)
    assert service.status == {
        "configured": True,
        "provider": "deepseek",
        "model": "deepseek-chat",
        "label": "deepseek · deepseek-chat",
    }


@pytest.mark.asyncio
async def test_status_offline():
    service = WhyNowService(_settings(), provider=None)
    assert service.status["configured"] is False
    assert service.status["provider"] is None
