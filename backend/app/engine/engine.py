"""The recommendation engine.

Combines five signals into a single ranking:

  * relevance  — hybrid kNN + centroid content similarity to the user's taste
                 (the dominant signal; see content.py)
  * mood fit   — smooth tone-space distance to the chosen mood, personalised by
                 the user's standing taste and the time of day (tone.py)
  * runtime    — smooth fit to the time the user has
  * quality    — Bayesian-weighted rating prior, age-corrected
  * recency    — release-year fit to the user's era preference

It then diversifies the visible picks with MMR and calibrates a confidence
level from where the top score lands in the pool's distribution. This is fully
deterministic and works with no LLM — the LLM layer only re-picks/explains on
top of the shortlist this produces.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone

from app.engine.content import ContentIndex, cosine
from app.engine.tone import mood_fit_to_target, mood_target
from app.models.media import MediaItem, MediaSource, MediaType
from app.models.mood import ConfidenceLevel, EraPreference, TimeSlot
from app.models.recommendation import ScoreBreakdown, ScoredMediaItem

# Runtime fit: (ideal center, tolerance) in minutes per slot. Soft, not a filter.
_RUNTIME_SHAPE: dict[TimeSlot, tuple[float, float]] = {
    TimeSlot.SHORT: (28.0, 38.0),
    TimeSlot.MEDIUM: (75.0, 55.0),
    TimeSlot.LONG: (135.0, 95.0),
}

# Bayesian rating prior.
_PRIOR_MEAN = 6.8          # global mean rating (C)
_PRIOR_VOTES_TMDB = 1000   # m for movies/TV
_PRIOR_VOTES_ANILIST = 800

# Blend weights when the taste profile is established (>= 2 liked items).
# Five signals now sum to 1.0 (relevance still leads).
_W_REL = 0.44
_W_MOOD = 0.20
_W_RUNTIME = 0.12
_W_QUALITY = 0.10
_W_RECENCY = 0.14

# Retrieve-then-rerank: how many top taste matches to retrieve, and the
# mood-leaning weights used to re-rank within that already-relevant set. The
# retrieve set is wide enough that the mood/era you pick genuinely reshapes the
# result instead of one best taste match dominating every mood.
_RETRIEVE_N = 120
_W_RERANK = (0.20, 0.40, 0.13, 0.09, 0.18)

# Recency: reference year and per-era decay half-lives (years). ``None`` for
# CLASSIC, which inverts the curve (older scores higher).
_REF_YEAR = datetime.now(timezone.utc).year
# ANY is a gentle tilt (a 20-year-old film still scores ~0.7), so it nudges
# away from ancient picks without erasing a user's 2010s favourites. MODERN
# decays fast; CLASSIC inverts entirely.
_ERA_HALFLIFE: dict[EraPreference, float | None] = {
    EraPreference.ANY: 45.0,
    EraPreference.MODERN: 11.0,
    EraPreference.CLASSIC: None,
}
# When the user cares about era, recency pulls more weight (renormalized).
_ERA_RECENCY_BOOST: dict[EraPreference, float] = {
    EraPreference.ANY: 1.0,
    EraPreference.MODERN: 2.2,
    EraPreference.CLASSIC: 2.2,
}


def _is_anime(item: MediaItem) -> bool:
    return item.media_type == MediaType.ANIME or item.source == MediaSource.ANILIST


def runtime_fit(item: MediaItem, slot: TimeSlot) -> float:
    """Fit of an item's *per-sitting* runtime to the chosen slot.

    For series the runtime is one episode (the time slot means "one sitting"),
    so a 6-episode and a 200-episode drama both fit a 45-minute window. Series
    length is a separate *commitment* signal: a very long series is nudged down
    for the shortest slot, and shown to the AI (see curator) so it can weigh it.
    """
    center, tol = _RUNTIME_SHAPE[slot]
    rt = item.runtime_minutes
    if not rt:
        rt = 24 if _is_anime(item) else (45 if item.media_type == MediaType.TV else None)
    if not rt:
        return 0.5
    z = (rt - center) / tol
    # Low floor so a genuinely wrong runtime actually costs the item.
    fit = max(0.04, math.exp(-0.7 * z * z))
    if slot == TimeSlot.SHORT and (item.episode_count or 0) > 50:
        fit *= 0.9  # a long series is a big commitment for "I have 30 minutes"
    return fit


def _item_year(item: MediaItem) -> int | None:
    return item.release_year or item.year


def recency_fit(item: MediaItem, era: EraPreference) -> float:
    """How well an item's release year fits the era preference, in [0,1].

    Neutral (0.5) when the year is unknown, so the 11 undated catalog items are
    never penalised or rewarded for it.
    """
    year = _item_year(item)
    if not year:
        return 0.5
    age = max(0, _REF_YEAR - year)
    if era == EraPreference.CLASSIC:
        # Older is better; plateau past ~45 years.
        return max(0.0, min(1.0, 0.35 + age / 45.0))
    half = _ERA_HALFLIFE.get(era) or _ERA_HALFLIFE[EraPreference.ANY]
    return max(0.0, min(1.0, 0.5 ** (age / half)))  # 0y -> 1.0, half-life -> 0.5


def quality_prior(item: MediaItem) -> float:
    """Bayesian-weighted rating mapped to [0,1], with a gentle age correction so
    decades of accumulated votes don't automatically out-rank recent titles."""
    m = _PRIOR_VOTES_ANILIST if _is_anime(item) else _PRIOR_VOTES_TMDB
    v = max(item.vote_count, 0)
    r = item.vote_average or _PRIOR_MEAN
    weighted = (v / (v + m)) * r + (m / (v + m)) * _PRIOR_MEAN
    base = max(0.0, min(1.0, (weighted - 6.0) / 3.0))  # 6.0->0, 9.0->1
    return base


@dataclass
class EngineResult:
    ranked: list[ScoredMediaItem]      # full pool, best first
    shortlist: list[ScoredMediaItem]   # top-N for the LLM curator
    primary: ScoredMediaItem
    alternates: list[ScoredMediaItem]  # MMR-diversified, len 0..2
    confidence: ConfidenceLevel
    media_type_applied: bool = True    # False when the type filter was dropped


class RecommendationEngine:
    def __init__(
        self,
        index: ContentIndex,
        *,
        liked_ids: list[str],
        mood: str | None,
        time_available: TimeSlot,
        media_type: str | None = None,
        era: EraPreference = EraPreference.ANY,
        time_of_day: str | None = None,
        taste: dict[str, float] | None = None,
        genre_boosts: dict[str, float] | None = None,
    ) -> None:
        self._index = index
        self._mood = mood
        self._slot = time_available
        self._media_type = media_type if media_type in {"movie", "tv", "anime"} else None
        self._era = era
        self._profile = index.build_profile(liked_ids)
        self._n_liked = self._profile.n_liked
        # Personalised mood target: taste dims + time of day fold into the tone
        # target once, up front, instead of being ignored.
        self._mood_target = mood_target(mood, taste=taste, time_of_day=time_of_day)
        # Optional AI-supplied bias (query expansion): genre -> weight in [0,1].
        # A soft additive nudge so the AI shapes what surfaces, not a hard filter.
        self._genre_boosts = {g.lower().strip(): float(w) for g, w in (genre_boosts or {}).items()}
        self._media_type_applied = True

    def _genre_bonus(self, item: MediaItem) -> float:
        if not self._genre_boosts:
            return 0.0
        hits = [self._genre_boosts.get(g.lower().strip(), 0.0) for g in item.genres]
        return max(hits) if hits else 0.0

    def _weights(self) -> tuple[float, float, float, float, float]:
        """Relevance leans out when the taste profile is too thin (cold start)."""
        if self._n_liked >= 2:
            base = (_W_REL, _W_MOOD, _W_RUNTIME, _W_QUALITY, _W_RECENCY)
        else:
            # Cold: redistribute relevance into mood + quality + recency.
            scale = self._n_liked / 2.0  # 0 or 0.5
            rel = _W_REL * scale
            freed = _W_REL - rel
            base = (
                rel,
                _W_MOOD + freed * 0.4,
                _W_RUNTIME,
                _W_QUALITY + freed * 0.3,
                _W_RECENCY + freed * 0.3,
            )
        return self._apply_era_boost(base)

    def _apply_era_boost(
        self, w: tuple[float, float, float, float, float]
    ) -> tuple[float, float, float, float, float]:
        """When the user picks an era, recency earns more of the budget."""
        boost = _ERA_RECENCY_BOOST.get(self._era, 1.0)
        if boost == 1.0:
            return w
        w_rel, w_mood, w_rt, w_q, w_rec = w
        new_rec = w_rec * boost
        # Pull the extra proportionally from the other four so weights still sum to 1.
        others = w_rel + w_mood + w_rt + w_q
        extra = new_rec - w_rec
        if others > 0:
            factor = max(0.0, (others - extra) / others)
            w_rel, w_mood, w_rt, w_q = (x * factor for x in (w_rel, w_mood, w_rt, w_q))
        return (w_rel, w_mood, w_rt, w_q, new_rec)

    def rank(self, candidates: list[MediaItem]) -> list[ScoredMediaItem]:
        pool = candidates
        if self._media_type:
            filtered = [c for c in pool if c.media_type.value == self._media_type]
            if filtered:
                pool = filtered
            else:
                self._media_type_applied = False  # don't return nothing; flag it

        raw_rel = {c.id: self._index.relevance(c.id, self._profile) for c in pool}
        has_taste = self._n_liked > 0 and max(raw_rel.values(), default=0.0) > 0

        # Retrieve-then-rerank: first narrow to the strongest taste matches, then
        # let mood/era/runtime choose within them.
        if has_taste:
            retrieve = sorted(pool, key=lambda c: raw_rel[c.id], reverse=True)[:_RETRIEVE_N]
            # AI genre bias can *introduce* strong-on-genre titles the taste kNN
            # didn't surface, so the model shapes the candidate set, not just its
            # order. Pull in the best-rated boost matches beyond the retrieve set.
            if self._genre_boosts:
                have = {c.id for c in retrieve}
                extra = [c for c in pool if c.id not in have and self._genre_bonus(c) > 0]
                extra.sort(key=lambda c: (self._genre_bonus(c), c.vote_average, c.vote_count), reverse=True)
                retrieve = retrieve + extra[:_RETRIEVE_N // 2]
            w_rel, w_mood, w_rt, w_q, w_rec = self._apply_era_boost(_W_RERANK)
        else:  # cold start — no taste signal yet
            retrieve = pool
            w_rel, w_mood, w_rt, w_q, w_rec = self._weights()

        max_rel = max((raw_rel[c.id] for c in retrieve), default=0.0)

        scored: list[ScoredMediaItem] = []
        for c in retrieve:
            rel = (raw_rel[c.id] / max_rel) if max_rel > 0 else 0.0
            mood = mood_fit_to_target(c, self._mood_target)
            runtime = runtime_fit(c, self._slot)
            quality = quality_prior(c)
            recency = recency_fit(c, self._era)
            final = (
                w_rel * rel + w_mood * mood + w_rt * runtime
                + w_q * quality + w_rec * recency
                + 0.12 * self._genre_bonus(c)
            )
            scored.append(
                ScoredMediaItem(
                    media=c,
                    score=round(max(0.0, min(1.0, final)), 4),
                    score_breakdown=ScoreBreakdown(
                        relevance=round(rel, 4), mood=round(mood, 4),
                        runtime=round(runtime, 4), quality=round(quality, 4),
                        recency=round(recency, 4),
                    ),
                )
            )
        scored.sort(key=lambda s: (s.score, s.media.vote_count, s.media.popularity), reverse=True)
        return scored

    def _mmr_select(self, scored: list[ScoredMediaItem], n: int, lam: float = 0.72) -> list[ScoredMediaItem]:
        """Maximal Marginal Relevance: relevant but mutually distinct picks."""
        if not scored:
            return []
        selected = [scored[0]]
        pool = scored[1 : 1 + 40]  # only diversify among the strong contenders
        while len(selected) < n and pool:
            best, best_val = None, -1e9
            for cand in pool:
                cv = self._index.vector(cand.media.id)
                max_sim = max(
                    (cosine(cv, self._index.vector(s.media.id)) for s in selected),
                    default=0.0,
                )
                val = lam * cand.score - (1.0 - lam) * max_sim
                if val > best_val:
                    best, best_val = cand, val
            selected.append(best)
            pool.remove(best)
        return selected

    def _confidence(
        self, scored: list[ScoredMediaItem], primary: ScoredMediaItem, raw_rel: dict[str, float]
    ) -> ConfidenceLevel:
        """Confidence = how close the pick genuinely is to the user's taste.

        Keyed on the *absolute* taste relevance of the top pick. The old code
        used a z-score over the pool, but z is ~always large (the top item
        separates strongly from a long tail), so it read 'high' for essentially
        every non-cold profile. Absolute relevance is what actually varies, and
        it's the honest signal: a pick very close to what you love is a confident
        pick; an eclectic profile's best match is a moderate one. A separation
        floor (z) still guards against over-claiming on a flat pool.

        Thresholds are calibrated against the measured relevance distribution
        across random profiles (see test_engine_quality); the eval harness
        asserts HIGH stays rare rather than being the default.
        """
        sample = [s.score for s in scored[:60]]
        if len(sample) < 4:
            return ConfidenceLevel.MODERATE
        mean = sum(sample) / len(sample)
        var = sum((x - mean) ** 2 for x in sample) / len(sample)
        std = math.sqrt(var) or 1e-6
        z = (primary.score - mean) / std
        abs_rel = raw_rel.get(primary.media.id, 0.0)
        if abs_rel >= 0.45 and z >= 1.0:
            return ConfidenceLevel.HIGH
        if abs_rel >= 0.42 and z >= 0.6:
            return ConfidenceLevel.STRONG
        return ConfidenceLevel.MODERATE

    def recommend(self, candidates: list[MediaItem], *, shortlist_size: int = 8) -> EngineResult | None:
        ranked = self.rank(candidates)
        if not ranked:
            return None
        # Absolute relevance for honest confidence calibration.
        raw_rel = {s.media.id: self._index.relevance(s.media.id, self._profile) for s in ranked[:60]}
        picks = self._mmr_select(ranked, 3)
        primary = picks[0]
        alternates = picks[1:3]
        while len(alternates) < 2 and len(ranked) > len(alternates) + 1:
            alternates.append(ranked[len(alternates) + 1])
        return EngineResult(
            ranked=ranked,
            shortlist=ranked[:shortlist_size],
            primary=primary,
            alternates=alternates[:2],
            confidence=self._confidence(ranked, primary, raw_rel),
            media_type_applied=self._media_type_applied,
        )
