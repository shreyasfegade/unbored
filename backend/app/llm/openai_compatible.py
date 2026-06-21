"""Provider for any OpenAI-compatible Chat Completions endpoint.

DeepSeek, OpenAI, OpenRouter, Groq, Together, and most local servers (Ollama,
LM Studio, vLLM) all speak the same ``POST /chat/completions`` contract, so a
single implementation covers them — only the base URL, model, and key differ.
"""

from __future__ import annotations

import logging

import httpx

from app.llm.base import LLMProvider

logger = logging.getLogger(__name__)


def build_payload(
    model: str, system: str, user: str, *, temperature: float, max_tokens: int
) -> dict:
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }


def extract_text(response_json: dict) -> str | None:
    """Pull text from an OpenAI-style chat completion response."""
    try:
        choices = response_json.get("choices")
        if not choices:
            return None
        message = choices[0].get("message", {})
        text = (message.get("content") or "").strip()
        return text or None
    except (KeyError, IndexError, TypeError, AttributeError):
        return None


class OpenAICompatibleProvider(LLMProvider):
    def __init__(
        self,
        *,
        name: str,
        api_key: str,
        model: str,
        base_url: str,
        timeout: float = 8.0,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        self.name = name
        self.model = model
        self._api_key = api_key
        self._timeout = timeout
        self._endpoint = f"{base_url.rstrip('/')}/chat/completions"
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            **(extra_headers or {}),
        }
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self._timeout, connect=5.0),
                headers=self._headers,
            )
        return self._client

    async def generate(
        self,
        *,
        system: str,
        user: str,
        temperature: float = 0.7,
        max_tokens: int = 120,
    ) -> str | None:
        payload = build_payload(
            self.model, system, user, temperature=temperature, max_tokens=max_tokens
        )
        return await self._call(payload, is_retry=False)

    async def _call(self, payload: dict, *, is_retry: bool) -> str | None:
        client = await self._get_client()
        try:
            response = await client.post(self._endpoint, json=payload)
        except httpx.TimeoutException:
            logger.warning("%s request timed out after %.1fs", self.name, self._timeout)
            return None
        except httpx.HTTPError as exc:
            logger.error("%s HTTP error: %s", self.name, exc)
            return None

        status = response.status_code
        if status == 429:
            logger.warning("%s rate limited (429); using fallback", self.name)
            return None
        if status in (400, 401, 403):
            logger.error("%s request rejected (%d): %s", self.name, status, response.text[:300])
            return None
        if status >= 500:
            if not is_retry:
                logger.warning("%s server error (%d); retrying once", self.name, status)
                return await self._call(payload, is_retry=True)
            logger.error("%s server error (%d) on retry; using fallback", self.name, status)
            return None
        if status != 200:
            logger.error("%s unexpected status %d", self.name, status)
            return None

        try:
            return extract_text(response.json())
        except Exception:
            logger.error("%s response was not valid JSON", self.name)
            return None

    async def close(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
