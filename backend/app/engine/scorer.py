import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from app.engine.confidence import calculate_confidence
from app.engine.diversity import calculate_diversity_score
from app.engine.mood_modifiers import (
    BOOST_MULTIPLIER,
    PENALIZE_MULTIPLIER,
    expand_candidate_genres,
    get_mood_modifier,
    get_time_of_day_modifier,
)
from app.models.media import MediaItem, MediaSource, MediaType
from app.models.mood import MoodType, TimeOfDay, TimeSlot
from app.models.recommendation import ScoreBreakdown, ScoredMediaItem
from app.models.taste import UserTasteVector

logger = logging.getLogger(__name__)

W_GENRE = 0.25
W_KEYWORD = 0.30
W_MOOD = 0.20
W_RUNTIME = 0.15
W_RATING = 0.05
W_DIVERSITY = 0.05

assert (
    abs((W_GENRE + W_KEYWORD + W_MOOD + W_RUNTIME + W_RATING + W_DIVERSITY) - 1.0) < 1e-9
), "Scoring weights must sum to 1.0"

RATING_THRESHOLD_TMDB = 7.0
RATING_THRESHOLD_ANILIST = 7.5
LOW_VOTE_COUNT_THRESHOLD = 100
LOW_VOTE_COUNT_PENALTY = 0.5


@dataclass(frozen=True)
class RuntimeRange:
    ideal_min: int
    ideal_max: int
    acceptable_min: int
    acceptable_max: int


RUNTIME_RANGES: dict[TimeSlot, RuntimeRange] = {
    TimeSlot.SHORT: RuntimeRange(ideal_min=20, ideal_max=30, acceptable_min=15, acceptable_max=45),
    TimeSlot.MEDIUM: RuntimeRange(ideal_min=60, ideal_max=90, acceptable_min=30, acceptable_max=120),
    TimeSlot.LONG: RuntimeRange(ideal_min=100, ideal_max=150, acceptable_min=80, acceptable_max=240),
}


@dataclass
class GenreKeywordRule:
    required_genres: set[str]
    min_rating: Optional[float]
    min_runtime: Optional[int]
    is_anime: Optional[bool]
    keywords: list[str]

    def matches(
        self,
        genres: set[str],
        rating: float,
        runtime: int,
        is_anime: bool,
    ) -> bool:
        if not self.required_genres.issubset(genres):
            return False
        if self.min_rating is not None and rating < self.min_rating:
            return False
        if self.min_runtime is not None and runtime < self.min_runtime:
            return False
        if self.is_anime is not None and is_anime != self.is_anime:
            return False
        return True


class WeightedScorer:
    def __init__(
        self,
        taste_vector: UserTasteVector,
        mood: Optional[MoodType],
        time_available: TimeSlot,
        time_of_day: TimeOfDay,
        recommendation_history: list[MediaItem],
    ) -> None:
        self.taste_vector = taste_vector
        self.mood = mood
        self.time_available = time_available
        self.time_of_day = time_of_day
        self.recommendation_history = recommendation_history
        self.curated_overrides = self._load_curated_overrides()
        self.genre_keyword_rules = self._load_genre_keyword_rules()

    @staticmethod
    def _load_curated_overrides() -> dict[str, list[str]]:
        path = Path(__file__).parent.parent / "data" / "curated_overrides.json"
        if not path.exists():
            logger.warning("curated_overrides.json not found at %s", path)
            return {}
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return {k: [val.lower().strip() for val in v] for k, v in data.items()}

    @staticmethod
    def _load_genre_keyword_rules() -> list[GenreKeywordRule]:
        path = Path(__file__).parent.parent / "data" / "genre_keyword_inference.json"
        if not path.exists():
            logger.warning("genre_keyword_inference.json not found at %s", path)
            return []
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        rules: list[GenreKeywordRule] = []
        for entry in raw:
            rules.append(
                GenreKeywordRule(
                    required_genres={g.lower().strip() for g in entry["required_genres"]},
                    min_rating=entry.get("min_rating"),
                    min_runtime=entry.get("min_runtime"),
                    is_anime=entry.get("is_anime"),
                    keywords=[kw.lower().strip() for kw in entry["keywords"]],
                )
            )
        return rules

    def _genre_score(self, candidate: MediaItem, apply_mood: bool = True) -> float:
        candidate_genres = expand_candidate_genres(candidate.genres)
        if not candidate_genres:
            return 0.0

        modifier = get_mood_modifier(self.mood) if (self.mood and apply_mood) else None
        time_modifier = (
            get_time_of_day_modifier(self.time_of_day, self.mood)
            if (self.time_of_day and apply_mood)
            else None
        )

        genre_score = 0.0
        for genre in candidate_genres:
            genre_lower = genre.lower().strip()
            base_weight = self.taste_vector.genres.get(genre_lower, 0.0)

            if modifier:
                boost_genres_lower = {g.lower().strip() for g in modifier.boost_genres}
                penalize_genres_lower = {g.lower().strip() for g in modifier.penalize_genres}
                if genre_lower in boost_genres_lower:
                    base_weight *= BOOST_MULTIPLIER
                elif genre_lower in penalize_genres_lower:
                    base_weight *= PENALIZE_MULTIPLIER

            if time_modifier:
                time_boost_genres_lower = {g.lower().strip() for g in time_modifier.genre_boost_targets}
                if genre_lower in time_boost_genres_lower:
                    base_weight += time_modifier.genre_boost_amount

            genre_score += base_weight

        return genre_score / len(candidate_genres)

    def _keyword_score(self, candidate: MediaItem) -> float:
        effective_keywords = self._get_effective_keywords(candidate)
        if not effective_keywords:
            return 0.0

        modifier = get_mood_modifier(self.mood) if self.mood else None
        boost_kw = {k.lower().strip() for k in modifier.boost_keywords} if modifier else set()
        penalize_kw = {k.lower().strip() for k in modifier.penalize_keywords} if modifier else set()

        keyword_score = 0.0
        for kw in effective_keywords:
            kw_lower = kw.lower().strip()
            base_weight = self.taste_vector.keywords.get(kw_lower, 0.05)
            if kw_lower in boost_kw:
                base_weight *= BOOST_MULTIPLIER
            elif kw_lower in penalize_kw:
                base_weight *= PENALIZE_MULTIPLIER
            keyword_score += base_weight

        keyword_score /= len(effective_keywords)
        return max(0.0, min(1.0, keyword_score))

    def _mood_score(self, candidate: MediaItem) -> float:
        if self.mood is None:
            return 0.5

        modifier = get_mood_modifier(self.mood)
        time_modifier = get_time_of_day_modifier(self.time_of_day, self.mood)

        effective_intensity = max(
            0.0,
            min(
                1.0,
                self.taste_vector.emotional_intensity
                + modifier.emotional_intensity_modifier
                + time_modifier.emotional_intensity_bonus,
            ),
        )
        intensity_diff = abs(candidate.inferred_emotional_intensity - effective_intensity)
        intensity_score = 1.0 - intensity_diff

        effective_pacing = (
            modifier.pacing_modifier
            if modifier.pacing_modifier is not None
            else self.taste_vector.pacing_preference
        )
        if candidate.inferred_pacing == effective_pacing:
            pacing_score = 1.0
        else:
            pacing_score = 0.5
        if effective_pacing == "mixed":
            pacing_score = 0.75

        effective_darkness = max(
            0.0,
            min(
                1.0,
                self.taste_vector.darkness_preference
                + modifier.darkness_modifier
                + time_modifier.darkness_bonus,
            ),
        )
        darkness_diff = abs(candidate.inferred_darkness - effective_darkness)
        darkness_score = 1.0 - darkness_diff

        mood_score = (intensity_score * 0.4) + (pacing_score * 0.3) + (darkness_score * 0.3)
        return max(0.0, min(1.0, mood_score))

    def _runtime_score(self, candidate: MediaItem) -> float:
        runtime = self._effective_runtime(candidate)
        if runtime is None:
            return 0.3

        range_ = RUNTIME_RANGES[self.time_available]
        if range_.ideal_min <= runtime <= range_.ideal_max:
            return 1.0
        elif range_.acceptable_min <= runtime <= range_.acceptable_max:
            return 0.5
        else:
            return 0.0

    def _rating_score(self, candidate: MediaItem) -> float:
        is_anime = candidate.media_type == MediaType.ANIME or candidate.source == MediaSource.ANILIST
        threshold = RATING_THRESHOLD_ANILIST if is_anime else RATING_THRESHOLD_TMDB

        if candidate.vote_average < threshold:
            return 0.0

        score = (candidate.vote_average - threshold) / (10.0 - threshold)

        if candidate.vote_count < LOW_VOTE_COUNT_THRESHOLD:
            score *= LOW_VOTE_COUNT_PENALTY

        return min(score, 1.0)

    def _diversity_score(self, candidate: MediaItem) -> float:
        recent_primary_genres: list[str] = []
        for prev in self.recommendation_history[:2]:
            if prev.genres:
                recent_primary_genres.append(prev.genres[0])
        return calculate_diversity_score(candidate.genres, recent_primary_genres)

    def _get_effective_keywords(self, candidate: MediaItem) -> list[str]:
        override = self.curated_overrides.get(candidate.id)
        if override is not None:
            return override

        keywords = list(candidate.keywords)
        if len(keywords) < 3:
            logger.warning(
                "Sparse keywords: %s (%s) has %d keywords",
                candidate.title,
                candidate.id,
                len(candidate.keywords),
            )
            inferred = self._infer_keywords_from_genre(candidate)
            for kw in inferred:
                if kw not in keywords:
                    keywords.append(kw)

        return keywords

    def _infer_keywords_from_genre(self, candidate: MediaItem) -> list[str]:
        inferred: list[str] = []
        genres = {g.lower().strip() for g in candidate.genres}
        rating = candidate.vote_average
        runtime = candidate.runtime_minutes or 0
        is_anime = (
            candidate.media_type == MediaType.ANIME or candidate.source == MediaSource.ANILIST
        )

        for rule in self.genre_keyword_rules:
            if rule.matches(genres, rating, runtime, is_anime):
                inferred.extend(rule.keywords)

        return inferred

    def _effective_runtime(self, candidate: MediaItem) -> Optional[int]:
        if candidate.runtime_minutes is not None and candidate.runtime_minutes > 0:
            return candidate.runtime_minutes

        is_anime = candidate.media_type == MediaType.ANIME or candidate.source == MediaSource.ANILIST
        if is_anime:
            return 24

        if candidate.media_type == MediaType.TV or candidate.source == MediaSource.TMDB_TV:
            return 45

        return None

    @staticmethod
    def _sort_key(scored: ScoredMediaItem) -> tuple:
        return (
            scored.score,
            scored.media.release_year or 0,
            scored.media.vote_count,
            scored.media.popularity,
        )

    def score_candidate(
        self, candidate: MediaItem, raw_genre: Optional[float] = None
    ) -> ScoredMediaItem:
        genre = raw_genre if raw_genre is not None else self._genre_score(candidate)
        keyword = self._keyword_score(candidate)
        mood = self._mood_score(candidate)
        runtime = self._runtime_score(candidate)
        rating = self._rating_score(candidate)
        diversity = self._diversity_score(candidate)

        final = (
            genre * W_GENRE
            + keyword * W_KEYWORD
            + mood * W_MOOD
            + runtime * W_RUNTIME
            + rating * W_RATING
            + diversity * W_DIVERSITY
        )
        final = max(0.0, min(1.0, final))

        breakdown = ScoreBreakdown(
            genre=round(genre, 4),
            keyword=round(keyword, 4),
            mood=round(mood, 4),
            runtime=round(runtime, 4),
            rating=round(rating, 4),
            diversity=round(diversity - 1.0, 4),
        )

        return ScoredMediaItem(
            media=candidate,
            score=round(final, 4),
            score_breakdown=breakdown,
        )

    def score_batch(self, candidates: list[MediaItem]) -> list[ScoredMediaItem]:
        watched_set = set(self.taste_vector.watched_ids)

        filtered: list[MediaItem] = []
        for c in candidates:
            if c.id in watched_set:
                continue
            is_anime = c.media_type == MediaType.ANIME or c.source == MediaSource.ANILIST
            threshold = RATING_THRESHOLD_ANILIST if is_anime else RATING_THRESHOLD_TMDB
            if c.vote_average < threshold:
                continue
            filtered.append(c)

        if not filtered:
            logger.warning("No candidates survived pre-filtering.")
            return []

        raw_genres: dict[str, float] = {}
        for c in filtered:
            raw_genres[c.id] = self._genre_score(c)

        max_genre = max(raw_genres.values(), default=1.0) or 1.0
        normalized_genres = {cid: raw / max_genre for cid, raw in raw_genres.items()}

        scored: list[ScoredMediaItem] = []
        for c in filtered:
            norm_genre = normalized_genres[c.id]
            scored.append(self.score_candidate(c, raw_genre=norm_genre))

        scored.sort(key=self._sort_key, reverse=True)

        if scored:
            primary = scored[0]
            alt1 = scored[1] if len(scored) > 1 else None
            alt2 = scored[2] if len(scored) > 2 else None
            logger.info(
                "Recommendation generated | pool_size=%d | filtered=%d | "
                "primary=%s (score=%.4f) | alt1=%s (score=%.4f) | alt2=%s (score=%.4f)",
                len(candidates),
                len(filtered),
                primary.media.title,
                primary.score,
                alt1.media.title if alt1 else "None",
                alt1.score if alt1 else 0.0,
                alt2.media.title if alt2 else "None",
                alt2.score if alt2 else 0.0,
            )

        for i, item in enumerate(scored[:10]):
            logger.debug(
                "Rank #%d: %s | genre=%.3f kw=%.3f mood=%.3f rt=%.3f rat=%.3f div=%.3f -> final=%.4f",
                i + 1,
                item.media.title,
                item.score_breakdown.genre,
                item.score_breakdown.keyword,
                item.score_breakdown.mood,
                item.score_breakdown.runtime,
                item.score_breakdown.rating,
                item.score_breakdown.diversity,
                item.score,
            )

        return scored
