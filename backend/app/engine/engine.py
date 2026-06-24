"""The recommendation engine.

Combines four signals into a single ranking:

  * relevance  — hybrid kNN + centroid content similarity to the user's taste
                 (the dominant signal; see content.py)
  * mood fit   — smooth tone-space distance to the chosen mood (tone.py)
  * runtime    — smooth fit to the time the user has
  * quality    — Bayesian-weighted rating prior

It then diversifies the visible picks with MMR and calibrates a confidence
level from where the top score lands in the pool's distribution. This is fully
deterministic and works with no LLM — the LLM layer only re-picks/explains on
top of the shortlist this produces.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.engine.content import ContentIndex, cosine
from app.engine.tone import mood_fit
from app.models.media import MediaItem, MediaSource, MediaType
from app.models.mood import ConfidenceLevel, TimeSlot
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
_W_REL = 0.52
_W_MOOD = 0.22
_W_RUNTIME = 0.14
_W_QUALITY = 0.12

# Retrieve-then-rerank: how many top taste matches to retrieve, and the
# mood-leaning weights used to re-rank within that already-relevant set.
_RETRIEVE_N = 30
_W_RERANK = (0.25, 0.46, 0.17, 0.12)


def _is_anime(item: MediaItem) -> bool:
    return item.media_type == MediaType.ANIME or item.source == MediaSource.ANILIST


def runtime_fit(item: MediaItem, slot: TimeSlot) -> float:
    """Smooth Gaussian-ish fit of an item's runtime to the chosen slot."""
    center, tol = _RUNTIME_SHAPE[slot]
    rt = item.runtime_minutes
    if not rt:
        rt = 24 if _is_anime(item) else (45 if item.media_type == MediaType.TV else None)
    if not rt:
        return 0.5
    z = (rt - center) / tol
    return max(0.1, math.exp(-0.7 * z * z))


def quality_prior(item: MediaItem) -> float:
    """Bayesian-weighted rating mapped to [0,1]. Fixes the old backwards penalty."""
    m = _PRIOR_VOTES_ANILIST if _is_anime(item) else _PRIOR_VOTES_TMDB
    v = max(item.vote_count, 0)
    r = item.vote_average or _PRIOR_MEAN
    weighted = (v / (v + m)) * r + (m / (v + m)) * _PRIOR_MEAN
    return max(0.0, min(1.0, (weighted - 6.0) / 3.0))  # 6.0->0, 9.0->1


@dataclass
class EngineResult:
    ranked: list[ScoredMediaItem]      # full pool, best first
    shortlist: list[ScoredMediaItem]   # top-N for the LLM curator
    primary: ScoredMediaItem
    alternates: list[ScoredMediaItem]  # MMR-diversified, len 2
    confidence: ConfidenceLevel


class RecommendationEngine:
    def __init__(
        self,
        index: ContentIndex,
        *,
        liked_ids: list[str],
        mood: str | None,
        time_available: TimeSlot,
        media_type: str | None = None,
    ) -> None:
        self._index = index
        self._mood = mood
        self._slot = time_available
        self._media_type = media_type if media_type in {"movie", "tv", "anime"} else None
        self._liked_vectors = index.liked_vectors(liked_ids)
        self._centroid = index.centroid(liked_ids)
        self._n_liked = len(self._liked_vectors)

    def _weights(self) -> tuple[float, float, float, float]:
        """Relevance leans out when the taste profile is too thin (cold start)."""
        if self._n_liked >= 2:
            return _W_REL, _W_MOOD, _W_RUNTIME, _W_QUALITY
        # Cold: redistribute relevance into mood + quality.
        scale = self._n_liked / 2.0  # 0 or 0.5
        rel = _W_REL * scale
        freed = _W_REL - rel
        return rel, _W_MOOD + freed * 0.45, _W_RUNTIME, _W_QUALITY + freed * 0.55

    def rank(self, candidates: list[MediaItem]) -> list[ScoredMediaItem]:
        pool = candidates
        if self._media_type:
            pool = [c for c in pool if c.media_type.value == self._media_type]
            if not pool:
                pool = candidates  # don't return nothing if the filter empties it

        raw_rel = {
            c.id: self._index.relevance(c.id, self._centroid, self._liked_vectors) for c in pool
        }
        has_taste = self._n_liked > 0 and max(raw_rel.values(), default=0.0) > 0

        # Retrieve-then-rerank: first narrow to the strongest taste matches, then
        # let mood/runtime choose within them. Everything in the retrieve set is
        # already "your taste", so the mood you pick genuinely shapes the result
        # instead of one best match dominating every mood.
        if has_taste:
            retrieve = sorted(pool, key=lambda c: raw_rel[c.id], reverse=True)[:_RETRIEVE_N]
            w_rel, w_mood, w_rt, w_q = _W_RERANK
        else:  # cold start — no taste signal yet
            retrieve = pool
            w_rel, w_mood, w_rt, w_q = self._weights()

        max_rel = max((raw_rel[c.id] for c in retrieve), default=0.0)

        scored: list[ScoredMediaItem] = []
        for c in retrieve:
            rel = (raw_rel[c.id] / max_rel) if max_rel > 0 else 0.0
            mood = mood_fit(c, self._mood)
            runtime = runtime_fit(c, self._slot)
            quality = quality_prior(c)
            final = w_rel * rel + w_mood * mood + w_rt * runtime + w_q * quality
            scored.append(
                ScoredMediaItem(
                    media=c,
                    score=round(max(0.0, min(1.0, final)), 4),
                    score_breakdown=ScoreBreakdown(
                        relevance=round(rel, 4), mood=round(mood, 4),
                        runtime=round(runtime, 4), quality=round(quality, 4),
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

    def _confidence(self, scored: list[ScoredMediaItem], primary: ScoredMediaItem) -> ConfidenceLevel:
        sample = [s.score for s in scored[:60]]
        if len(sample) < 4:
            return ConfidenceLevel.MODERATE
        mean = sum(sample) / len(sample)
        var = sum((x - mean) ** 2 for x in sample) / len(sample)
        std = math.sqrt(var) or 1e-6
        z = (primary.score - mean) / std
        # Reward genuine taste relevance, not just being top of a flat pool.
        rel = primary.score_breakdown.relevance
        if z >= 1.1 and rel >= 0.30:
            return ConfidenceLevel.HIGH
        if z >= 0.5 or rel >= 0.40:
            return ConfidenceLevel.STRONG
        return ConfidenceLevel.MODERATE

    def recommend(self, candidates: list[MediaItem], *, shortlist_size: int = 8) -> EngineResult | None:
        ranked = self.rank(candidates)
        if not ranked:
            return None
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
            confidence=self._confidence(ranked, primary),
        )
