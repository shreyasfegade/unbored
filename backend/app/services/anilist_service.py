"""AniList GraphQL API service — async, cached, rate-limited.

This module handles ALL communication with the AniList API.
No other module should make direct HTTP calls to AniList.
"""

from __future__ import annotations
import asyncio
import logging
import re
import time
from typing import Any
import httpx

from app.models.media import MediaItem, MediaType, MediaSource
from app.models.genres import normalize_genre, slugify_keyword

logger = logging.getLogger(__name__)

ANILIST_BASE_URL = "https://graphql.anilist.co"
MAX_CONCURRENT_REQUESTS = 4
MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0
POOL_CACHE_TTL = 6 * 3600
DETAIL_CACHE_TTL = 24 * 3600
SEARCH_CACHE_TTL = 3600

ANILIST_GENRE_MAP: dict[str, list[str]] = {
    "Action": ["Action"],
    "Adventure": ["Adventure"],
    "Comedy": ["Comedy"],
    "Drama": ["Drama"],
    "Fantasy": ["Fantasy"],
    "Horror": ["Horror"],
    "Mystery": ["Mystery"],
    "Romance": ["Romance"],
    "Sci-Fi": ["Science Fiction"],
    "Thriller": ["Thriller"],
    "Slice of Life": ["Drama"],
    "Sports": ["Adventure"],
    "Supernatural": ["Fantasy"],
    "Mecha": ["Science Fiction"],
    "Music": ["Music"],
    "Psychological": ["Thriller"],
    "Mahou Shoujo": ["Fantasy"],
}

ANILIST_GENRE_EXTRA_KEYWORDS: dict[str, str] = {
    "Slice of Life": "slice of life",
    "Sports": "sports",
    "Supernatural": "supernatural",
    "Mecha": "mecha",
    "Psychological": "psychological",
    "Mahou Shoujo": "magical girl",
}

ANILIST_STATUS_MAP: dict[str, str] = {
    "FINISHED": "released",
    "RELEASING": "airing",
    "NOT_YET_RELEASED": "upcoming",
    "CANCELLED": "cancelled",
    "HIATUS": "airing",
}

TRENDING_QUERY = """
query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
        media(sort: TRENDING_DESC, type: ANIME, isAdult: false) {
            id
            title { english romaji }
            coverImage { extraLarge large medium }
            bannerImage
            genres
            tags { name rank isMediaSpoiler isGeneralSpoiler }
            averageScore
            popularity
            description
            episodes
            duration
            seasonYear
            status
        }
    }
}
"""

TOP_RATED_QUERY = """
query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
        media(sort: SCORE_DESC, type: ANIME, isAdult: false) {
            id
            title { english romaji }
            coverImage { extraLarge large medium }
            bannerImage
            genres
            tags { name rank isMediaSpoiler isGeneralSpoiler }
            averageScore
            popularity
            description
            episodes
            duration
            seasonYear
            status
        }
    }
}
"""

SEARCH_QUERY = """
query ($page: Int, $perPage: Int, $search: String) {
    Page(page: $page, perPage: $perPage) {
        media(search: $search, type: ANIME, isAdult: false) {
            id
            title { english romaji }
            coverImage { extraLarge large medium }
            bannerImage
            genres
            tags { name rank isMediaSpoiler isGeneralSpoiler }
            averageScore
            popularity
            description
            episodes
            duration
            seasonYear
            status
        }
    }
}
"""

DETAIL_QUERY = """
query ($id: Int) {
    Media(id: $id, type: ANIME) {
        id
        title { english romaji }
        coverImage { extraLarge large medium }
        bannerImage
        genres
        tags { name rank isMediaSpoiler isGeneralSpoiler }
        averageScore
        popularity
        description
        episodes
        duration
        seasonYear
        season
        status
        startDate { year month day }
        studios(isMain: true) {
            nodes { name }
        }
        characters(sort: ROLE, perPage: 5) {
            nodes {
                name { full }
            }
        }
    }
}
"""


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


class AniListService:
    _instance: AniListService | None = None

    def __new__(cls) -> AniListService:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return
        self._initialized = True

        self._client: httpx.AsyncClient = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=5.0),
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
        self._semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
        self._cache: dict[str, _CacheEntry] = {}

    async def close(self) -> None:
        await self._client.aclose()

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

    async def _request(self, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        last_exception: Exception | None = None

        for attempt in range(MAX_RETRIES):
            async with self._semaphore:
                try:
                    response = await self._client.post(
                        ANILIST_BASE_URL,
                        json={"query": query, "variables": variables},
                    )

                    if response.status_code == 429:
                        retry_after = int(response.headers.get("Retry-After", "60"))
                        wait_time = max(retry_after, RETRY_BASE_DELAY * (2 ** attempt))
                        logger.warning(
                            "AniList rate limited (429). Retry %d/%d after %.1fs",
                            attempt + 1, MAX_RETRIES, wait_time,
                        )
                        await asyncio.sleep(wait_time)
                        last_exception = Exception("Rate limited")
                        continue

                    if response.status_code >= 500:
                        wait_time = RETRY_BASE_DELAY * (2 ** attempt)
                        logger.warning(
                            "AniList server error (%d). Retry %d/%d after %.1fs",
                            response.status_code, attempt + 1, MAX_RETRIES, wait_time,
                        )
                        await asyncio.sleep(wait_time)
                        last_exception = Exception(f"Server error: {response.status_code}")
                        continue

                    response.raise_for_status()
                    data = response.json()

                    if "errors" in data:
                        error_msgs = [
                            e.get("message", str(e)) for e in data["errors"]
                        ]
                        logger.error("AniList GraphQL errors: %s", error_msgs)
                        raise ValueError(f"AniList GraphQL errors: {error_msgs}")

                    return data

                except httpx.TimeoutException as e:
                    wait_time = RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning(
                        "AniList request timeout. Retry %d/%d after %.1fs",
                        attempt + 1, MAX_RETRIES, wait_time,
                    )
                    await asyncio.sleep(wait_time)
                    last_exception = e
                    continue

                except ValueError:
                    raise

        raise RuntimeError(
            f"AniList request failed after {MAX_RETRIES} retries"
        ) from last_exception

    def _extract_media_list(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        page = data.get("data", {}).get("Page", {})
        return page.get("media", [])

    def _extract_single_media(self, data: dict[str, Any]) -> dict[str, Any] | None:
        return data.get("data", {}).get("Media")

    def _resolve_poster(self, cover_image: dict[str, str | None]) -> str | None:
        return (
            cover_image.get("extraLarge")
            or cover_image.get("large")
            or cover_image.get("medium")
        )

    def _resolve_title(self, title: dict[str, str | None]) -> str:
        english = title.get("english")
        if english:
            return english
        return title.get("romaji", "")

    def _resolve_genres(self, genres: list[str]) -> list[str]:
        resolved: list[str] = []
        for raw_genre in genres:
            mapped = ANILIST_GENRE_MAP.get(raw_genre, [raw_genre])
            for name in mapped:
                resolved.extend(normalize_genre(name))
        return list(dict.fromkeys(resolved))

    def _build_keywords(self, genres: list[str], tags: list[dict[str, Any]]) -> list[str]:
        keywords: list[str] = []

        for raw_genre in genres:
            extra = ANILIST_GENRE_EXTRA_KEYWORDS.get(raw_genre)
            if extra:
                keywords.append(slugify_keyword(extra))

        filtered_tags: list[dict[str, Any]] = []
        for tag in tags:
            if tag.get("isMediaSpoiler") or tag.get("isGeneralSpoiler"):
                continue
            rank = tag.get("rank", 100)
            if rank <= 60:
                continue
            filtered_tags.append(tag)

        filtered_tags.sort(key=lambda t: t.get("rank", 100), reverse=True)
        top_tags = filtered_tags[:15]

        for tag in top_tags:
            name = tag.get("name", "")
            if name:
                keywords.append(slugify_keyword(name))

        return list(dict.fromkeys(keywords))

    def _normalize_media_item(self, media: dict[str, Any]) -> MediaItem:
        anilist_id = media["id"]
        title_obj = media.get("title", {})
        title = self._resolve_title(title_obj)
        original_title = title_obj.get("romaji", title)
        description = media.get("description") or ""
        description = re.sub(r"<br\s*/?>", " ", description, flags=re.IGNORECASE)
        description = re.sub(r"<[^>]+>", "", description)
        description = re.sub(r"\s+", " ", description).strip()

        cover_image = media.get("coverImage", {})
        poster_path = self._resolve_poster(cover_image)
        backdrop_path = media.get("bannerImage") or None

        genres_raw = media.get("genres") or []
        genres = self._resolve_genres(genres_raw)

        tags_raw = media.get("tags") or []
        keywords = self._build_keywords(genres_raw, tags_raw)

        avg_score = media.get("averageScore")
        vote_average = avg_score / 10.0 if avg_score else 0.0

        vote_count = media.get("popularity", 0)

        duration = media.get("duration") or 24
        runtime = max(1, duration)

        season_year = media.get("seasonYear")
        release_year = season_year if season_year else None

        raw_status = media.get("status") or ""
        status = ANILIST_STATUS_MAP.get(raw_status, raw_status.lower())

        # Extended fields
        cast_raw = media.get("characters", {}).get("nodes") or []
        cast = [c.get("name", {}).get("full", "") for c in cast_raw if c.get("name", {}).get("full")]
        cast = cast[:5]

        studios_raw = media.get("studios", {}).get("nodes") or []
        studio = studios_raw[0].get("name") if studios_raw else None

        start_date = media.get("startDate") or {}
        day = start_date.get("day")
        month = start_date.get("month")
        year_val = start_date.get("year")
        if year_val and month and day:
            release_date = f"{year_val:04d}-{month:02d}-{day:02d}"
        elif year_val and month:
            release_date = f"{year_val:04d}-{month:02d}"
        elif year_val:
            release_date = str(year_val)
        else:
            release_date = None

        episodes = media.get("episodes")

        return MediaItem(
            id=f"al_{anilist_id}",
            source=MediaSource.ANILIST,
            tmdb_id=None,
            anilist_id=anilist_id,
            title=title,
            original_title=original_title,
            overview=description,
            poster_path=poster_path,
            backdrop_path=backdrop_path,
            genres=genres,
            keywords=keywords,
            vote_average=vote_average,
            vote_count=vote_count,
            runtime_minutes=runtime,
            release_year=release_year,
            media_type=MediaType.ANIME,
            status=status,
            popularity=float(vote_count),
            cast=cast,
            director=None,
            studio=studio,
            release_date=release_date,
            year=year_val,
            episode_count=episodes,
            source_api="anilist",
        )

    def _paginated_normalize(self, data: dict[str, Any]) -> list[MediaItem]:
        media_list = self._extract_media_list(data)
        return [self._normalize_media_item(m) for m in media_list]

    async def get_trending(self, page: int = 1, per_page: int = 50) -> list[MediaItem]:
        cache_key = f"trending:{page}:{per_page}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        data = await self._request(TRENDING_QUERY, {"page": page, "perPage": per_page})
        items = self._paginated_normalize(data)
        self._cache_set(cache_key, items, POOL_CACHE_TTL)
        return items

    async def get_top_rated(self, page: int = 1, per_page: int = 50) -> list[MediaItem]:
        cache_key = f"top_rated:{page}:{per_page}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        data = await self._request(TOP_RATED_QUERY, {"page": page, "perPage": per_page})
        items = self._paginated_normalize(data)
        self._cache_set(cache_key, items, POOL_CACHE_TTL)
        return items

    async def search(self, query: str, page: int = 1, per_page: int = 20) -> list[MediaItem]:
        if not query or not query.strip():
            return []

        cache_key = f"search:{query.strip().lower()}:{page}:{per_page}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        data = await self._request(
            SEARCH_QUERY, {"search": query.strip(), "page": page, "perPage": per_page}
        )
        items = self._paginated_normalize(data)
        self._cache_set(cache_key, items, SEARCH_CACHE_TTL)
        return items

    async def get_detail(self, anilist_id: int) -> MediaItem | None:
        cache_key = f"detail:{anilist_id}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        data = await self._request(DETAIL_QUERY, {"id": anilist_id})
        media = self._extract_single_media(data)
        if media is None:
            return None

        item = self._normalize_media_item(media)
        self._cache_set(cache_key, item, DETAIL_CACHE_TTL)
        return item
