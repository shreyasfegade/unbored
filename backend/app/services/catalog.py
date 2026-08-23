"""Load the self-owned catalog dataset.

`app/data/catalog.json` is built offline (scripts/build_catalog.py) from TMDB +
AniList and committed. The running app serves entirely from it — no live
TMDB/AniList calls in the request path, so it's fast and reliable. Posters point
at the public image.tmdb.org CDN and render without any key.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

from app.models.media import MediaItem

logger = logging.getLogger(__name__)

_DATA = Path(__file__).resolve().parent.parent / "data"
_CATALOG = _DATA / "catalog.json"
_EMBEDDINGS = _DATA / "catalog_embeddings.json"


@lru_cache(maxsize=1)
def load_catalog() -> list[MediaItem]:
    """Load and validate the catalog. Cached for the process lifetime."""
    path = _CATALOG if _CATALOG.exists() else (_DATA / "offline_catalog.json")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("Failed to read catalog %s: %s", path.name, exc)
        return []

    items: list[MediaItem] = []
    for entry in raw.get("items", []):
        try:
            items.append(MediaItem.model_validate(entry))
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Skipping invalid catalog entry: %s", exc)

    _ensure_popularity_norm(items)
    logger.info("Loaded %d catalog items from %s", len(items), path.name)
    return items


def _ensure_popularity_norm(items: list[MediaItem]) -> None:
    """Backfill `popularity_norm` for catalogs built before it existed.

    TMDB popularity peaks around 500 and AniList's runs past 1,000,000, so the
    raw numbers can't be ranked together — do it as a percentile within each
    source. Computed here as well as at build time so an older catalog still
    ranks correctly.
    """
    if not items or any(m.popularity_norm for m in items):
        return
    by_source: dict[str, list[MediaItem]] = {}
    for item in items:
        by_source.setdefault(item.source.value, []).append(item)
    for group in by_source.values():
        group.sort(key=lambda m: m.popularity or 0.0)
        last = len(group) - 1 or 1
        for rank, item in enumerate(group):
            item.popularity_norm = round(rank / last, 6)


@lru_cache(maxsize=1)
def catalog_metadata() -> dict:
    """Catalog provenance: generated_at, count, attribution. Empty on failure."""
    path = _CATALOG if _CATALOG.exists() else (_DATA / "offline_catalog.json")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {
        "generated_at": raw.get("generated_at"),
        "count": raw.get("count", len(raw.get("items", []))),
        "attribution": raw.get("attribution"),
    }


@lru_cache(maxsize=1)
def load_embeddings() -> dict[str, list[float]]:
    """Load precomputed semantic embeddings (id -> normalized vector). Empty if
    the file is absent — the engine then runs BM25-only."""
    if not _EMBEDDINGS.exists():
        logger.info("No catalog_embeddings.json — engine runs BM25-only.")
        return {}
    try:
        raw = json.loads(_EMBEDDINGS.read_text(encoding="utf-8"))
        vectors = raw.get("vectors", {})
        logger.info("Loaded %d catalog embeddings (%s)", len(vectors), raw.get("model", "?"))
        return vectors
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("Failed to read embeddings: %s", exc)
        return {}
