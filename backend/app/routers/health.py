"""Health and status endpoints.

`/health` is a lightweight liveness check that reports degraded when the catalog
failed to load (an empty pool means every recommendation would 500).
`/status` describes the running configuration.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Request

from app.config import APP_VERSION
from app.services import metrics
from app.services.catalog import catalog_metadata

router = APIRouter()


def _catalog_age_days(generated_at: str | None) -> float | None:
    if not generated_at:
        return None
    try:
        gen = datetime.fromisoformat(generated_at)
        if gen.tzinfo is None:
            gen = gen.replace(tzinfo=timezone.utc)
        return round((datetime.now(timezone.utc) - gen).total_seconds() / 86400, 1)
    except (ValueError, TypeError):
        return None


@router.get("/health")
async def health_check(request: Request):
    size = len(request.app.state.pool.candidates)
    status = "ok" if size > 0 else "degraded"
    return {"status": status, "version": APP_VERSION, "catalog_size": size}


@router.get("/status")
async def status(request: Request):
    size = len(request.app.state.pool.candidates)
    meta = catalog_metadata()
    return {
        "status": "ok" if size > 0 else "degraded",
        "version": APP_VERSION,
        "catalog": {
            "size": size,
            "generated_at": meta.get("generated_at"),
            "age_days": _catalog_age_days(meta.get("generated_at")),
            "attribution": meta.get("attribution"),
        },
        "llm": {"mode": "byok", "providers": ["gemini", "deepseek"]},
        "metrics": metrics.snapshot(),
    }
