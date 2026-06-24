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

    logger.info("Loaded %d catalog items from %s", len(items), path.name)
    return items


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
