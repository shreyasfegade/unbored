"""Build the self-owned catalog dataset.

Run this ONCE locally with a TMDB key in backend/.env. It pulls a broad, quality
set of movies, TV, and anime from TMDB + AniList, enriches each with keywords,
cast, director, and runtime, and writes app/data/catalog.json (committed). At
runtime the app serves entirely from that file — no live TMDB/AniList calls,
so it's fast and reliable.

    cd backend && python scripts/build_catalog.py

Poster paths point at the public image.tmdb.org CDN and render without a key.
Data: TMDB (movies/TV) + AniList (anime). Attribution is stored in the file.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import time
import types
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.models.media import MediaItem, MediaSource, MediaType  # noqa: E402
from app.services.anilist_service import AniListService  # noqa: E402
from app.services.tmdb_service import TMDBService  # noqa: E402

# Limit concurrent curl subprocesses.
_CURL_SEM = asyncio.Semaphore(10)
_DOH = ["--doh-url", "https://1.1.1.1/dns-query"]


async def _curl_json(cmd: list[str], *, body: bytes | None = None, retries: int = 4) -> dict:
    """Run curl (resolving via DoH) with retries; return parsed JSON.

    The local ISP DNS-poisons TMDB/AniList and blips intermittently; curl's
    own DoH resolver sidesteps it, and retries absorb transient failures."""
    last = ""
    async with _CURL_SEM:
        for attempt in range(retries):
            proc = await asyncio.to_thread(
                lambda: subprocess.run(cmd, input=body, capture_output=True)
            )
            out = proc.stdout.decode("utf-8", "replace") if proc.stdout else ""
            if out:
                try:
                    return json.loads(out)
                except json.JSONDecodeError:
                    last = out[:200]
            await asyncio.sleep(0.4 * (attempt + 1))
    raise RuntimeError(f"curl failed after {retries} tries: {last}")


def _patch_tmdb_with_curl(tmdb: TMDBService) -> None:
    """Route TMDB calls through curl+DoH (build-time only; never ships)."""

    async def curl_request(self, method: str, path: str, params: dict | None = None) -> dict:
        merged = dict(params or {})
        merged.setdefault("language", "en-US")
        url = f"https://api.themoviedb.org/3{path}?{urllib.parse.urlencode(merged)}"
        cmd = [
            "curl", "-s", "-m", "30", *_DOH,
            "-H", f"Authorization: Bearer {self._api_key}",
            "-H", "Content-Type: application/json", url,
        ]
        return await _curl_json(cmd)

    tmdb._request = types.MethodType(curl_request, tmdb)  # type: ignore[method-assign]


def _patch_anilist_with_curl(anilist: AniListService) -> None:
    """Route AniList GraphQL POSTs through curl+DoH (build-time only)."""

    async def curl_request(self, query: str, variables: dict) -> dict:
        body = json.dumps({"query": query, "variables": variables}).encode("utf-8")
        cmd = [
            "curl", "-s", "-m", "30", *_DOH, "-X", "POST",
            "-H", "Content-Type: application/json",
            "--data-binary", "@-", "https://graphql.anilist.co",
        ]
        data = await _curl_json(cmd, body=body)
        if "errors" in data:
            raise ValueError(f"AniList errors: {data['errors']}")
        return data

    anilist._request = types.MethodType(curl_request, anilist)  # type: ignore[method-assign]

OUT_PATH = Path(__file__).resolve().parent.parent / "app" / "data" / "catalog.json"

# How much to pull. TMDB pages are 20 items each.
POPULAR_MOVIE_PAGES = 12
TOP_RATED_MOVIE_PAGES = 12
POPULAR_TV_PAGES = 10
ANILIST_PAGES = 6  # 50 per page, trending + top-rated

# Quality floors so the catalog stays strong.
MIN_VOTE_MOVIE_TV = 6.3
MIN_VOTE_ANIME = 6.8
MIN_VOTES = 80

DETAIL_CHUNK = 16  # concurrent detail fetches per batch


async def _collect_tmdb_ids(tmdb: TMDBService) -> tuple[set[int], set[int]]:
    """Gather unique movie and TV ids from popular/top-rated/trending lists."""
    movie_ids: set[int] = set()
    tv_ids: set[int] = set()

    lists = await asyncio.gather(
        tmdb.get_popular_movies(pages=POPULAR_MOVIE_PAGES),
        tmdb.get_top_rated_movies(pages=TOP_RATED_MOVIE_PAGES),
        tmdb.get_trending_movies(),
        tmdb.get_popular_tv(pages=POPULAR_TV_PAGES),
        tmdb.get_trending_tv(),
        return_exceptions=True,
    )
    for res in lists:
        if isinstance(res, Exception):
            print(f"  ! list fetch failed: {res}")
            continue
        for item in res:
            if item.tmdb_id is None:
                continue
            if item.source == MediaSource.TMDB_MOVIE:
                movie_ids.add(item.tmdb_id)
            elif item.source == MediaSource.TMDB_TV:
                tv_ids.add(item.tmdb_id)
    return movie_ids, tv_ids


async def _fetch_details(tmdb: TMDBService, ids: list[int], kind: str) -> list[MediaItem]:
    """Fetch full detail records (runtime, keywords, cast, director) in batches."""
    out: list[MediaItem] = []
    fetch = tmdb.get_movie_detail if kind == "movie" else tmdb.get_tv_detail
    for i in range(0, len(ids), DETAIL_CHUNK):
        chunk = ids[i : i + DETAIL_CHUNK]
        results = await asyncio.gather(*(fetch(mid) for mid in chunk), return_exceptions=True)
        for r in results:
            if isinstance(r, MediaItem):
                out.append(r)
        print(f"  {kind}: {min(i + DETAIL_CHUNK, len(ids))}/{len(ids)} fetched", end="\r")
    print()
    return out


async def _collect_anime(anilist: AniListService) -> list[MediaItem]:
    items: dict[str, MediaItem] = {}
    tasks = []
    for page in range(1, ANILIST_PAGES + 1):
        tasks.append(anilist.get_trending(page=page, per_page=50))
        tasks.append(anilist.get_top_rated(page=page, per_page=50))
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for res in results:
        if isinstance(res, Exception):
            print(f"  ! anilist page failed: {res}")
            continue
        for item in res:
            items[item.id] = item
    return list(items.values())


def _quality_ok(item: MediaItem) -> bool:
    is_anime = item.media_type == MediaType.ANIME or item.source == MediaSource.ANILIST
    floor = MIN_VOTE_ANIME if is_anime else MIN_VOTE_MOVIE_TV
    if item.vote_average < floor:
        return False
    if not is_anime and item.vote_count < MIN_VOTES:
        return False
    if not (item.overview or "").strip() and not item.keywords:
        return False
    return True


async def main() -> int:
    started = time.time()
    tmdb = TMDBService()
    anilist = AniListService()

    if not tmdb._api_key:
        print("ERROR: no TMDB key in backend/.env — cannot build catalog.")
        return 1

    print("Routing TMDB + AniList through curl+DoH (ISP DNS bypass)...")
    _patch_tmdb_with_curl(tmdb)
    _patch_anilist_with_curl(anilist)

    print("Loading TMDB genre maps...")
    await tmdb._load_genre_maps()

    print("Collecting TMDB ids...")
    movie_ids, tv_ids = await _collect_tmdb_ids(tmdb)
    print(f"  unique movies={len(movie_ids)} tv={len(tv_ids)}")

    print("Fetching movie details...")
    movies = await _fetch_details(tmdb, sorted(movie_ids), "movie")
    print("Fetching TV details...")
    shows = await _fetch_details(tmdb, sorted(tv_ids), "tv")
    print("Fetching anime...")
    anime = await _collect_anime(anilist)
    print(f"  anime={len(anime)}")

    all_items = movies + shows + anime
    seen: set[str] = set()
    catalog: list[MediaItem] = []
    for item in all_items:
        if item.id in seen or not _quality_ok(item):
            continue
        seen.add(item.id)
        catalog.append(item)

    catalog.sort(key=lambda m: (m.popularity or 0.0), reverse=True)

    payload = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "attribution": "Movie & TV data from TMDB (themoviedb.org); anime from AniList (anilist.co).",
        "count": len(catalog),
        "items": [m.model_dump(mode="json") for m in catalog],
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    by_type: dict[str, int] = {}
    for m in catalog:
        by_type[m.media_type.value] = by_type.get(m.media_type.value, 0) + 1
    size_mb = OUT_PATH.stat().st_size / 1_048_576

    await tmdb.close()
    await anilist.close()

    print(
        f"\nWrote {len(catalog)} items ({by_type}) to {OUT_PATH.name} "
        f"[{size_mb:.1f} MB] in {time.time() - started:.0f}s"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
