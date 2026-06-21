import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.exceptions import AppError
from app.middleware import RequestLoggingMiddleware
from app.routers import health, taste, recommend, search, media
from app.services.tmdb_service import TMDBService
from app.services.anilist_service import AniListService
from app.services.candidate_pool import CandidatePool
from app.services.why_now import WhyNowService
from app.llm import build_provider

logging.basicConfig(
    level=getattr(logging, settings.log_level),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Unbored API...")

    tmdb = TMDBService()
    anilist = AniListService()
    await tmdb.initialize()

    pool = CandidatePool(tmdb, anilist)
    await pool.refresh()
    logger.info(f"Candidate pool loaded: {len(pool.candidates)} items")

    app.state.tmdb = tmdb
    app.state.anilist = anilist
    app.state.pool = pool
    app.state.why_now = WhyNowService(settings, build_provider(settings))

    async def refresh_loop():
        while True:
            await asyncio.sleep(settings.pool_refresh_hours * 3600)
            try:
                await pool.refresh()
                logger.info(f"Pool refreshed: {len(pool.candidates)} items")
            except Exception as e:
                logger.error(f"Pool refresh failed: {e}")

    refresh_task = asyncio.create_task(refresh_loop())

    yield

    refresh_task.cancel()
    try:
        await refresh_task
    except asyncio.CancelledError:
        pass
    await app.state.why_now.close()
    await tmdb.close()
    await anilist.close()
    logger.info("Unbored API stopped.")


app = FastAPI(
    title="Unbored API",
    description="Decision paralysis killer — recommendation engine",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(RequestLoggingMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(taste.router, prefix="/api", tags=["taste"])
app.include_router(recommend.router, prefix="/api", tags=["recommend"])
app.include_router(search.router, prefix="/api", tags=["search"])
app.include_router(media.router, prefix="/api", tags=["media"])


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "error_code": exc.error_code},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={
            "detail": str(exc.errors()),
            "error_code": "VALIDATION_ERROR",
        },
    )


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error(f"Unhandled error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred.", "error_code": "INTERNAL_ERROR"},
    )
