"""Build the Netflix-style browse shelves from the frozen catalog.

The HTTP layer (`routers/browse.py`) just slices what this produces. Two rules
keep browsing from feeling repetitive and mislabelled:

1. **One shelf per title.** A title is claimed by at most one row — a curated
   collection first, otherwise its single best genre. Previously a title could
   appear in a curated row, its media-type row *and* a genre row, so ~1800 of
   2420 titles showed up more than once and browsing felt like the same wall of
   posters over and over.

2. **Genre rows by fit, not by rarity.** The old code filed each title under its
   *rarest* genre, which left no Action row at all (only 11 of 708 action titles
   had action as their rarest tag) and scattered dramas into Music. Here each
   title lands in the genre it most strongly *is*, scored from how few genres it
   carries (specificity) and how close it sits to that genre's centre in
   embedding space (affinity).
"""

from __future__ import annotations

import logging
from functools import lru_cache

import numpy as np

from app.models.media import MediaItem, MediaType
from app.services.catalog import load_catalog, load_embeddings

logger = logging.getLogger(__name__)

GENRE_MIN = 18           # a genre needs this many claimed titles to earn a row
CURATED_SIZE = 120       # trending / acclaimed / new are finite, curated lists
TYPE_CAP = 0.55          # no media type may exceed this share of a mixed row
ACCLAIM_MIN_VOTES = 400
ACCLAIM_PRIOR = 3000     # votes of "average" a title is pulled toward
FIT_FLOOR = 0.34         # a genre row whose members fit it weakly is dropped

# Genres that describe a format or a scrap of metadata rather than a thing to
# browse for — they never carry a satisfying row.
PRUNE_GENRES = {"news", "talk", "soap", "reality", "tv movie", "documentary", "ecchi"}
# Fold near-duplicates into their broader neighbour.
GENRE_MERGE = {"kids": "family"}

_GENRE_TITLE = {"sci-fi": "Sci-Fi"}


def _genre_title(slug: str) -> str:
    return _GENRE_TITLE.get(slug, slug.title())


def effective_genres(m: MediaItem) -> list[str]:
    """A title's genres after merging near-duplicates and dropping format tags,
    de-duplicated with order preserved."""
    out: list[str] = []
    for g in m.genres:
        g = GENRE_MERGE.get(g, g)
        if g in PRUNE_GENRES or g in out:
            continue
        out.append(g)
    return out


def _dedupe_franchise(items: list[MediaItem]) -> list[MediaItem]:
    """One entry per series in a row, so a franchise can't fill the screen."""
    seen: set[str] = set()
    out: list[MediaItem] = []
    for m in items:
        key = m.franchise or m.id
        if key in seen:
            continue
        seen.add(key)
        out.append(m)
    return out


def _balance_types(items: list[MediaItem], cap: float = TYPE_CAP) -> list[MediaItem]:
    """Keep a title's quality order, but stop one media type from monopolising
    the front of a row by *deferring* — never dropping — items over its running
    share.

    A genre row is a title's only home, so every item is kept. Items arrive
    already sorted by quality; an item whose type is already over `cap` of what's
    been placed is held back and slotted in as soon as its share allows, with any
    still-held items appended at the end.
    """
    counts = {}
    for m in items:
        counts[m.media_type] = counts.get(m.media_type, 0) + 1
    if len(counts) < 2:
        return items

    out: list[MediaItem] = []
    held: list[MediaItem] = []
    taken: dict[MediaType, int] = {}

    def fits(t: MediaType) -> bool:
        # Always allow the first few so a row can start; then hold a type once it
        # would exceed its cap of everything placed so far.
        placed = len(out)
        return placed < 3 or taken.get(t, 0) < cap * (placed + 1)

    for m in items:
        # Before placing the next quality item, drain anything held that now fits.
        i = 0
        while i < len(held):
            if fits(held[i].media_type):
                h = held.pop(i)
                out.append(h)
                taken[h.media_type] = taken.get(h.media_type, 0) + 1
            else:
                i += 1
        if fits(m.media_type):
            out.append(m)
            taken[m.media_type] = taken.get(m.media_type, 0) + 1
        else:
            held.append(m)
    out.extend(held)  # whatever never fit its cap tails the row
    return out


def _quality_percentile(catalog: list[MediaItem]) -> dict[str, float]:
    """Bayesian-weighted rating mapped to a 0-1 percentile across the catalog.

    Weighted so a 9.5 from 200 votes (a curio) ranks below an 8.6 from 25,000
    (a classic). Percentile, not the raw score, so it composes with fit and
    popularity on the same scale.
    """
    rated = [m for m in catalog if m.vote_count >= ACCLAIM_MIN_VOTES]
    mean = (sum(m.vote_average for m in rated) / len(rated)) if rated else 6.8

    def weighted(m: MediaItem) -> float:
        v = m.vote_count
        return (v / (v + ACCLAIM_PRIOR)) * m.vote_average + (ACCLAIM_PRIOR / (v + ACCLAIM_PRIOR)) * mean

    ordered = sorted(catalog, key=weighted)
    last = len(ordered) - 1 or 1
    return {m.id: rank / last for rank, m in enumerate(ordered)}


def _genre_centroids(
    catalog: list[MediaItem], eligible: set[str], vectors: dict[str, list[float]]
) -> dict[str, np.ndarray]:
    """A unit vector per genre: the specificity-weighted mean of its members'
    embeddings, so affinity(title, genre) is a cosine against it. Empty when no
    embeddings are loaded (the engine's BM25-only mode) — affinity is then 0 and
    specificity alone decides."""
    if not vectors:
        return {}
    acc: dict[str, np.ndarray] = {}
    for m in catalog:
        vec = vectors.get(m.id)
        if not vec:
            continue
        gs = [g for g in effective_genres(m) if g in eligible]
        if not gs:
            continue
        w = 1.0 / len(gs)  # a purer title speaks louder for its genres
        arr = np.asarray(vec, dtype=np.float32) * w
        for g in gs:
            acc[g] = acc.get(g, 0.0) + arr
    out: dict[str, np.ndarray] = {}
    for g, v in acc.items():
        norm = float(np.linalg.norm(v))
        if norm > 0:
            out[g] = v / norm
    return out


def _best_genre(
    m: MediaItem, eligible: set[str], centroids: dict[str, np.ndarray], vectors: dict[str, list[float]]
) -> tuple[str, float] | None:
    """The genre a title most strongly is, and the fit score behind it."""
    gs = [g for g in effective_genres(m) if g in eligible]
    if not gs:
        return None
    specificity = 1.0 / len(gs)
    vec = vectors.get(m.id)
    mv = np.asarray(vec, dtype=np.float32) if vec else None
    best_g, best_fit = None, -1.0
    for g in gs:
        affinity = 0.0
        if mv is not None and g in centroids:
            affinity = max(0.0, float(np.dot(mv, centroids[g])))
        fit = 0.6 * specificity + 0.4 * affinity
        if fit > best_fit:
            best_g, best_fit = g, fit
    return (best_g, best_fit) if best_g else None


@lru_cache(maxsize=1)
def build_shelves() -> list[dict]:
    """The ordered shelf catalog, built once. Each entry carries its members
    already sorted for display, so `/shelf/{key}` is a slice."""
    catalog = [m for m in load_catalog() if m.poster_path]
    vectors = load_embeddings()
    by_pop = sorted(catalog, key=lambda m: m.popularity_norm, reverse=True)
    quality_pct = _quality_percentile(catalog)

    shelves: list[dict] = []

    def add(key: str, title: str, items: list[MediaItem]) -> None:
        items = _balance_types(_dedupe_franchise(items))
        if items:
            shelves.append({"key": key, "title": title, "items": items})

    # ── Curated rows claim first; a claimed title appears in no other row. ──
    used: set[str] = set()

    def take(pool: list[MediaItem], limit: int) -> list[MediaItem]:
        picked = [m for m in pool if m.id not in used][:limit]
        used.update(m.id for m in picked)
        return picked

    # Acclaim, ranked *within source*: AniList scores cluster at 8.5+ while
    # TMDB's span 6-8.7, so a straight sort would hand the row to anime.
    rated = [m for m in catalog if m.vote_count >= ACCLAIM_MIN_VOTES]
    mean = (sum(m.vote_average for m in rated) / len(rated)) if rated else 6.8

    def weighted(m: MediaItem) -> float:
        v = m.vote_count
        return (v / (v + ACCLAIM_PRIOR)) * m.vote_average + (ACCLAIM_PRIOR / (v + ACCLAIM_PRIOR)) * mean

    acclaim_pct: dict[str, float] = {}
    by_src: dict[str, list[MediaItem]] = {}
    for m in rated:
        by_src.setdefault(m.source.value, []).append(m)
    for group in by_src.values():
        group.sort(key=weighted)
        last = len(group) - 1 or 1
        for rank, m in enumerate(group):
            acclaim_pct[m.id] = rank / last

    # Most-specific pool first so the narrow rows keep their defining titles;
    # trending is huge and can afford to claim last.
    acclaimed = take(sorted(rated, key=lambda m: acclaim_pct.get(m.id, 0.0), reverse=True), CURATED_SIZE)
    recent = take([m for m in by_pop if (m.release_year or 0) >= 2023], CURATED_SIZE)
    trending = take(by_pop, CURATED_SIZE)

    add("trending", "Trending Now", trending)
    add("top_rated", "Critically Acclaimed", acclaimed)
    add("new_releases", "New & Recent", recent)

    # ── Genre rows from what the curated rows didn't claim. ─────────────
    remaining = [m for m in catalog if m.id not in used]

    genre_size: dict[str, int] = {}
    for m in remaining:
        for g in set(effective_genres(m)):
            genre_size[g] = genre_size.get(g, 0) + 1
    eligible = {g for g, n in genre_size.items() if n >= GENRE_MIN}

    centroids = _genre_centroids(remaining, eligible, vectors)

    members: dict[str, list[tuple[MediaItem, float]]] = {}
    for m in remaining:
        best = _best_genre(m, eligible, centroids, vectors)
        if best is None:
            continue
        g, fit = best
        members.setdefault(g, []).append((m, fit))

    def row_order(m: MediaItem, fit: float) -> float:
        return 0.55 * fit + 0.30 * quality_pct.get(m.id, 0.0) + 0.15 * m.popularity_norm

    for g in sorted(members, key=lambda k: len(members[k]), reverse=True):
        entries = members[g]
        if len(entries) < GENRE_MIN:
            continue
        mean_fit = sum(f for _, f in entries) / len(entries)
        if mean_fit < FIT_FLOOR:
            continue
        ordered = [m for m, _ in sorted(entries, key=lambda e: row_order(e[0], e[1]), reverse=True)]
        add(f"genre:{g}", _genre_title(g), ordered)

    return shelves
