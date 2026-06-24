"""Health and status endpoints.

`/health` is a lightweight liveness check. `/status` describes the running
configuration — the catalog size and that AI picks are bring-your-own-key.
"""

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/health")
async def health_check(request: Request):
    pool = request.app.state.pool
    return {"status": "ok", "version": "3.0.0", "catalog_size": len(pool.candidates)}


@router.get("/status")
async def status(request: Request):
    pool = request.app.state.pool
    return {
        "status": "ok",
        "version": "3.0.0",
        "catalog": {"size": len(pool.candidates)},
        "llm": {"mode": "byok", "providers": ["gemini", "deepseek"]},
    }
