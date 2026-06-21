"""Bundled offline catalog for demo mode.

When no TMDB key is configured, Unbored serves this hand-curated set of titles
instead of the live catalog, so the full recommendation loop works with zero
configuration and zero network calls. Items intentionally carry no poster URL —
the frontend renders an elegant procedural poster card for them.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

from app.models.media import MediaItem

logger = logging.getLogger(__name__)

_CATALOG_PATH = Path(__file__).resolve().parent.parent / "data" / "offline_catalog.json"


@lru_cache(maxsize=1)
def load_offline_catalog() -> list[MediaItem]:
    """Load and validate the bundled catalog. Cached for the process lifetime."""
    try:
        raw = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("Failed to read offline catalog: %s", exc)
        return []

    items: list[MediaItem] = []
    for entry in raw.get("items", []):
        try:
            items.append(MediaItem.model_validate(entry))
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Skipping invalid offline catalog entry: %s", exc)

    logger.info("Loaded %d items from offline catalog (demo mode)", len(items))
    return items
