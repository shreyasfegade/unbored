import asyncio
import logging
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Optional

from app.models.media import MediaItem, MediaSource
from app.services.tmdb_service import TMDBService
from app.services.anilist_service import AniListService

logger = logging.getLogger(__name__)


class CandidatePool:
    """In-memory pool of candidate content for recommendations."""

    def __init__(self, tmdb: TMDBService, anilist: Optional[AniListService] = None) -> None:
        self.tmdb = tmdb
        self.anilist = anilist
        self.candidates: list[MediaItem] = []
        self.last_refresh: Optional[datetime] = None

    async def refresh(self) -> None:
        """Fetch fresh candidates from TMDB and AniList, deduplicate and enrich them."""
        logger.info("Refreshing candidate pool...")
        all_items: list[MediaItem] = []

        try:
            tmdb_items = await self.tmdb.get_full_candidate_pool()
            all_items.extend(tmdb_items)
        except Exception as e:
            logger.error("Failed to fetch TMDB candidate pool: %s", e)

        if self.anilist:
            anilist_tasks = [
                self.anilist.get_trending(page=1),
                self.anilist.get_trending(page=2),
                self.anilist.get_top_rated(page=1),
                self.anilist.get_top_rated(page=2),
            ]
            results = await asyncio.gather(*anilist_tasks, return_exceptions=True)
            for i, res in enumerate(results):
                if isinstance(res, Exception):
                    logger.warning("Failed to fetch AniList page (task index %d): %s", i, res)
                else:
                    all_items.extend(res)

        seen_ids: set[str] = set()
        unique_by_id: list[MediaItem] = []
        for item in all_items:
            if item.id not in seen_ids:
                seen_ids.add(item.id)
                unique_by_id.append(item)

        al_items = [item for item in unique_by_id if item.source == MediaSource.ANILIST]
        tmdb_items = [
            item for item in unique_by_id
            if item.source in (MediaSource.TMDB_MOVIE, MediaSource.TMDB_TV)
        ]

        excluded_tmdb_ids: set[str] = set()

        for al_item in al_items:
            al_titles = {al_item.title.lower().strip(), al_item.original_title.lower().strip()}
            al_titles.discard("")

            best_tmdb_match: Optional[MediaItem] = None
            best_ratio = 0.85

            for tmdb_item in tmdb_items:
                tmdb_titles = {tmdb_item.title.lower().strip(), tmdb_item.original_title.lower().strip()}
                tmdb_titles.discard("")

                for al_t in al_titles:
                    for tmdb_t in tmdb_titles:
                        ratio = SequenceMatcher(None, al_t, tmdb_t).ratio()
                        if ratio > best_ratio:
                            best_ratio = ratio
                            best_tmdb_match = tmdb_item

            if best_tmdb_match:
                logger.info(
                    "Fuzzy match found: AniList '%s' matches TMDB '%s' (ratio: %.2f). Merging ID...",
                    al_item.title, best_tmdb_match.title, best_ratio,
                )
                al_item.tmdb_id = best_tmdb_match.tmdb_id
                excluded_tmdb_ids.add(best_tmdb_match.id)

        final_candidates = al_items + [
            item for item in tmdb_items if item.id not in excluded_tmdb_ids
        ]

        self.candidates = final_candidates
        self.last_refresh = datetime.now(timezone.utc)
        logger.info("Pool refresh complete. Total candidates: %d", len(self.candidates))

    def get_candidates(self, exclude_ids: Optional[list[str]] = None) -> list[MediaItem]:
        """Return candidates with exclusions applied."""
        if not exclude_ids:
            return list(self.candidates)
        exclude_set = set(exclude_ids)
        return [c for c in self.candidates if c.id not in exclude_set]
