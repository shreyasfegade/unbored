"""In-memory candidate pool, served from the self-owned catalog.

The pool is the whole catalog loaded once at startup. No live TMDB/AniList calls
happen in the request path — that data was baked in offline by
scripts/build_catalog.py, so the app is fast and never blocked on a flaky API.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from app.models.media import MediaItem
from app.services.catalog import load_catalog

logger = logging.getLogger(__name__)


class CandidatePool:
    def __init__(self, tmdb=None, anilist=None) -> None:
        # tmdb/anilist accepted for compatibility; unused at runtime.
        self.candidates: list[MediaItem] = []
        self.last_refresh: Optional[datetime] = None

    async def refresh(self) -> None:
        self.candidates = list(load_catalog())
        self.last_refresh = datetime.now(timezone.utc)
        logger.info("Candidate pool loaded: %d catalog items", len(self.candidates))

    def get_candidates(self, exclude_ids: Optional[list[str]] = None) -> list[MediaItem]:
        if not exclude_ids:
            return list(self.candidates)
        exclude = set(exclude_ids)
        return [c for c in self.candidates if c.id not in exclude]
