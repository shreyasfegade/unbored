"""Tests for GeminiService — unit tests for helpers and integration tests with mocked HTTP."""

import hashlib
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import httpx
import time as _time

from app.services.gemini_service import (
    GeminiService,
    _build_user_prompt,
    _build_request_body,
    _extract_sentence,
    _post_process,
    _validate,
    _get_fallback,
    _make_cache_key,
    _WhyNowCache,
    FORBIDDEN_PATTERNS,
    FALLBACK_SENTENCES,
)
from app.models.recommendation import WhyNowContext, WhyNowResult


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
        media_id="tmdb:335984",
        mood="mindblown",
    )


@pytest.fixture
def mock_gemini_response() -> dict:
    return {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "text": "Neo-noir atmosphere and sprawling runtime make this ideal for a late-night deep dive."
                        }
                    ],
                    "role": "model",
                },
                "finishReason": "STOP",
                "index": 0,
            }
        ],
        "usageMetadata": {
            "promptTokenCount": 150,
            "candidatesTokenCount": 22,
            "totalTokenCount": 172,
        },
    }


def _make_settings(**overrides) -> MagicMock:
    defaults = {
        "gemini_api_key": "test-key",
        "gemini_model": "gemini-2.0-flash",
        "gemini_base_url": "https://generativelanguage.googleapis.com/v1beta",
        "gemini_timeout_seconds": 5.0,
        "gemini_cache_ttl_seconds": 3600,
    }
    defaults.update(overrides)
    mock = MagicMock()
    for k, v in defaults.items():
        setattr(mock, k, v)
    return mock


# ── Unit: _build_user_prompt ────────────────────────────────


def test_build_user_prompt(sample_context):
    prompt = _build_user_prompt(sample_context)
    assert "Blade Runner 2049 (2017)" in prompt
    assert "Science Fiction, Drama, Mystery" in prompt
    assert "164 minutes" in prompt
    assert "7.5/10" in prompt
    assert "dystopia, android, neo-noir, sequel, replicant" in prompt
    assert "late night" in prompt
    assert "2+ hours" in prompt
    assert "genre overlap (78%)" in prompt
    assert "keyword overlap (62%)" in prompt
    assert "Write one sentence." in prompt


def test_build_user_prompt_empty_genres():
    ctx = WhyNowContext(
        title="Test", year=2020, genres=[], runtime_minutes=90,
        rating=7.0, top_keywords=[], time_of_day="morning",
        time_available="short", genre_score_pct=50, keyword_score_pct=50,
        media_id="tmdb:123", mood="happy",
    )
    prompt = _build_user_prompt(ctx)
    assert "Genres: Unknown" in prompt


def test_build_user_prompt_empty_keywords():
    ctx = WhyNowContext(
        title="Test", year=2020, genres=["Action"], runtime_minutes=90,
        rating=7.0, top_keywords=[], time_of_day="morning",
        time_available="short", genre_score_pct=50, keyword_score_pct=50,
        media_id="tmdb:123", mood="happy",
    )
    prompt = _build_user_prompt(ctx)
    assert "Keywords: None" in prompt


def test_build_user_prompt_time_available_mapping():
    ctx = WhyNowContext(
        title="Test", year=2020, genres=["Action"], runtime_minutes=30,
        rating=7.0, top_keywords=[], time_of_day="evening",
        time_available="short", genre_score_pct=50, keyword_score_pct=50,
        media_id="tmdb:123", mood="happy",
    )
    prompt = _build_user_prompt(ctx)
    assert "~20 minutes" in prompt


# ── Unit: _build_request_body ───────────────────────────────


def test_build_request_body_structure():
    body = _build_request_body("Test prompt")
    assert "contents" in body
    assert "systemInstruction" in body
    assert "generationConfig" in body
    assert "safetySettings" in body
    assert body["contents"][0]["parts"][0]["text"] == "Test prompt"
    assert body["generationConfig"]["temperature"] == 0.7
    assert body["generationConfig"]["maxOutputTokens"] == 100


# ── Unit: _extract_sentence ─────────────────────────────────


def test_extract_sentence_valid(mock_gemini_response):
    result = _extract_sentence(mock_gemini_response)
    assert result == "Neo-noir atmosphere and sprawling runtime make this ideal for a late-night deep dive."


def test_extract_sentence_empty_candidates():
    assert _extract_sentence({"candidates": []}) is None


def test_extract_sentence_safety_blocked():
    resp = {
        "candidates": [
            {
                "content": {"parts": [{"text": "some text"}]},
                "finishReason": "SAFETY",
            }
        ]
    }
    assert _extract_sentence(resp) is None


def test_extract_sentence_missing_parts():
    resp = {
        "candidates": [
            {
                "content": {},
                "finishReason": "STOP",
            }
        ]
    }
    assert _extract_sentence(resp) is None


def test_extract_sentence_empty_text():
    resp = {
        "candidates": [
            {
                "content": {"parts": [{"text": "   "}]},
                "finishReason": "STOP",
            }
        ]
    }
    assert _extract_sentence(resp) is None


def test_extract_sentence_no_candidates_key():
    assert _extract_sentence({}) is None


# ── Unit: _post_process ─────────────────────────────────────


def test_post_process_strips_double_quotes():
    assert _post_process('"Hello."') == "Hello."


def test_post_process_strips_single_quotes():
    assert _post_process("'Hello.'") == "Hello."


def test_post_process_truncates_multi_sentence():
    result = _post_process("First sentence. Second sentence.")
    assert result == "First sentence."


def test_post_process_truncates_multi_sentence_exclamation():
    result = _post_process("Great fit! But also something else.")
    assert result == "Great fit!"


def test_post_process_adds_period():
    assert _post_process("No ending") == "No ending."


def test_post_process_preserves_exclamation():
    assert _post_process("Wow!") == "Wow!"


def test_post_process_preserves_question():
    assert _post_process("Right?") == "Right?"


# ── Unit: _validate ─────────────────────────────────────────


def test_validate_clean_sentence():
    assert _validate("Late-night pacing makes this a perfect fit.") is True


@pytest.mark.parametrize("pattern", FORBIDDEN_PATTERNS)
def test_validate_forbidden_exact(pattern):
    sentence = f"This is a {pattern} movie recommendation."
    assert _validate(sentence) is False


def test_validate_case_insensitive():
    assert _validate("You Seem tired today.") is False


def test_validate_substring_match():
    assert _validate("A great feeling tonight makes this special.") is False


# ── Unit: _get_fallback ─────────────────────────────────────


def test_fallback_deterministic():
    a1 = _get_fallback("Inception", "evening")
    a2 = _get_fallback("Inception", "evening")
    assert a1 == a2


def test_fallback_varies_by_title():
    a = _get_fallback("Inception", "evening")
    b = _get_fallback("Matrix", "evening")
    # Different titles *usually* map to different indices, but it's a hash so could collide.
    # We just check it's a valid fallback.
    assert a in FALLBACK_SENTENCES
    assert b in FALLBACK_SENTENCES


def test_fallback_varies_by_time():
    a = _get_fallback("Inception", "morning")
    b = _get_fallback("Inception", "evening")
    assert a in FALLBACK_SENTENCES
    assert b in FALLBACK_SENTENCES


# ── Unit: _make_cache_key ───────────────────────────────────


def test_cache_key_format(sample_context):
    key = _make_cache_key(sample_context)
    assert key.startswith("whynow:")
    assert "tmdb:335984" in key
    assert "mindblown" in key
    assert "late_night" in key
    assert "long" in key


def test_cache_key_differs_by_mood(sample_context):
    ctx1 = sample_context
    ctx2 = sample_context.model_copy(update={"mood": "happy_energetic"})
    assert _make_cache_key(ctx1) != _make_cache_key(ctx2)


# ── Unit: _WhyNowCache ──────────────────────────────────────


def test_cache_set_and_get():
    cache = _WhyNowCache(ttl_seconds=60)
    cache.set("key1", "hello")
    assert cache.get("key1") == "hello"


def test_cache_miss():
    cache = _WhyNowCache(ttl_seconds=60)
    assert cache.get("missing") is None


def test_cache_expiry():
    cache = _WhyNowCache(ttl_seconds=0)  # expires immediately
    cache.set("key1", "hello")
    assert cache.get("key1") is None


def test_cache_clear_expired():
    cache = _WhyNowCache(ttl_seconds=0)
    cache.set("key1", "hello")
    cache.set("key2", "world")
    cache.clear_expired()
    assert cache.get("key1") is None
    assert cache.get("key2") is None


# ── Integration: generate_why_now (mocked HTTP) ─────────────


@pytest.mark.asyncio
async def test_generate_why_now_success(sample_context, mock_gemini_response):
    settings = _make_settings()
    mock_client = MagicMock()
    mock_client.is_closed = False
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = mock_gemini_response
    mock_client.post = AsyncMock(return_value=mock_response)

    service = GeminiService(settings)
    service._client = mock_client

    result = await service.generate_why_now(sample_context)
    assert result.sentence == "Neo-noir atmosphere and sprawling runtime make this ideal for a late-night deep dive."
    assert result.source == "gemini"


@pytest.mark.asyncio
async def test_generate_why_now_cache_hit(sample_context):
    settings = _make_settings()
    mock_client = MagicMock()
    mock_client.is_closed = False
    mock_client.post = AsyncMock()

    service = GeminiService(settings)
    service._client = mock_client

    # First call — populate cache
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "candidates": [
            {
                "content": {"parts": [{"text": "Cached sentence."}]},
                "finishReason": "STOP",
            }
        ]
    }
    mock_client.post.return_value = mock_response

    result1 = await service.generate_why_now(sample_context)
    assert result1.source == "gemini"

    # Second call — should hit cache, no HTTP call
    mock_client.post.reset_mock()
    result2 = await service.generate_why_now(sample_context)
    assert result2.source == "cache"
    assert result2.sentence == "Cached sentence."
    mock_client.post.assert_not_called()


@pytest.mark.asyncio
async def test_generate_why_now_timeout(sample_context):
    settings = _make_settings()
    mock_client = MagicMock()
    mock_client.is_closed = False
    mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("timeout"))

    service = GeminiService(settings)
    service._client = mock_client

    result = await service.generate_why_now(sample_context)
    assert result.source == "fallback"
    assert result.sentence in FALLBACK_SENTENCES


@pytest.mark.asyncio
async def test_generate_why_now_429(sample_context):
    settings = _make_settings()
    mock_client = MagicMock()
    mock_client.is_closed = False
    mock_response = MagicMock()
    mock_response.status_code = 429
    mock_response.text = "Rate limited"
    mock_client.post = AsyncMock(return_value=mock_response)

    service = GeminiService(settings)
    service._client = mock_client

    result = await service.generate_why_now(sample_context)
    assert result.source == "fallback"
    # Should NOT retry on 429
    assert mock_client.post.call_count == 1


@pytest.mark.asyncio
async def test_generate_why_now_500_retry_succeeds(sample_context, mock_gemini_response):
    settings = _make_settings()
    mock_client = MagicMock()
    mock_client.is_closed = False

    fail_response = MagicMock()
    fail_response.status_code = 500
    fail_response.text = "Server error"

    success_response = MagicMock()
    success_response.status_code = 200
    success_response.json.return_value = mock_gemini_response

    mock_client.post = AsyncMock(side_effect=[fail_response, success_response])

    service = GeminiService(settings)
    service._client = mock_client

    result = await service.generate_why_now(sample_context)
    assert result.source == "gemini"
    assert mock_client.post.call_count == 2


@pytest.mark.asyncio
async def test_generate_why_now_500_retry_fails(sample_context):
    settings = _make_settings()
    mock_client = MagicMock()
    mock_client.is_closed = False

    fail_response = MagicMock()
    fail_response.status_code = 500
    fail_response.text = "Server error"

    mock_client.post = AsyncMock(side_effect=[fail_response, fail_response])

    service = GeminiService(settings)
    service._client = mock_client

    result = await service.generate_why_now(sample_context)
    assert result.source == "fallback"
    assert mock_client.post.call_count == 2


@pytest.mark.asyncio
async def test_generate_why_now_forbidden_word(sample_context):
    settings = _make_settings()
    mock_client = MagicMock()
    mock_client.is_closed = False
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "candidates": [
            {
                "content": {"parts": [{"text": "A great film for when you're feeling lonely."}]},
                "finishReason": "STOP",
            }
        ]
    }
    mock_client.post = AsyncMock(return_value=mock_response)

    service = GeminiService(settings)
    service._client = mock_client

    result = await service.generate_why_now(sample_context)
    assert result.source == "fallback"


@pytest.mark.asyncio
async def test_generate_why_now_no_api_key(sample_context):
    settings = _make_settings(gemini_api_key="")
    service = GeminiService(settings)

    result = await service.generate_why_now(sample_context)
    assert result.source == "fallback"
    assert result.sentence in FALLBACK_SENTENCES


@pytest.mark.asyncio
async def test_generate_why_now_safety_filter(sample_context):
    settings = _make_settings()
    mock_client = MagicMock()
    mock_client.is_closed = False
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "candidates": [
            {
                "content": {"parts": [{"text": "Blocked"}]},
                "finishReason": "SAFETY",
            }
        ]
    }
    mock_client.post = AsyncMock(return_value=mock_response)

    service = GeminiService(settings)
    service._client = mock_client

    result = await service.generate_why_now(sample_context)
    assert result.source == "fallback"


@pytest.mark.asyncio
async def test_generate_why_now_bad_request(sample_context):
    settings = _make_settings()
    mock_client = MagicMock()
    mock_client.is_closed = False
    mock_response = MagicMock()
    mock_response.status_code = 400
    mock_response.text = "Invalid request"
    mock_client.post = AsyncMock(return_value=mock_response)

    service = GeminiService(settings)
    service._client = mock_client

    result = await service.generate_why_now(sample_context)
    assert result.source == "fallback"
    # Should NOT retry on 400
    assert mock_client.post.call_count == 1


# ── close() ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_close_without_client():
    settings = _make_settings()
    service = GeminiService(settings)
    await service.close()  # should not raise


@pytest.mark.asyncio
async def test_close_with_client():
    settings = _make_settings()
    mock_client = MagicMock()
    mock_client.is_closed = False
    mock_client.aclose = AsyncMock()

    service = GeminiService(settings)
    service._client = mock_client

    await service.close()
    mock_client.aclose.assert_called_once()
    assert service._client is None
