"""Dependency-free BM25-weighted content vectors for semantic similarity.

Each title becomes a sparse term vector built from weighted fields (title,
genres, keywords, overview, people), weighted with BM25 term saturation and
smoothed IDF, then L2-normalized so similarity is a cosine (dot product).

This is the semantic backbone of the recommender: a user's taste is the
centroid of (and nearest neighbours among) the things they like, and a good
recommendation is one whose content vector is close to that taste — far richer
than exact genre/keyword matching.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from app.models.media import MediaItem

# BM25 parameters.
_K1 = 1.5
_B = 0.75

# Hybrid blend: dense (semantic) leads, sparse (BM25) sharpens exact matches.
_W_DENSE = 0.65
_W_SPARSE = 0.35

# Field weights (how strongly each field contributes to the term counts).
_W_TITLE = 3.0
_W_GENRE = 3.0
_W_KEYWORD = 3.0
_W_PEOPLE = 1.5
_W_OVERVIEW = 1.0

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "his",
    "her", "their", "its", "is", "are", "was", "were", "be", "by", "as", "at",
    "from", "that", "this", "it", "he", "she", "they", "who", "what", "when",
    "but", "not", "into", "out", "up", "down", "over", "after", "before", "new",
    "one", "two", "all", "more", "most", "than", "then", "him", "them", "you",
    "your", "about", "between", "while", "must", "has", "have", "had", "will",
}


def _tokens(text: str) -> list[str]:
    return [t for t in _TOKEN_RE.findall(text.lower()) if len(t) > 1 and t not in _STOPWORDS]


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower().strip()).strip("-")


def _weighted_terms(item: MediaItem) -> dict[str, float]:
    """Build a weighted term-frequency map for one item."""
    tf: dict[str, float] = {}

    def add(term: str, weight: float) -> None:
        if term:
            tf[term] = tf.get(term, 0.0) + weight

    for tok in _tokens(item.title):
        add(tok, _W_TITLE)
    for tok in _tokens(item.original_title):
        add(tok, _W_TITLE * 0.5)
    for g in item.genres:
        add(f"g:{_slug(g)}", _W_GENRE)
    for kw in item.keywords:
        add(f"k:{_slug(kw)}", _W_KEYWORD)
    for person in [item.director, item.studio, *item.cast[:3]]:
        if person:
            add(f"p:{_slug(person)}", _W_PEOPLE)
    for tok in _tokens(item.overview):
        add(tok, _W_OVERVIEW)

    return tf


def _normalize(vec: dict[str, float]) -> dict[str, float]:
    norm = math.sqrt(sum(v * v for v in vec.values()))
    if norm == 0:
        return vec
    return {k: v / norm for k, v in vec.items()}


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    """Dot product of two already-L2-normalized sparse vectors."""
    if len(a) > len(b):
        a, b = b, a
    return sum(w * b.get(t, 0.0) for t, w in a.items())


@dataclass
class TasteProfile:
    """A user's taste in both spaces: sparse (BM25) and dense (embeddings)."""
    sparse_centroid: dict[str, float]
    sparse_liked: list[dict[str, float]]
    dense_centroid: list[float]
    dense_liked: list[list[float]]
    n_liked: int


def _dense_norm(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def _dense_dot(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b)) if a and b else 0.0


def _knn_centroid_score(cand, centroid, liked, dot, k: int, knn_weight: float) -> float:
    """Shared hybrid kNN+centroid scoring for either space."""
    sim_centroid = dot(cand, centroid) if centroid else 0.0
    if liked:
        sims = sorted((dot(cand, lv) for lv in liked), reverse=True)[:k]
        denom = sum(sims)
        sim_knn = (sum(s * s for s in sims) / denom) if denom > 0 else 0.0
    else:
        sim_knn = 0.0
    return knn_weight * sim_knn + (1.0 - knn_weight) * sim_centroid


class ContentIndex:
    """Hybrid content index: BM25 sparse vectors + dense semantic embeddings.

    Relevance blends a dense, *meaning-aware* similarity (precomputed sentence
    embeddings) with a sparse BM25 similarity that nails exact title / keyword /
    person matches. Embeddings are optional — without them the index degrades
    gracefully to BM25-only.
    """

    def __init__(self, items: list[MediaItem], embeddings: dict[str, list[float]] | None = None) -> None:
        self._tf: dict[str, dict[str, float]] = {}
        self._len: dict[str, float] = {}
        df: dict[str, int] = {}

        for item in items:
            tf = _weighted_terms(item)
            self._tf[item.id] = tf
            self._len[item.id] = sum(tf.values())
            for term in tf:
                df[term] = df.get(term, 0) + 1

        n = max(len(items), 1)
        self._idf = {
            term: math.log(1.0 + (n - d + 0.5) / (d + 0.5)) for term, d in df.items()
        }
        avgdl = (sum(self._len.values()) / n) if n else 1.0
        self._avgdl = avgdl or 1.0

        self._vectors: dict[str, dict[str, float]] = {
            item_id: self._bm25_vector(item_id) for item_id in self._tf
        }

        # Dense embeddings (precomputed offline, already L2-normalized). Optional.
        self._dense: dict[str, list[float]] = {}
        if embeddings:
            self._dense = {i: embeddings[i] for i in self._tf if i in embeddings}
        self.has_dense = len(self._dense) > 0

    def _bm25_vector(self, item_id: str) -> dict[str, float]:
        tf = self._tf[item_id]
        dl = self._len[item_id]
        denom_norm = _K1 * (1.0 - _B + _B * dl / self._avgdl)
        vec: dict[str, float] = {}
        for term, freq in tf.items():
            idf = self._idf.get(term, 0.0)
            if idf <= 0.0:
                continue
            weight = idf * (freq * (_K1 + 1.0)) / (freq + denom_norm)
            vec[term] = weight
        return _normalize(vec)

    def has(self, item_id: str) -> bool:
        return item_id in self._vectors

    def vector(self, item_id: str) -> dict[str, float]:
        return self._vectors.get(item_id, {})

    def _sparse_centroid(self, item_ids: list[str]) -> dict[str, float]:
        acc: dict[str, float] = {}
        count = 0
        for item_id in item_ids:
            vec = self._vectors.get(item_id)
            if not vec:
                continue
            count += 1
            for term, w in vec.items():
                acc[term] = acc.get(term, 0.0) + w
        return _normalize({t: w / count for t, w in acc.items()}) if count else {}

    def _dense_centroid(self, item_ids: list[str]) -> list[float]:
        vecs = [self._dense[i] for i in item_ids if i in self._dense]
        if not vecs:
            return []
        dim = len(vecs[0])
        mean = [sum(v[d] for v in vecs) / len(vecs) for d in range(dim)]
        return _dense_norm(mean)

    def build_profile(self, item_ids: list[str]) -> TasteProfile:
        """Precompute the user's taste centroids + neighbours in both spaces."""
        return TasteProfile(
            sparse_centroid=self._sparse_centroid(item_ids),
            sparse_liked=[self._vectors[i] for i in item_ids if i in self._vectors],
            dense_centroid=self._dense_centroid(item_ids),
            dense_liked=[self._dense[i] for i in item_ids if i in self._dense],
            n_liked=sum(1 for i in item_ids if i in self._vectors),
        )

    def relevance(self, candidate_id: str, profile: TasteProfile, *, k: int = 3) -> float:
        """Hybrid relevance: dense semantic similarity blended with sparse BM25.

        Each space uses a kNN+centroid score (centroid = overall taste; kNN =
        nearest liked items, so several distinct tastes aren't averaged away).
        """
        cand_sparse = self._vectors.get(candidate_id)
        if cand_sparse is None:
            return 0.0

        sparse = _knn_centroid_score(
            cand_sparse, profile.sparse_centroid, profile.sparse_liked, cosine, k, 0.55
        )

        cand_dense = self._dense.get(candidate_id)
        if cand_dense and (profile.dense_centroid or profile.dense_liked):
            dense = _knn_centroid_score(
                cand_dense, profile.dense_centroid, profile.dense_liked, _dense_dot, k, 0.55
            )
            return _W_DENSE * dense + _W_SPARSE * sparse
        return sparse
