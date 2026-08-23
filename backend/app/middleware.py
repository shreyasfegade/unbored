import logging
import time
import uuid
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger("unbored.http")


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-IP sliding-window limiter for the abusable endpoints.

    Dependency-free (in-memory). Chiefly protects /api/llm/validate — which
    makes an outbound LLM call with a caller-supplied key and is otherwise a free
    key-testing oracle — and /api/recommend (per-request CPU). Generous limits;
    real abuse control belongs at the edge, this is a floor.
    """

    # path prefix -> (max requests, window seconds)
    _LIMITS = {
        "/api/llm": (20, 60),
        "/api/recommend": (60, 60),
    }

    def __init__(self, app):
        super().__init__(app)
        self._hits: dict[str, deque] = defaultdict(deque)

    def _limit_for(self, path: str):
        for prefix, limit in self._LIMITS.items():
            if path.startswith(prefix):
                return prefix, limit
        return None, None

    async def dispatch(self, request: Request, call_next):
        prefix, limit = self._limit_for(request.url.path)
        if limit is not None:
            max_req, window = limit
            ip = request.client.host if request.client else "unknown"
            key = f"{ip}:{prefix}"
            now = time.monotonic()
            bucket = self._hits[key]
            while bucket and now - bucket[0] > window:
                bucket.popleft()
            if len(bucket) >= max_req:
                retry = int(window - (now - bucket[0])) + 1
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many requests. Slow down.", "error_code": "RATE_LIMITED"},
                    headers={"Retry-After": str(retry)},
                )
            bucket.append(now)
        return await call_next(request)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = str(uuid.uuid4())[:8]
        start = time.perf_counter()

        logger.info(
            "→ %s %s [%s] body_size=%s",
            request.method,
            request.url.path,
            request_id,
            request.headers.get("content-length", "0"),
        )

        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000

        logger.info(
            "← %s %s [%s] status=%d elapsed=%.1fms",
            request.method,
            request.url.path,
            request_id,
            response.status_code,
            elapsed_ms,
        )

        response.headers["X-Request-ID"] = request_id
        return response
