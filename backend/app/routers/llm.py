"""Endpoint to validate a user-supplied LLM key (BYO key).

The key arrives in the `X-LLM-Key` header and is used for a single tiny
generation to confirm it works. It is never logged or persisted.
"""

from __future__ import annotations

from fastapi import APIRouter, Header, Request

router = APIRouter()


@router.post("/llm/validate")
async def validate_llm(
    request: Request,
    x_llm_provider: str | None = Header(default=None),
    x_llm_key: str | None = Header(default=None),
):
    cache = request.app.state.provider_cache
    provider = cache.get(x_llm_provider or "", x_llm_key or "")
    if provider is None:
        return {"ok": False, "error": "Choose Gemini or DeepSeek and paste a key."}

    try:
        out = await provider.generate(
            system="Reply with exactly: ok", user="ping", temperature=0.0, max_tokens=5
        )
    except Exception:
        out = None

    if out is None:
        return {"ok": False, "provider": provider.name, "error": "That key was rejected by the provider."}

    return {"ok": True, "provider": provider.name, "model": provider.model, "error": None}
