"""Google Gemini provider (REST generateContent API)."""

from __future__ import annotations

import logging

import httpx

from app.llm.base import LLMProvider

logger = logging.getLogger(__name__)


def build_request_body(
    system: str, user: str, *, temperature: float, max_tokens: int
) -> dict:
    return {
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "systemInstruction": {"parts": [{"text": system}]},
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
            "topP": 0.9,
            "topK": 40,
        },
        "safetySettings": [
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
        ],
    }


def extract_text(response_json: dict) -> str | None:
    """Pull the generated text out of a Gemini response. ``None`` on failure."""
    try:
        candidates = response_json.get("candidates")
        if not candidates:
            return None
        candidate = candidates[0]
        if candidate.get("finishReason") == "SAFETY":
            logger.warning("Gemini response blocked by safety filter")
            return None
        parts = candidate.get("content", {}).get("parts")
        if not parts:
            return None
        text = parts[0].get("text", "").strip()
        return text or None
    except (KeyError, IndexError, TypeError, AttributeError):
        return None


class GeminiProvider(LLMProvider):
    name = "gemini"

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str,
        timeout: float = 8.0,
    ) -> None:
        self.model = model
        self._api_key = api_key
        self._timeout = timeout
        self._endpoint = f"{base_url.rstrip('/')}/models/{model}:generateContent"
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self._timeout, connect=5.0),
                headers={"Content-Type": "application/json"},
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
        body = build_request_body(
            system, user, temperature=temperature, max_tokens=max_tokens
        )
        url = f"{self._endpoint}?key={self._api_key}"
        return await self._call(url, body, is_retry=False)

    async def _call(self, url: str, body: dict, *, is_retry: bool) -> str | None:
        client = await self._get_client()
        try:
            response = await client.post(url, json=body)
        except httpx.TimeoutException:
            logger.warning("Gemini request timed out after %.1fs", self._timeout)
            return None
        except httpx.HTTPError as exc:
            logger.error("Gemini HTTP error: %s", exc)
            return None

        status = response.status_code
        if status == 429:
            logger.warning("Gemini rate limited (429); using fallback")
            return None
        if status == 400:
            logger.error("Gemini bad request (400): %s", response.text[:300])
            return None
        if status >= 500:
            if not is_retry:
                logger.warning("Gemini server error (%d); retrying once", status)
                return await self._call(url, body, is_retry=True)
            logger.error("Gemini server error (%d) on retry; using fallback", status)
            return None
        if status != 200:
            logger.error("Gemini unexpected status %d", status)
            return None

        try:
            return extract_text(response.json())
        except Exception:
            logger.error("Gemini response was not valid JSON")
            return None

    async def close(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
