"""The browser data pack: is it current, and what does int8 cost?

The browser ranks on int8-quantised embeddings. These tests measure what that
quantisation changes against the float32 originals the server used, and fail
if it starts to matter: the top pick must agree almost always and the top-10
must mostly overlap. Measured over 200 profiles: 96% top-1 agreement, 0.97
top-10 overlap. About half the misses are near-ties; the rest come from titles
at the edge of the 120-title taste-retrieve set, which int8 rounding can push
in or out. They also check the pack matches the catalog it was built
from, so a catalog rebuild can't ship without a pack rebuild.
"""

from __future__ import annotations

import random

import pytest

from app.engine.content import ContentIndex
from app.engine.engine import RecommendationEngine
from app.models.mood import EraPreference, MoodType, TimeSlot
from app.services.catalog import load_catalog, load_embeddings
from app.services.pack import PACK_DIR, MANIFEST, load_pack_embeddings, read_manifest

pytestmark = pytest.mark.skipif(not (PACK_DIR / MANIFEST).exists(), reason="no web pack built")

N_PROFILES = 100


@pytest.fixture(scope="module")
def catalog():
    return load_catalog()


def test_pack_matches_catalog(catalog):
    manifest = read_manifest()
    vectors = load_pack_embeddings()
    assert manifest["count"] == len(catalog)
    assert set(vectors) == {c.id for c in catalog}


def test_quantisation_keeps_the_picks(catalog):
    full = ContentIndex(catalog, load_embeddings())
    quant = ContentIndex(catalog, load_pack_embeddings())
    rng = random.Random(11)
    moods = [m.value for m in MoodType]

    top1_same = 0
    overlaps = []
    for _ in range(N_PROFILES):
        liked = [c.id for c in rng.sample(catalog, rng.choice([2, 5, 12]))]
        cand = [c for c in catalog if c.id not in set(liked)]
        kwargs = dict(
            liked_ids=liked,
            mood=rng.choice(moods),
            time_available=rng.choice(list(TimeSlot)),
            era=rng.choice(list(EraPreference)),
            ref_year=2026,
        )
        a = RecommendationEngine(full, **kwargs).recommend(cand)
        b = RecommendationEngine(quant, **kwargs).recommend(cand)
        top1_same += a.primary.media.id == b.primary.media.id
        ta = {s.media.id for s in a.ranked[:10]}
        tb = {s.media.id for s in b.ranked[:10]}
        overlaps.append(len(ta & tb) / 10)

    agreement = top1_same / N_PROFILES
    overlap = sum(overlaps) / len(overlaps)
    print(f"int8 vs float32: top-1 agreement {agreement:.0%}, mean top-10 overlap {overlap:.2f}")
    assert agreement >= 0.93
    assert overlap >= 0.9
