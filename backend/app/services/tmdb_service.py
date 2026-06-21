"""TMDB API service — singleton, async, cached, rate-limited.

This module handles ALL communication with the TMDB API.
No other module should make direct HTTP calls to TMDB.
"""

from __future__ import annotations
import asyncio
import logging
import time
from typing import Any
import httpx

from app.config import settings
from app.models.genres import TMDB_MOVIE_GENRE_MAP, TMDB_TV_GENRE_MAP, normalize_genre, slugify_keyword
from app.models.media import MediaItem, MediaType, MediaSource
from app.models.tmdb import (
    TMDBGenreListResponse,
    TMDBMovieDetail,
    TMDBMovieKeywordsResponse,
    TMDBMovieListResponse,
    TMDBSearchMultiResponse,
    TMDBTVDetail,
    TMDBTVKeywordsResponse,
    TMDBTVListResponse,
    TMDBCredits,
)
from app.services.tmdb_constants import (
    BACKDROP_SIZE_DISPLAY,
    CACHE_TTL_DETAIL,
    CACHE_TTL_GENRE,
    CACHE_TTL_POOL,
    MAX_CONCURRENT_REQUESTS,
    MAX_RETRIES,
    POPULAR_MOVIE_PAGES,
    POPULAR_TV_PAGES,
    POSTER_PLACEHOLDER,
    POSTER_SIZE_DISPLAY,
    RETRY_BASE_DELAY,
    TMDB_BASE_URL,
    TMDB_IMAGE_BASE_URL,
    TOP_RATED_MOVIE_PAGES,
    TRENDING_MOVIE_PAGES,
    TRENDING_TV_PAGES,
)

logger = logging.getLogger(__name__)


class TMDBError(Exception):
    """Base exception for TMDB API errors."""

class TMDBConfigError(TMDBError):
    """Raised when the API key is invalid (401)."""

class TMDBNotFoundError(TMDBError):
    """Raised when a resource is not found (404)."""

class TMDBRateLimitError(TMDBError):
    """Raised when rate limited (429) — retries handle this internally."""

class TMDBServiceError(TMDBError):
    """Raised when the TMDB server returns 5xx or all retries fail."""


class _CacheEntry:
    __slots__ = ("data", "timestamp", "ttl")

    def __init__(self, data: Any, ttl: float) -> None:
        self.data = data
        self.timestamp = time.monotonic()
        self.ttl = ttl

    @property
    def is_expired(self) -> bool:
        if self.ttl == float("inf"):
            return False
        return (time.monotonic() - self.timestamp) > self.ttl


class TMDBService:
    """Async TMDB API client with caching and rate limiting.

    Usage:
        # In FastAPI lifespan:
        tmdb = TMDBService()
        await tmdb.initialize()

        # In route handlers:
        movies = await tmdb.get_popular_movies()
        detail = await tmdb.get_movie_detail(550)

        # On shutdown:
        await tmdb.close()
    """

    _instance: TMDBService | None = None

    def __new__(cls) -> TMDBService:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return
        self._initialized = True

        self._api_key: str = settings.tmdb_api_key
        self._client: httpx.AsyncClient = httpx.AsyncClient(
            base_url=TMDB_BASE_URL,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(10.0, connect=5.0),
            limits=httpx.Limits(
                max_connections=10,
                max_keepalive_connections=5,
            ),
        )
        self._semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
        self._cache: dict[str, _CacheEntry] = {}
        self._movie_genre_map: dict[int, str] = dict(TMDB_MOVIE_GENRE_MAP)
        self._tv_genre_map: dict[int, str] = dict(TMDB_TV_GENRE_MAP)

    async def initialize(self) -> None:
        """Call during FastAPI lifespan startup. Loads genre maps and prefills candidate pool."""
        if not self._api_key:
            logger.info(
                "No TMDB key — demo mode. Using bundled genre maps and offline catalog."
            )
            return
        logger.info("TMDBService initializing...")
        await self._load_genre_maps()
        logger.info(
            "Genre maps loaded: %d movie genres, %d TV genres",
            len(self._movie_genre_map),
            len(self._tv_genre_map),
        )
        asyncio.create_task(self._prefill_candidate_pool())

    async def close(self) -> None:
        """Call during FastAPI lifespan shutdown."""
        await self._client.aclose()
        logger.info("TMDBService closed.")

    def _cache_get(self, key: str) -> Any | None:
        entry = self._cache.get(key)
        if entry is None:
            return None
        if entry.is_expired:
            del self._cache[key]
            return None
        return entry.data

    def _cache_set(self, key: str, data: Any, ttl: float) -> None:
        self._cache[key] = _CacheEntry(data, ttl)

    def _cache_clear_expired(self) -> None:
        expired_keys = [k for k, v in self._cache.items() if v.is_expired]
        for k in expired_keys:
            del self._cache[k]

    def _build_image_url(self, path: str | None, size: str) -> str:
        if path is None:
            return POSTER_PLACEHOLDER
        return f"{TMDB_IMAGE_BASE_URL}{size}{path}"

    def _build_backdrop_url(self, path: str | None) -> str | None:
        if path is None:
            return None
        return f"{TMDB_IMAGE_BASE_URL}{BACKDROP_SIZE_DISPLAY}{path}"

    def _extract_year(self, date_str: str | None) -> int | None:
        if not date_str or len(date_str) < 4:
            return None
        try:
            return int(date_str[:4])
        except ValueError:
            return None

    def _resolve_genres(self, genre_ids: list[int], media_type: str) -> list[str]:
        genre_map = self._movie_genre_map if media_type == "movie" else self._tv_genre_map
        resolved: list[str] = []
        for gid in genre_ids:
            name = genre_map.get(gid)
            if name:
                resolved.extend(normalize_genre(name))
            else:
                logger.warning("Unknown genre ID %d for %s", gid, media_type)
        return list(dict.fromkeys(resolved))

    async def _request(
        self, method: str, path: str, params: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        if params is None:
            params = {}
        params.setdefault("language", "en-US")

        last_exception: Exception | None = None

        for attempt in range(MAX_RETRIES):
            async with self._semaphore:
                try:
                    response = await self._client.request(method, path, params=params)

                    if response.status_code == 401:
                        logger.error("TMDB API key is invalid (401)")
                        raise TMDBConfigError("Invalid TMDB API key")

                    if response.status_code == 404:
                        raise TMDBNotFoundError(f"TMDB resource not found: {path}")

                    if response.status_code == 429:
                        retry_after = int(response.headers.get("Retry-After", "1"))
                        wait_time = max(retry_after, RETRY_BASE_DELAY * (2 ** attempt))
                        logger.warning(
                            "TMDB rate limited (429). Retry %d/%d after %.1fs",
                            attempt + 1, MAX_RETRIES, wait_time,
                        )
                        await asyncio.sleep(wait_time)
                        last_exception = TMDBRateLimitError("Rate limited")
                        continue

                    if response.status_code >= 500:
                        wait_time = RETRY_BASE_DELAY * (2 ** attempt)
                        logger.warning(
                            "TMDB server error (%d). Retry %d/%d after %.1fs",
                            response.status_code, attempt + 1, MAX_RETRIES, wait_time,
                        )
                        await asyncio.sleep(wait_time)
                        last_exception = TMDBServiceError(
                            f"TMDB server error: {response.status_code}"
                        )
                        continue

                    response.raise_for_status()
                    return response.json()

                except httpx.TimeoutException as e:
                    wait_time = RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning(
                        "TMDB request timeout. Retry %d/%d after %.1fs",
                        attempt + 1, MAX_RETRIES, wait_time,
                    )
                    await asyncio.sleep(wait_time)
                    last_exception = e
                    continue

                except (TMDBConfigError, TMDBNotFoundError):
                    raise

        raise TMDBServiceError(
            f"TMDB request failed after {MAX_RETRIES} retries: {path}"
        ) from last_exception

    async def _load_genre_maps(self) -> None:
        """Load genre ID → name maps from TMDB API. Falls back to hardcoded constants."""
        try:
            movie_data = await self._request("GET", "/genre/movie/list")
            movie_genres = TMDBGenreListResponse.model_validate(movie_data)
            self._movie_genre_map = {g.id: g.name for g in movie_genres.genres}
            self._cache_set("genres:movie", self._movie_genre_map, CACHE_TTL_GENRE)
        except Exception:
            logger.warning("Failed to load movie genres from API, using hardcoded fallback")

        try:
            tv_data = await self._request("GET", "/genre/tv/list")
            tv_genres = TMDBGenreListResponse.model_validate(tv_data)
            self._tv_genre_map = {g.id: g.name for g in tv_genres.genres}
            self._cache_set("genres:tv", self._tv_genre_map, CACHE_TTL_GENRE)
        except Exception:
            logger.warning("Failed to load TV genres from API, using hardcoded fallback")

    def _normalize_movie_list_item(self, item, keywords: list[str] | None = None) -> MediaItem:
        return MediaItem(
            id=f"tmdb_{item.id}",
            source=MediaSource.TMDB_MOVIE,
            tmdb_id=item.id,
            anilist_id=None,
            title=item.title,
            original_title=item.title,
            overview=item.overview,
            poster_path=self._build_image_url(item.poster_path, POSTER_SIZE_DISPLAY),
            backdrop_path=self._build_backdrop_url(item.backdrop_path),
            genres=self._resolve_genres(item.genre_ids, "movie"),
            keywords=[slugify_keyword(k) for k in (keywords or [])],
            vote_average=item.vote_average,
            vote_count=item.vote_count,
            runtime_minutes=None,
            release_year=self._extract_year(item.release_date),
            media_type=MediaType.MOVIE,
            status="Released",
            popularity=item.popularity,
        )

    def _normalize_tv_list_item(self, item, keywords: list[str] | None = None) -> MediaItem:
        return MediaItem(
            id=f"tmdb_{item.id}",
            source=MediaSource.TMDB_TV,
            tmdb_id=item.id,
            anilist_id=None,
            title=item.name,
            original_title=item.name,
            overview=item.overview,
            poster_path=self._build_image_url(item.poster_path, POSTER_SIZE_DISPLAY),
            backdrop_path=self._build_backdrop_url(item.backdrop_path),
            genres=self._resolve_genres(item.genre_ids, "tv"),
            keywords=[slugify_keyword(k) for k in (keywords or [])],
            vote_average=item.vote_average,
            vote_count=item.vote_count,
            runtime_minutes=None,
            release_year=self._extract_year(item.first_air_date),
            media_type=MediaType.TV,
            status="Returning Series",
            popularity=item.popularity,
        )

    def _normalize_search_item(self, item) -> MediaItem | None:
        if item.media_type == "person":
            return None

        if item.media_type == "movie":
            return MediaItem(
                id=f"tmdb_{item.id}",
                source=MediaSource.TMDB_MOVIE,
                tmdb_id=item.id,
                anilist_id=None,
                title=item.title or "",
                original_title=item.title or "",
                overview=item.overview,
                poster_path=self._build_image_url(item.poster_path, POSTER_SIZE_DISPLAY),
                backdrop_path=self._build_backdrop_url(item.backdrop_path),
                genres=self._resolve_genres(item.genre_ids, "movie"),
                keywords=[],
                vote_average=item.vote_average,
                vote_count=item.vote_count,
                runtime_minutes=None,
                release_year=self._extract_year(item.release_date),
                media_type=MediaType.MOVIE,
                status="Released",
                popularity=item.popularity,
            )

        if item.media_type == "tv":
            return MediaItem(
                id=f"tmdb_{item.id}",
                source=MediaSource.TMDB_TV,
                tmdb_id=item.id,
                anilist_id=None,
                title=item.name or "",
                original_title=item.name or "",
                overview=item.overview,
                poster_path=self._build_image_url(item.poster_path, POSTER_SIZE_DISPLAY),
                backdrop_path=self._build_backdrop_url(item.backdrop_path),
                genres=self._resolve_genres(item.genre_ids, "tv"),
                keywords=[],
                vote_average=item.vote_average,
                vote_count=item.vote_count,
                runtime_minutes=None,
                release_year=self._extract_year(item.first_air_date),
                media_type=MediaType.TV,
                status="Returning Series",
                popularity=item.popularity,
            )

        return None

    # ── Candidate Pool Methods ──────────────────────────────────────────────

    async def get_popular_movies(self, pages: int = POPULAR_MOVIE_PAGES) -> list[MediaItem]:
        cache_key = "pool:movie:popular"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        items: list[MediaItem] = []
        for page in range(1, pages + 1):
            data = await self._request("GET", "/movie/popular", {"page": page})
            response = TMDBMovieListResponse.model_validate(data)
            for movie in response.results:
                items.append(self._normalize_movie_list_item(movie))

        self._cache_set(cache_key, items, CACHE_TTL_POOL)
        logger.info("Fetched %d popular movies (%d pages)", len(items), pages)
        return items

    async def get_top_rated_movies(self, pages: int = TOP_RATED_MOVIE_PAGES) -> list[MediaItem]:
        cache_key = "pool:movie:top_rated"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        items: list[MediaItem] = []
        for page in range(1, pages + 1):
            data = await self._request("GET", "/movie/top_rated", {"page": page})
            response = TMDBMovieListResponse.model_validate(data)
            for movie in response.results:
                items.append(self._normalize_movie_list_item(movie))

        self._cache_set(cache_key, items, CACHE_TTL_POOL)
        logger.info("Fetched %d top-rated movies (%d pages)", len(items), pages)
        return items

    async def get_popular_tv(self, pages: int = POPULAR_TV_PAGES) -> list[MediaItem]:
        cache_key = "pool:tv:popular"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        items: list[MediaItem] = []
        for page in range(1, pages + 1):
            data = await self._request("GET", "/tv/popular", {"page": page})
            response = TMDBTVListResponse.model_validate(data)
            for show in response.results:
                items.append(self._normalize_tv_list_item(show))

        self._cache_set(cache_key, items, CACHE_TTL_POOL)
        logger.info("Fetched %d popular TV shows (%d pages)", len(items), pages)
        return items

    async def get_trending_movies(self) -> list[MediaItem]:
        cache_key = "trending:movie:week"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        data = await self._request("GET", "/trending/movie/week")
        response = TMDBMovieListResponse.model_validate(data)
        items = [self._normalize_movie_list_item(m) for m in response.results]

        self._cache_set(cache_key, items, CACHE_TTL_POOL)
        logger.info("Fetched %d trending movies", len(items))
        return items

    async def get_trending_tv(self) -> list[MediaItem]:
        cache_key = "trending:tv:week"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        data = await self._request("GET", "/trending/tv/week")
        response = TMDBTVListResponse.model_validate(data)
        items = [self._normalize_tv_list_item(s) for s in response.results]

        self._cache_set(cache_key, items, CACHE_TTL_POOL)
        logger.info("Fetched %d trending TV shows", len(items))
        return items

    # ── Detail Methods ──────────────────────────────────────────────────────

    async def get_movie_detail(self, movie_id: int) -> MediaItem | None:
        cache_key = f"detail:movie:{movie_id}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        try:
            data = await self._request(
                "GET", f"/movie/{movie_id}", {"append_to_response": "keywords,credits"}
            )
        except TMDBNotFoundError:
            logger.info("Movie %d not found", movie_id)
            return None

        detail = TMDBMovieDetail.model_validate(data)
        keywords = [k.name for k in detail.keywords.keywords]

        # Extract cast (top 5 by order)
        cast = [c.name for c in sorted(detail.credits.cast, key=lambda c: c.order)[:5]]

        # Extract director
        directors = [c.name for c in detail.credits.crew if c.job.lower() == "director"]
        director = directors[0] if directors else None

        # Extract studio
        studios = [
            pc.name
            for pc in detail.production_companies
            if pc.origin_country == "US"
        ]
        if not studios and detail.production_companies:
            studios = [detail.production_companies[0].name]
        studio = studios[0] if studios else None

        item = MediaItem(
            id=f"tmdb_{detail.id}",
            source=MediaSource.TMDB_MOVIE,
            tmdb_id=detail.id,
            anilist_id=None,
            title=detail.title,
            original_title=detail.title,
            overview=detail.overview,
            poster_path=self._build_image_url(detail.poster_path, POSTER_SIZE_DISPLAY),
            backdrop_path=self._build_backdrop_url(detail.backdrop_path),
            genres=list(dict.fromkeys(
                ng for g in detail.genres for ng in normalize_genre(g.name)
            )),
            keywords=[slugify_keyword(kw) for kw in keywords],
            vote_average=detail.vote_average,
            vote_count=detail.vote_count,
            runtime_minutes=detail.runtime if detail.runtime and detail.runtime > 0 else None,
            release_year=self._extract_year(detail.release_date),
            media_type=MediaType.MOVIE,
            status=detail.status,
            popularity=detail.popularity,
            cast=cast,
            director=director,
            studio=studio,
            release_date=detail.release_date or None,
            year=self._extract_year(detail.release_date),
            source_api="tmdb",
        )

        if not item.keywords:
            logger.warning("Movie %d (%s) has no keywords", movie_id, item.title)

        self._cache_set(cache_key, item, CACHE_TTL_DETAIL)
        return item

    async def get_tv_detail(self, tv_id: int) -> MediaItem | None:
        cache_key = f"detail:tv:{tv_id}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        try:
            data = await self._request(
                "GET", f"/tv/{tv_id}", {"append_to_response": "keywords,credits"}
            )
        except TMDBNotFoundError:
            logger.info("TV show %d not found", tv_id)
            return None

        detail = TMDBTVDetail.model_validate(data)
        keywords = [k.name for k in detail.keywords.results]
        runtime = detail.episode_run_time[0] if detail.episode_run_time else None

        cast = [c.name for c in sorted(detail.credits.cast, key=lambda c: c.order)[:5]]

        creators = [c.name for c in detail.credits.crew if c.job.lower() == "creator"]
        director = creators[0] if creators else None

        networks = [n.name for n in detail.networks] if detail.networks else []
        studios = [
            pc.name
            for pc in detail.production_companies
            if pc.origin_country == "US"
        ]
        studio = studios[0] if studios else (networks[0] if networks else None)

        item = MediaItem(
            id=f"tmdb_{detail.id}",
            source=MediaSource.TMDB_TV,
            tmdb_id=detail.id,
            anilist_id=None,
            title=detail.name,
            original_title=detail.name,
            overview=detail.overview,
            poster_path=self._build_image_url(detail.poster_path, POSTER_SIZE_DISPLAY),
            backdrop_path=self._build_backdrop_url(detail.backdrop_path),
            genres=list(dict.fromkeys(
                ng for g in detail.genres for ng in normalize_genre(g.name)
            )),
            keywords=[slugify_keyword(kw) for kw in keywords],
            vote_average=detail.vote_average,
            vote_count=detail.vote_count,
            runtime_minutes=runtime,
            release_year=self._extract_year(detail.first_air_date),
            media_type=MediaType.TV,
            status=detail.status,
            popularity=detail.popularity,
            cast=cast,
            director=director,
            studio=studio,
            release_date=detail.first_air_date or None,
            year=self._extract_year(detail.first_air_date),
            episode_count=detail.number_of_episodes,
            source_api="tmdb",
        )

        if not item.keywords:
            logger.warning("TV show %d (%s) has no keywords", tv_id, item.title)

        self._cache_set(cache_key, item, CACHE_TTL_DETAIL)
        return item

    # ── Keywords Methods ────────────────────────────────────────────────────

    async def get_movie_keywords(self, movie_id: int) -> list[str]:
        try:
            data = await self._request("GET", f"/movie/{movie_id}/keywords")
            response = TMDBMovieKeywordsResponse.model_validate(data)
            return [k.name for k in response.keywords]
        except Exception:
            logger.warning("Failed to fetch keywords for movie %d", movie_id)
            return []

    async def get_tv_keywords(self, tv_id: int) -> list[str]:
        try:
            data = await self._request("GET", f"/tv/{tv_id}/keywords")
            response = TMDBTVKeywordsResponse.model_validate(data)
            return [k.name for k in response.results]
        except Exception:
            logger.warning("Failed to fetch keywords for TV show %d", tv_id)
            return []

    # ── Search Methods ──────────────────────────────────────────────────────

    async def search_multi(self, query: str, page: int = 1) -> list[MediaItem]:
        if not query or not query.strip():
            return []

        cache_key = f"search:{query.strip().lower()}:{page}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        data = await self._request(
            "GET", "/search/multi",
            {"query": query.strip(), "page": page, "include_adult": "false"},
        )
        response = TMDBSearchMultiResponse.model_validate(data)

        items: list[MediaItem] = []
        for result in response.results:
            normalized = self._normalize_search_item(result)
            if normalized is not None:
                items.append(normalized)

        self._cache_set(cache_key, items, 3600)
        return items

    # ── Pool Enrichment ─────────────────────────────────────────────────────

    async def enrich_pool_with_keywords(self, pool: list[MediaItem]) -> list[MediaItem]:
        async def _enrich_one(item: MediaItem) -> MediaItem:
            if item.keywords:
                return item

            if item.media_type == MediaType.MOVIE:
                keywords = await self.get_movie_keywords(item.tmdb_id or 0)
            elif item.media_type == MediaType.TV:
                keywords = await self.get_tv_keywords(item.tmdb_id or 0)
            else:
                keywords = []

            return item.model_copy(
                update={"keywords": [slugify_keyword(k) for k in keywords]}
            )

        tasks = [_enrich_one(item) for item in pool]
        enriched = await asyncio.gather(*tasks, return_exceptions=True)

        result: list[MediaItem] = []
        for i, item_or_error in enumerate(enriched):
            if isinstance(item_or_error, Exception):
                logger.warning(
                    "Failed to enrich item %s: %s", pool[i].id, item_or_error
                )
                result.append(pool[i])
            else:
                result.append(item_or_error)

        return result

    # ── Background Tasks ────────────────────────────────────────────────────

    async def _prefill_candidate_pool(self) -> None:
        try:
            logger.info("Prefilling candidate pool...")

            popular_movies, top_rated_movies, popular_tv, trending_movies, trending_tv = (
                await asyncio.gather(
                    self.get_popular_movies(),
                    self.get_top_rated_movies(),
                    self.get_popular_tv(),
                    self.get_trending_movies(),
                    self.get_trending_tv(),
                )
            )

            total = (
                len(popular_movies)
                + len(top_rated_movies)
                + len(popular_tv)
                + len(trending_movies)
                + len(trending_tv)
            )
            logger.info("Candidate pool prefilled: %d total items", total)

            all_items = popular_movies + top_rated_movies + popular_tv

            seen: set[str] = set()
            unique_items: list[MediaItem] = []
            for item in all_items:
                key = item.id
                if key not in seen:
                    seen.add(key)
                    unique_items.append(item)

            enriched = await self.enrich_pool_with_keywords(unique_items)

            self._cache_set("pool:enriched:all", enriched, CACHE_TTL_POOL)

            logger.info(
                "Candidate pool enrichment complete: %d unique items with keywords",
                len(enriched),
            )

        except Exception:
            logger.exception("Failed to prefill candidate pool")

    async def get_full_candidate_pool(self) -> list[MediaItem]:
        cached = self._cache_get("pool:enriched:all")
        if cached is not None:
            return cached

        await self._prefill_candidate_pool()
        cached = self._cache_get("pool:enriched:all")
        return cached or []

    async def schedule_pool_refresh(self) -> None:
        while True:
            await asyncio.sleep(CACHE_TTL_POOL)
            logger.info("Scheduled candidate pool refresh starting...")
            pool_keys = [k for k in self._cache if k.startswith("pool:")]
            for k in pool_keys:
                del self._cache[k]
            await self._prefill_candidate_pool()
            self._cache_clear_expired()
