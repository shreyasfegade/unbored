from __future__ import annotations
import asyncio
import json
import logging
import statistics
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Optional
from uuid import uuid4

from app.models.media import MediaItem, MediaSource, YouTubeTasteSignals
from app.models.mood import MoodType, TimeOfDay, TimeSlot
from app.models.taste import (
    EnrichmentSource,
    PacingPreference,
    RuntimePreference,
    UpdateTasteRequest,
    UserTasteVector,
)
from app.services.anilist_service import AniListService
from app.services.tmdb_service import TMDBService
from app.storage.file_store import file_store

logger = logging.getLogger(__name__)

ARCHETYPES_PATH = Path(__file__).parent.parent / "data" / "vibe_archetypes.json"

GENRE_WEIGHTS_BY_COUNT: dict[int, float] = {
    5: 1.0,
    4: 0.9,
    3: 0.8,
    2: 0.5,
    1: 0.2,
}

FAST_GENRES: set[str] = {"action", "thriller", "adventure", "horror"}
SLOW_GENRES: set[str] = {"drama", "romance", "documentary"}
INTENSE_GENRES: set[str] = {"drama", "war", "history"}
DARK_GENRES: set[str] = {"thriller", "horror", "crime", "mystery"}


class NoRecommendationError(Exception):
    """Raised when fallback recommendation also finds no suitable candidates."""


YOUTUBE_BLEND_WEIGHT = 0.3


def merge_youtube_signals(
    vector: UserTasteVector, signals: YouTubeTasteSignals
) -> UserTasteVector:
    for genre, weight in signals.genres_extracted.items():
        current = vector.genres.get(genre, 0.0)
        vector.genres[genre] = round(current * (1 - YOUTUBE_BLEND_WEIGHT) + weight * YOUTUBE_BLEND_WEIGHT, 2)

    for keyword, weight in signals.keywords_extracted.items():
        current = vector.keywords.get(keyword, 0.0)
        vector.keywords[keyword] = round(
            current * (1 - YOUTUBE_BLEND_WEIGHT) + weight * YOUTUBE_BLEND_WEIGHT, 4
        )

    if signals.animation_affinity_delta > 0:
        vector.animation_affinity = round(
            vector.animation_affinity * (1 - YOUTUBE_BLEND_WEIGHT)
            + signals.animation_affinity_delta * YOUTUBE_BLEND_WEIGHT,
            2,
        )

    source = EnrichmentSource.YOUTUBE_IMPORT.value
    if source not in vector.enrichment_sources:
        vector.enrichment_sources.append(source)

    vector.updated_at = datetime.now(timezone.utc)
    return vector


# ── Archetype loading & matching ──────────────────────────────


@lru_cache(maxsize=1)
def load_archetypes() -> list[dict]:
    data = json.loads(ARCHETYPES_PATH.read_text(encoding="utf-8"))
    return data["archetypes"]


def match_archetypes(taste_vector: UserTasteVector) -> list[tuple[dict, float]]:
    archetypes = load_archetypes()
    matches: list[tuple[dict, float]] = []

    for archetype in archetypes:
        trigger_genres = archetype["trigger_genres"]
        total_weight = sum(
            taste_vector.genres.get(genre, 0.0) for genre in trigger_genres
        )
        overlap_score = total_weight / len(trigger_genres)

        if overlap_score >= archetype["trigger_threshold"]:
            matches.append((archetype, overlap_score))

    return sorted(matches, key=lambda x: x[1], reverse=True)


def is_cold_start(vector: UserTasteVector) -> bool:
    total_items = len(vector.favourites)
    genres_with_signal = sum(1 for w in vector.genres.values() if w > 0.2)
    keywords_with_signal = sum(1 for w in vector.keywords.values() if w > 0.1)
    return total_items < 10 and (genres_with_signal < 3 or keywords_with_signal < 5)


def augment_with_archetype(
    vector: UserTasteVector,
    archetype: dict,
    strength: float = 1.0,
) -> UserTasteVector:
    for genre, boost in archetype["boost_genres"].items():
        existing = vector.genres.get(genre, 0.0)
        vector.genres[genre] = min(round(existing + boost * strength, 2), 1.0)

    for keyword, boost in archetype["boost_keywords"].items():
        existing = vector.keywords.get(keyword, 0.0)
        vector.keywords[keyword] = min(round(existing + boost * strength, 2), 1.0)

    if archetype.get("pacing_hint") and vector.pacing_preference == PacingPreference.MIXED:
        vector.pacing_preference = PacingPreference(archetype["pacing_hint"])

    if archetype.get("emotional_intensity_hint") is not None:
        vector.emotional_intensity = round(
            vector.emotional_intensity * 0.7 + archetype["emotional_intensity_hint"] * 0.3, 2
        )

    if archetype.get("darkness_hint") is not None:
        vector.darkness_preference = round(
            vector.darkness_preference * 0.7 + archetype["darkness_hint"] * 0.3, 2
        )

    vector.archetype_applied = archetype["id"]
    return vector


def apply_cold_start_augmentation(vector: UserTasteVector) -> UserTasteVector:
    if not is_cold_start(vector):
        return vector

    matches = match_archetypes(vector)
    if not matches:
        archetypes = load_archetypes()
        best = max(
            archetypes,
            key=lambda a: sum(vector.genres.get(g, 0) for g in a["trigger_genres"]),
        )
        return augment_with_archetype(vector, best, strength=0.5)

    top_archetype, score = matches[0]
    strength = min(score / top_archetype["trigger_threshold"], 1.0)
    return augment_with_archetype(vector, top_archetype, strength=strength)


def get_archetype_strength(vector: UserTasteVector) -> float:
    total_items = len(vector.favourites)
    if total_items < 10:
        return 1.0
    elif total_items < 20:
        return 0.5
    elif total_items < 30:
        return 0.25
    else:
        return 0.0


# ── TasteBuilder ──────────────────────────────────────────────


def _parse_composite_id(composite_id: str) -> tuple[Optional[int], Optional[int], Optional[MediaSource]]:
    composite_id = composite_id.strip()
    if composite_id.startswith("tmdb_movie_"):
        return (int(composite_id[len("tmdb_movie_"):]), None, MediaSource.TMDB_MOVIE)
    elif composite_id.startswith("tmdb_tv_"):
        return (int(composite_id[len("tmdb_tv_"):]), None, MediaSource.TMDB_TV)
    elif composite_id.startswith("anilist_"):
        return (None, int(composite_id[len("anilist_"):]), MediaSource.ANILIST)
    elif composite_id.startswith("tmdb_"):
        return (int(composite_id[5:]), None, MediaSource.TMDB_MOVIE)
    elif composite_id.startswith("al_"):
        return (None, int(composite_id[3:]), MediaSource.ANILIST)
    return (None, None, None)


def _find_in_pool(pool_candidates: list[MediaItem], composite_id: str) -> Optional[MediaItem]:
    for item in pool_candidates:
        if item.id == composite_id:
            return item
    return None


def _runtime_fits(item: MediaItem, time_available: TimeSlot) -> bool:
    slot_ranges: dict[TimeSlot, tuple[int, int]] = {
        TimeSlot.SHORT: (0, 45),
        TimeSlot.MEDIUM: (0, 120),
        TimeSlot.LONG: (0, 999),
    }
    runtime = item.runtime_minutes
    if runtime is None:
        return True
    min_val, max_val = slot_ranges.get(time_available, (0, 999))
    return min_val <= runtime <= max_val


class TasteBuilder:

    def __init__(
        self,
        tmdb: TMDBService,
        anilist: AniListService,
        pool: "CandidatePool",
    ) -> None:
        self.tmdb = tmdb
        self.anilist = anilist
        self.pool = pool

    async def _fetch_item_detail(self, composite_id: str) -> Optional[MediaItem]:
        tmdb_id, anilist_id, source = _parse_composite_id(composite_id)
        if source is None:
            return None

        # Try pool first
        cached = _find_in_pool(self.pool.candidates, composite_id)
        if cached is not None and cached.keywords:
            return cached

        if source == MediaSource.ANILIST and anilist_id is not None:
            return await self.anilist.get_detail(anilist_id)
        elif source == MediaSource.TMDB_MOVIE and tmdb_id is not None:
            detail = await self.tmdb.get_movie_detail(tmdb_id)
            if detail is not None:
                keywords = await self.tmdb.get_movie_keywords(tmdb_id)
                detail.keywords = keywords
                return detail
        elif source == MediaSource.TMDB_TV and tmdb_id is not None:
            detail = await self.tmdb.get_tv_detail(tmdb_id)
            if detail is not None:
                keywords = await self.tmdb.get_tv_keywords(tmdb_id)
                detail.keywords = keywords
                return detail

        logger.warning("No detail returned for %s", composite_id)
        return None

    async def build_from_favourites(self, favourite_ids: list[str]) -> UserTasteVector:
        tasks = [self._fetch_item_detail(cid) for cid in favourite_ids]
        items = await asyncio.gather(*tasks)

        valid_items = [item for item in items if item is not None]
        if not valid_items:
            raise ValueError("No valid items to build taste vector from.")

        return self._build_vector_from_items(valid_items)

    def _build_vector_from_items(self, items: list[MediaItem]) -> UserTasteVector:
        # Aggregate genres
        all_genres: list[str] = []
        for item in items:
            all_genres.extend(item.genres)

        genre_counts: dict[str, int] = {}
        for g in all_genres:
            g_lower = g.lower().strip()
            genre_counts[g_lower] = genre_counts.get(g_lower, 0) + 1

        genres: dict[str, float] = {}
        for g_lower, count in genre_counts.items():
            weight = GENRE_WEIGHTS_BY_COUNT.get(count, 0.1)
            genres[g_lower] = weight

        # Aggregate keywords
        all_keywords: list[str] = []
        for item in items:
            all_keywords.extend(item.keywords)

        keyword_counts: dict[str, int] = {}
        for kw in all_keywords:
            kw_lower = kw.lower().strip()
            if kw_lower:
                keyword_counts[kw_lower] = keyword_counts.get(kw_lower, 0) + 1

        total_items = len(items)
        keywords: dict[str, float] = {}
        for kw_lower, count in keyword_counts.items():
            keywords[kw_lower] = min(round(count / total_items, 2), 1.0)

        # Pacing
        fast_count = sum(1 for g in all_genres if g.lower().strip() in FAST_GENRES)
        slow_count = sum(1 for g in all_genres if g.lower().strip() in SLOW_GENRES)
        if fast_count > slow_count:
            pacing = PacingPreference.FAST
        elif slow_count > fast_count:
            pacing = PacingPreference.SLOW
        else:
            pacing = PacingPreference.MIXED

        # Emotional intensity
        intense_count = sum(1 for g in all_genres if g.lower().strip() in INTENSE_GENRES)
        max_genres_per_pick = max((len(i.genres) for i in items), default=1)
        emotional_intensity = round(
            min(intense_count / (total_items * max_genres_per_pick), 1.0), 2
        )

        # Darkness
        dark_count = sum(1 for g in all_genres if g.lower().strip() in DARK_GENRES)
        darkness = round(min(dark_count / (total_items * max_genres_per_pick), 1.0), 2)

        # Humor affinity
        comedy_count = sum(1 for g in all_genres if g.lower().strip() == "comedy")
        humor = round(min(comedy_count / total_items, 1.0), 2)

        # Animation affinity
        anim_count = sum(
            1
            for i in items
            if "animation" in {g.lower().strip() for g in i.genres}
            or i.media_type.value == "anime"
        )
        animation = round(min(anim_count / total_items, 1.0), 2)

        # Runtime preference
        runtimes = sorted(
            [i.runtime_minutes for i in items if i.runtime_minutes is not None]
        )
        if runtimes:
            median = runtimes[len(runtimes) // 2]
            if median <= 30:
                runtime_pref = RuntimePreference.SHORT
            elif median <= 90:
                runtime_pref = RuntimePreference.MEDIUM
            else:
                runtime_pref = RuntimePreference.LONG
        else:
            runtime_pref = RuntimePreference.MEDIUM

        # Build vector
        vector = UserTasteVector(
            id=str(uuid4()),
            genres=genres,
            keywords=keywords,
            pacing_preference=pacing,
            emotional_intensity=emotional_intensity,
            darkness_preference=darkness,
            humor_affinity=humor,
            animation_affinity=animation,
            runtime_preference=runtime_pref,
            watched_ids=[item.id for item in items],
            favourites=[item.id for item in items],
            onboarding_completed=True,
            enrichment_sources=[EnrichmentSource.ONBOARDING_STEP1.value],
        )

        # Apply cold start augmentation
        vector = apply_cold_start_augmentation(vector)

        # Save
        file_store.save_vector(vector)
        logger.info(
            "Built taste vector %s: %d genres, %d keywords, pacing=%s, archetype=%s",
            vector.id, len(genres), len(keywords), pacing.value, vector.archetype_applied,
        )

        return vector

    async def update_with_enrichment(
        self, vector: UserTasteVector, request: UpdateTasteRequest
    ) -> UserTasteVector:
        all_items: list[MediaItem] = []

        # Fetch existing favourites
        existing_tasks = [self._fetch_item_detail(cid) for cid in vector.favourites]
        existing_results = await asyncio.gather(*existing_tasks)
        all_items.extend([i for i in existing_results if i is not None])

        # Fetch new favourites if any
        if request.add_favourites:
            new_favs = [fid for fid in request.add_favourites if fid not in vector.favourites]
            new_tasks = [self._fetch_item_detail(cid) for cid in new_favs]
            new_results = await asyncio.gather(*new_tasks)
            new_items = [i for i in new_results if i is not None]
            all_items.extend(new_items)

            # Update favourites list
            for item in new_items:
                if item.id not in vector.favourites:
                    vector.favourites.append(item.id)

        if not all_items:
            raise ValueError("No valid items to rebuild taste vector from.")

        # Rebuild from all items
        rebuilt = self._build_vector_from_items(all_items)
        rebuilt.id = vector.id  # Preserve original ID

        # Re-apply archetype with decayed strength
        strength = get_archetype_strength(rebuilt)
        if strength > 0.0 and rebuilt.archetype_applied:
            archetypes = load_archetypes()
            matched = [a for a in archetypes if a["id"] == rebuilt.archetype_applied]
            if matched:
                vector_updated = augment_with_archetype(rebuilt, matched[0], strength=strength)
            else:
                vector_updated = rebuilt
        elif strength == 0.0 and rebuilt.archetype_applied:
            # Clear archetype — enough real data now
            rebuilt.archetype_applied = None
            vector_updated = rebuilt
        else:
            vector_updated = rebuilt

        # Apply manual overrides
        if request.genre_overrides:
            for g, w in request.genre_overrides.items():
                vector_updated.genres[g.lower().strip()] = w

        if request.keyword_overrides:
            for kw, w in request.keyword_overrides.items():
                vector_updated.keywords[kw.lower().strip()] = w

        if request.pacing_preference is not None:
            vector_updated.pacing_preference = request.pacing_preference

        if request.emotional_intensity is not None:
            vector_updated.emotional_intensity = request.emotional_intensity

        if request.darkness_preference is not None:
            vector_updated.darkness_preference = request.darkness_preference

        if request.humor_affinity is not None:
            vector_updated.humor_affinity = request.humor_affinity

        if request.animation_affinity is not None:
            vector_updated.animation_affinity = request.animation_affinity

        if request.runtime_preference is not None:
            vector_updated.runtime_preference = request.runtime_preference

        # Add new watched IDs
        if request.add_watched_ids:
            for wid in request.add_watched_ids:
                if wid not in vector_updated.watched_ids:
                    vector_updated.watched_ids.append(wid)

        # Ensure favourites are in watched_ids
        for fid in vector_updated.favourites:
            if fid not in vector_updated.watched_ids:
                vector_updated.watched_ids.append(fid)

        # Enrichment source
        if request.enrichment_source:
            if request.enrichment_source not in vector_updated.enrichment_sources:
                vector_updated.enrichment_sources.append(request.enrichment_source)

        vector_updated.updated_at = vector_updated.created_at.replace()

        file_store.save_vector(vector_updated)
        logger.info("Updated taste vector %s via enrichment", vector_updated.id)

        return vector_updated
