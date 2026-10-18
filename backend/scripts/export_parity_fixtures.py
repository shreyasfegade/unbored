"""Export parity fixtures for the browser engine (build-time only).

The Python engine is the reference. This runs it over the *same* int8 pack the
browser ships (app/services/pack.py), on a few hundred seeded requests, and
writes what it returned. `frontend/src/engine/parity.test.ts` replays every
request through the TypeScript port and requires the same picks.

    cd backend && python scripts/build_web_pack.py && python scripts/export_parity_fixtures.py

Deterministic: fixed seeds and a pinned reference year, so re-running on the
same pack writes byte-identical files (CI checks that they're current).
"""

from __future__ import annotations

import asyncio
import json
import random
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app.engine.engine as engine_mod  # noqa: E402
from app.engine.content import ContentIndex  # noqa: E402
from app.engine.engine import RecommendationEngine  # noqa: E402
from app.engine.taste_signals import taste_dims_from_items  # noqa: E402
from app.models.mood import EraPreference, MoodType, TimeSlot  # noqa: E402
from app.models.recommendation import RecommendationRequest  # noqa: E402
from app.routers.recommend import _run_pipeline  # noqa: E402
from app.routers.search import search_catalog  # noqa: E402
from app.routers.taste import summarise  # noqa: E402
from app.services.candidate_pool import CandidatePool  # noqa: E402
from app.services.catalog import load_catalog  # noqa: E402
from app.services.pack import load_pack_embeddings  # noqa: E402

OUT = ROOT.parent / "frontend" / "src" / "engine" / "__fixtures__"
REF_YEAR = 2026
N_REQUESTS = 320
TOP_N = 20

MOODS = [m.value for m in MoodType]
SLOTS = [s.value for s in TimeSlot]
ERAS = [e.value for e in EraPreference]
TYPES = ["movie", "tv", "anime", "surprise"]
TIMES = ["morning", "afternoon", "evening", "late_night"]
PROFILE_SIZES = [0, 1, 2, 5, 5, 8, 20, 100]
GENRES = ["horror", "comedy", "drama", "sci-fi", "romance", "animation", "crime", "fantasy"]

SEARCH_QUERIES = [
    "dark", "the dark knight", "knight dark the", "leon", "léon", "wall-e", "interstelar",
    "spider", "naruto", "attack on titan", "breaking", "god", "a", "zz", "love", "office",
    "parasite", "studio ghibli", "time travel", "inception", "matrx", "toy story", "one piece",
    "squid", "batman", "shawshank", "amelie", "spirited away", "x", "heist",
]


def _profile(rng: random.Random, catalog, size: int) -> list[str]:
    if size == 0:
        return []
    if rng.random() < 0.5:
        genre = rng.choice(GENRES)
        items = [c for c in catalog if genre in {g.lower() for g in c.genres}]
        items.sort(key=lambda c: c.popularity, reverse=True)
        start = rng.randrange(0, 10)
        picked = [c.id for c in items[start:start + size]]
        if len(picked) >= size:
            return picked
    return [c.id for c in rng.sample(catalog, size)]


def _tuning(rng: random.Random) -> dict | None:
    if rng.random() < 0.45:
        return None
    return {
        k: (round(rng.uniform(-1, 1), 2) if rng.random() < 0.7 else 0.0)
        for k in ("adventurous", "obscurity", "acclaim", "freshness")
    }


def _request(rng: random.Random, catalog) -> dict:
    fav = _profile(rng, catalog, rng.choice(PROFILE_SIZES))
    pool = [c.id for c in catalog if c.id not in set(fav)]
    excluded = rng.sample(pool, rng.choice([0, 0, 3, 12, 40]))
    req = {
        "favourite_ids": fav,
        "mood": rng.choice(MOODS),
        "time_available": rng.choice(SLOTS),
        "time_of_day": rng.choice(TIMES),
        "media_type": rng.choice(TYPES),
        "era": rng.choice(ERAS),
        "excluded_ids": excluded,
    }
    tuning = _tuning(rng)
    if tuning is not None:
        req["tuning"] = tuning
    return req


def _scored(s) -> list:
    b = s.score_breakdown
    return [s.media.id, s.score, b.relevance, b.mood, b.runtime, b.quality, b.recency]


def main() -> int:
    engine_mod._REF_YEAR = REF_YEAR  # pin "now" for the pipeline's recency signal
    catalog = load_catalog()
    vectors = load_pack_embeddings()
    if not vectors:
        print("ERROR: no web pack — run scripts/build_web_pack.py first.")
        return 1
    index = ContentIndex(catalog, vectors)
    catalog_map = {c.id: c for c in catalog}

    pool = CandidatePool()
    pool.candidates = list(catalog)
    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(pool=pool, index=index, catalog_map=catalog_map))
    )

    rng = random.Random(20261019)
    cases = []
    for _ in range(N_REQUESTS):
        req = _request(rng, catalog)
        body = RecommendationRequest.model_validate(req)
        resp = asyncio.run(_run_pipeline(request, body, None))

        # The engine's own ranking for the same inputs, for score-level parity.
        excluded = set(body.excluded_ids) | set(body.favourite_ids)
        candidates = [c for c in catalog if c.id not in excluded]
        liked_items = [catalog_map[i] for i in body.favourite_ids if i in catalog_map]
        eng = RecommendationEngine(
            index,
            liked_ids=list(body.favourite_ids),
            mood=body.mood.value,
            time_available=body.time_available,
            media_type=body.media_type,
            era=body.era,
            time_of_day=body.time_of_day,
            taste=taste_dims_from_items(liked_items),
            tuning=body.tuning.model_dump() if body.tuning else None,
            ref_year=REF_YEAR,
        )
        ranked = eng.rank(candidates)

        cases.append({
            "request": req,
            "response": {
                "primary": _scored(resp.primary),
                "alternates": [a.media.id for a in resp.alternates],
                "rationale": resp.rationale,
                "confidence": resp.confidence.value,
                "media_type_applied": resp.media_type_applied,
            },
            "top": [_scored(s) for s in ranked[:TOP_N]],
        })

    # BM25 vectors for a spread of titles: catches tokenizer drift directly.
    bm25 = []
    for item in catalog[:: max(1, len(catalog) // 60)]:
        vec = index.vector(item.id)
        top = sorted(vec.items(), key=lambda kv: (-kv[1], kv[0]))[:5]
        bm25.append({
            "id": item.id,
            "nnz": len(vec),
            "sum": round(sum(vec.values()), 9),
            "top": [[t, round(w, 9)] for t, w in top],
        })

    search = []
    for q in SEARCH_QUERIES:
        for type_ in (None, "anime"):
            results, total = search_catalog(catalog, q, type_)
            search.append({"q": q, "type": type_, "ids": [m.id for m in results], "total": total})

    taste_rng = random.Random(7)
    taste = []
    for size in (0, 1, 3, 10, 40):
        for _ in range(3):
            ids = [c.id for c in taste_rng.sample(catalog, size)] + ["unknown_1"]
            items = [catalog_map[i] for i in ids if i in catalog_map]
            taste.append({"ids": ids, "profile": summarise(items, requested=len(ids)).model_dump()})

    OUT.mkdir(parents=True, exist_ok=True)
    payload = {
        "parity.json": {"ref_year": REF_YEAR, "cases": cases},
        "bm25.json": {"items": bm25},
        "search.json": {"cases": search},
        "taste.json": {"cases": taste},
    }
    for name, data in payload.items():
        (OUT / name).write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
        )
    print(f"Wrote {len(cases)} recommend, {len(search)} search, {len(taste)} taste fixtures to {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
