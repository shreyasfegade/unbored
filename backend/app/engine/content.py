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

from app.models.media import MediaItem

# BM25 parameters.
_K1 = 1.5
_B = 0.75

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


class ContentIndex:
    """BM25-weighted, L2-normalized content vectors over a catalog."""

    def __init__(self, items: list[MediaItem]) -> None:
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

    def centroid(self, item_ids: list[str]) -> dict[str, float]:
        """L2-normalized mean of the given items' vectors (those present)."""
        acc: dict[str, float] = {}
        count = 0
        for item_id in item_ids:
            vec = self._vectors.get(item_id)
            if not vec:
                continue
            count += 1
            for term, w in vec.items():
                acc[term] = acc.get(term, 0.0) + w
        if count == 0:
            return {}
        return _normalize({t: w / count for t, w in acc.items()})

    def liked_vectors(self, item_ids: list[str]) -> list[dict[str, float]]:
        return [self._vectors[i] for i in item_ids if i in self._vectors]

    def relevance(
        self,
        candidate_id: str,
        centroid: dict[str, float],
        liked_vectors: list[dict[str, float]],
        *,
        k: int = 3,
        knn_weight: float = 0.55,
    ) -> float:
        """Hybrid kNN + centroid similarity of a candidate to the taste profile.

        The centroid captures the user's overall taste; the kNN term (mean of the
        top-k most similar liked items) preserves users with several distinct
        tastes that a single centroid would average away.
        """
        cand = self._vectors.get(candidate_id)
        if not cand:
            return 0.0

        sim_centroid = cosine(cand, centroid) if centroid else 0.0

        if liked_vectors:
            sims = sorted((cosine(cand, lv) for lv in liked_vectors), reverse=True)
            top = sims[:k]
            # Similarity-weighted (contraharmonic) mean: the nearest neighbours
            # dominate, so a candidate matching ONE of several distinct taste
            # clusters isn't diluted by the user's other tastes.
            denom = sum(top)
            sim_knn = (sum(s * s for s in top) / denom) if denom > 0 else 0.0
        else:
            sim_knn = 0.0

        return knn_weight * sim_knn + (1.0 - knn_weight) * sim_centroid
