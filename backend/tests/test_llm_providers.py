"""Tests for LLM providers and the selection factory."""

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from app.config import Settings
from app.llm.factory import build_provider
from app.llm.gemini import GeminiProvider, build_request_body as gemini_body
from app.llm.gemini import extract_text as gemini_extract
from app.llm.openai_compatible import (
    OpenAICompatibleProvider,
    build_payload,
    extract_text as oai_extract,
)


# ── Gemini response parsing ─────────────────────────────────


def test_gemini_body_structure():
    body = gemini_body("sys", "usr", temperature=0.7, max_tokens=100)
    assert body["contents"][0]["parts"][0]["text"] == "usr"
    assert body["systemInstruction"]["parts"][0]["text"] == "sys"
    assert body["generationConfig"]["maxOutputTokens"] == 100


def test_gemini_extract_valid():
    resp = {"candidates": [{"content": {"parts": [{"text": "Hello there."}]}, "finishReason": "STOP"}]}
    assert gemini_extract(resp) == "Hello there."


@pytest.mark.parametrize(
    "resp",
    [
        {"candidates": []},
        {},
        {"candidates": [{"content": {"parts": [{"text": "x"}]}, "finishReason": "SAFETY"}]},
        {"candidates": [{"content": {}, "finishReason": "STOP"}]},
        {"candidates": [{"content": {"parts": [{"text": "  "}]}, "finishReason": "STOP"}]},
    ],
)
def test_gemini_extract_invalid(resp):
    assert gemini_extract(resp) is None


# ── OpenAI-compatible response parsing ──────────────────────


def test_oai_payload_structure():
    payload = build_payload("deepseek-chat", "sys", "usr", temperature=0.5, max_tokens=80)
    assert payload["model"] == "deepseek-chat"
    assert payload["messages"][0] == {"role": "system", "content": "sys"}
    assert payload["messages"][1] == {"role": "user", "content": "usr"}
    assert payload["max_tokens"] == 80


def test_oai_extract_valid():
    resp = {"choices": [{"message": {"role": "assistant", "content": "A fine pick."}}]}
    assert oai_extract(resp) == "A fine pick."


@pytest.mark.parametrize("resp", [{"choices": []}, {}, {"choices": [{"message": {"content": ""}}]}])
def test_oai_extract_invalid(resp):
    assert oai_extract(resp) is None


# ── Provider HTTP behaviour (mocked client) ─────────────────


def _resp(status, json_body=None):
    r = MagicMock()
    r.status_code = status
    r.text = "error"
    r.json.return_value = json_body or {}
    return r


@pytest.mark.asyncio
async def test_gemini_generate_success():
    p = GeminiProvider(api_key="k", model="gemini-2.0-flash", base_url="https://x/v1beta")
    p._client = MagicMock(is_closed=False)
    p._client.post = AsyncMock(
        return_value=_resp(200, {"candidates": [{"content": {"parts": [{"text": "Nice."}]}}]})
    )
    assert await p.generate(system="s", user="u") == "Nice."


@pytest.mark.asyncio
async def test_gemini_generate_timeout_returns_none():
    p = GeminiProvider(api_key="k", model="m", base_url="https://x")
    p._client = MagicMock(is_closed=False)
    p._client.post = AsyncMock(side_effect=httpx.TimeoutException("t"))
    assert await p.generate(system="s", user="u") is None


@pytest.mark.asyncio
async def test_gemini_500_retries_once_then_succeeds():
    p = GeminiProvider(api_key="k", model="m", base_url="https://x")
    p._client = MagicMock(is_closed=False)
    p._client.post = AsyncMock(
        side_effect=[_resp(500), _resp(200, {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]})]
    )
    assert await p.generate(system="s", user="u") == "ok"
    assert p._client.post.call_count == 2


@pytest.mark.asyncio
async def test_openai_compatible_success():
    p = OpenAICompatibleProvider(name="deepseek", api_key="k", model="deepseek-chat", base_url="https://api.deepseek.com/v1")
    p._client = MagicMock(is_closed=False)
    p._client.post = AsyncMock(
        return_value=_resp(200, {"choices": [{"message": {"content": "Great fit."}}]})
    )
    assert await p.generate(system="s", user="u") == "Great fit."


@pytest.mark.asyncio
async def test_openai_compatible_401_no_retry():
    p = OpenAICompatibleProvider(name="openai", api_key="bad", model="gpt-4o-mini", base_url="https://api.openai.com/v1")
    p._client = MagicMock(is_closed=False)
    p._client.post = AsyncMock(return_value=_resp(401))
    assert await p.generate(system="s", user="u") is None
    assert p._client.post.call_count == 1


# ── Factory selection ───────────────────────────────────────


def _settings(**kw) -> Settings:
    base = {
        "tmdb_api_key": "", "gemini_api_key": "", "deepseek_api_key": "",
        "openai_api_key": "", "openrouter_api_key": "", "llm_provider": "auto",
    }
    base.update(kw)
    return Settings(**base)


def test_factory_none_when_no_keys():
    assert build_provider(_settings()) is None


def test_factory_auto_prefers_gemini():
    p = build_provider(_settings(gemini_api_key="g", deepseek_api_key="d"))
    assert p is not None and p.name == "gemini"


def test_factory_auto_falls_to_deepseek():
    p = build_provider(_settings(deepseek_api_key="d"))
    assert p is not None and p.name == "deepseek"


def test_factory_explicit_provider():
    p = build_provider(_settings(gemini_api_key="g", deepseek_api_key="d", llm_provider="deepseek"))
    assert p is not None and p.name == "deepseek"


def test_factory_explicit_without_key_is_none():
    assert build_provider(_settings(llm_provider="openai")) is None


def test_factory_explicit_none():
    assert build_provider(_settings(gemini_api_key="g", llm_provider="none")) is None


def test_factory_openrouter():
    p = build_provider(_settings(openrouter_api_key="o", llm_provider="openrouter"))
    assert p is not None and p.name == "openrouter"
