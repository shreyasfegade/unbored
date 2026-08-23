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
import re
import subprocess
import os
import sys
import time
import types
import unicodedata
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

# How much to pull. TMDB pages are 20 items each. Weighted toward movies/TV so
# a typical viewer's "surprise me" isn't dominated by anime.
POPULAR_MOVIE_PAGES = 70
TOP_RATED_MOVIE_PAGES = 50
POPULAR_TV_PAGES = 55
ANILIST_PAGES = 4  # 50 per page, trending + top-rated

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


# ── Franchise grouping ────────────────────────────────────────────────
# Season markers that mean "same show, later run" rather than a new title.
_SEASON_RE = re.compile(
    r"\b("
    r"final\s+season|the\s+final\s+season|season\s+[0-9ivx]+|s[0-9]{1,2}\b"
    r"|part\s+[0-9ivx]+|cour\s+[0-9]+|[0-9]+(st|nd|rd|th)\s+season"
    r"|(second|third|fourth|fifth|sixth|final)\s+season"
    r"|specials?|ova|ona|movie\s+[0-9]+"
    r")\b.*$",
    re.IGNORECASE,
)
_TRAILING_NUM_RE = re.compile(r"[\s:\-]*\b([0-9]{1,2}|[ivx]{1,4})\b\s*$", re.IGNORECASE)


def franchise_key(item: MediaItem) -> str:
    """A stable name for the series a title belongs to.

    Used two ways: to drop duplicate seasons of the same show at build time, and
    to stop one franchise filling a browse row. Deliberately conservative — over
    -merging would hide genuinely different films.
    """
    title = unicodedata.normalize("NFKD", item.title or "").lower()
    title = "".join(c for c in title if not unicodedata.combining(c))
    title = re.sub(r"[\(\[].*?[\)\]]", " ", title)  # drop (2011), [TV] etc.
    title = _SEASON_RE.sub(" ", title)

    # Split off a subtitle so "Spider-Man: No Way Home" groups with the other
    # Spider-Man films — but only when the head is substantial, so "Re:ZERO"
    # isn't reduced to "re".
    for sep in (":", " - ", " – "):
        head, found, _ = title.partition(sep)
        # 5 is enough to keep "Re:ZERO" intact while still folding "Bleach: ...".
        if found and (len(head.strip()) >= 5 or len(head.split()) >= 2):
            title = head
            break

    title = _TRAILING_NUM_RE.sub("", title)
    title = re.sub(r"[^a-z0-9]+", " ", title).strip()
    return title or (item.title or "").lower().strip()


def _collapse_seasons(items: list[MediaItem]) -> list[MediaItem]:
    """Keep one entry per TV/anime franchise — the best-known season.

    Movies are left alone: numbered sequels and subtitled entries are genuinely
    different films, and collapsing them would shrink the catalog for no gain.
    Browse still de-duplicates films by franchise per row.
    """
    best: dict[tuple[str, str], MediaItem] = {}
    passthrough: list[MediaItem] = []
    for item in items:
        if item.media_type == MediaType.MOVIE:
            passthrough.append(item)
            continue
        key = (item.media_type.value, item.franchise or item.title.lower())
        current = best.get(key)
        rank = (item.vote_count, item.vote_average)
        if current is None or rank > (current.vote_count, current.vote_average):
            best[key] = item
    return passthrough + list(best.values())


def _apply_popularity_norm(items: list[MediaItem]) -> None:
    """Rank popularity 0–1 *within each source*.

    TMDB popularity tops out around 500 while AniList's runs past 1,000,000, so
    ranking the raw numbers together puts anime above everything, everywhere.
    A within-source percentile makes them comparable.
    """
    by_source: dict[str, list[MediaItem]] = {}
    for item in items:
        by_source.setdefault(item.source.value, []).append(item)
    for group in by_source.values():
        group.sort(key=lambda m: m.popularity or 0.0)
        last = len(group) - 1 or 1
        for rank, item in enumerate(group):
            item.popularity_norm = round(rank / last, 6)


def _previous_anime() -> list[MediaItem]:
    """Anime from the catalog currently on disk, for use when AniList is down."""
    if not OUT_PATH.exists():
        return []
    try:
        raw = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    out: list[MediaItem] = []
    for entry in raw.get("items", []):
        if entry.get("media_type") != MediaType.ANIME.value:
            continue
        try:
            out.append(MediaItem.model_validate(entry))
        except Exception:  # pragma: no cover - defensive
            continue
    return out


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

    # The curl + DNS-over-HTTPS routing is a workaround for one specific ISP that
    # DNS-poisons TMDB/AniList. It's opt-in (UNBORED_BUILD_DOH=1 or --local-doh)
    # so CI and normal networks use plain httpx and this script is portable.
    use_doh = os.environ.get("UNBORED_BUILD_DOH") == "1" or "--local-doh" in sys.argv
    if use_doh:
        print("Routing TMDB + AniList through curl+DoH (ISP DNS bypass)...")
        _patch_tmdb_with_curl(tmdb)
        _patch_anilist_with_curl(anilist)
    else:
        print("Using direct httpx (set UNBORED_BUILD_DOH=1 to route via curl+DoH)...")

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

    # AniList goes down for days at a time (it has been outright disabled
    # before). Losing every anime because of an upstream outage would be a far
    # worse catalog than a slightly stale one, so keep what we already had.
    if not anime:
        carried = _previous_anime()
        if carried:
            print(f"  ! AniList unavailable — carrying {len(carried)} anime from the existing catalog")
            anime = carried
        else:
            print("  ! AniList unavailable and no previous anime to fall back on")

    all_items = movies + shows + anime
    seen: set[str] = set()
    catalog: list[MediaItem] = []
    for item in all_items:
        if item.id in seen or not _quality_ok(item):
            continue
        seen.add(item.id)
        item.franchise = franchise_key(item)
        catalog.append(item)

    before = len(catalog)
    catalog = _collapse_seasons(catalog)
    print(f"  collapsed {before - len(catalog)} duplicate seasons -> {len(catalog)} titles")

    _apply_popularity_norm(catalog)
    catalog.sort(key=lambda m: m.popularity_norm, reverse=True)

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
