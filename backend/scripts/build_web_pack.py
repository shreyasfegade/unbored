"""Build the browser data pack from the catalog (build-time only).

The web app runs the recommender in the browser, so everything it needs ships
as static files in `frontend/public/data/`:

    manifest.json          names the current files, count, dims, build date
    cards.<hash>.json      every title: display fields + what the engine reads,
                           plus the precomputed tone vector and quality prior
    engine.<hash>.bin      int8-quantised dense embeddings (see app/services/pack.py)
    shelves.<hash>.json    browse rows as id lists, the onboarding shortlist,
                           and the mood targets

Everything that doesn't depend on a request is computed here once, in Python,
so the TypeScript engine only does per-request math and can't drift on it.
Files are content-hashed so the service worker can cache them forever; only
`manifest.json` is fetched fresh.

    cd backend && python scripts/build_web_pack.py [--dims 128] [--budget-mb 3]

`--dims` projects the embeddings onto their top principal components before
quantising (for a larger catalog). Only adopt it when the quantisation-loss
test in tests/test_web_pack.py still passes.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.engine.engine import quality_prior  # noqa: E402
from app.engine.tone import _mood_targets, tone_vector  # noqa: E402
from app.routers.search import curated_shortlist  # noqa: E402
from app.services.catalog import catalog_metadata, load_catalog, load_embeddings  # noqa: E402
from app.services.pack import MANIFEST, PACK_DIR, quantize  # noqa: E402
from app.services.shelves import build_shelves  # noqa: E402

PACK_VERSION = 1

# Fields the browser needs. `year` folds into release_year (the engine and UI
# only ever read `release_year or year`); raw popularity, status, release_date
# and source_api are never read client-side.
_FIELDS = (
    "id", "source", "tmdb_id", "anilist_id", "imdb_id", "title", "original_title",
    "overview", "poster_path", "backdrop_path", "genres", "keywords", "vote_average",
    "vote_count", "runtime_minutes", "release_year", "media_type", "popularity_norm",
    "franchise", "cast", "director", "studio", "episode_count",
    # Optional enrichments; only written when the catalog carries them.
    "added_at", "watch", "trailer",
)


def _card(item) -> dict:
    raw = item.model_dump(mode="json")
    raw["release_year"] = item.release_year or item.year
    card = {k: raw.get(k) for k in _FIELDS if raw.get(k) is not None}
    card["tone"] = tone_vector(item)
    card["quality"] = quality_prior(item)
    return card


def _pca(matrix: np.ndarray, dims: int) -> np.ndarray:
    centred = matrix - matrix.mean(axis=0, keepdims=True)
    _, _, vt = np.linalg.svd(centred, full_matrices=False)
    projected = matrix @ vt[:dims].T
    norms = np.linalg.norm(projected, axis=1, keepdims=True)
    return projected / np.where(norms > 0, norms, 1.0)


def _write_hashed(out: Path, stem: str, ext: str, data: bytes) -> str:
    digest = hashlib.sha256(data).hexdigest()[:12]
    name = f"{stem}.{digest}.{ext}"
    (out / name).write_bytes(data)
    return name


def _json_bytes(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def build(out: Path = PACK_DIR, dims: int | None = None, budget_mb: float = 3.0) -> dict:
    catalog = load_catalog()
    embeddings = load_embeddings()
    if not catalog:
        raise SystemExit("ERROR: empty catalog — run scripts/build_catalog.py first.")
    meta = catalog_metadata()

    cards = [_card(m) for m in catalog]
    ids = [c["id"] for c in cards]

    # Dense matrix in cards order. A title without an embedding gets a zero
    # vector, which the engine treats as "no dense signal" (same as Python).
    full_dims = len(next(iter(embeddings.values()))) if embeddings else 0
    matrix = np.zeros((len(ids), full_dims), dtype=np.float32)
    has_vec = np.zeros(len(ids), dtype=bool)
    for i, item_id in enumerate(ids):
        vec = embeddings.get(item_id)
        if vec is not None:
            matrix[i] = vec
            has_vec[i] = True
    if dims and full_dims and dims < full_dims:
        matrix[has_vec] = _pca(matrix[has_vec], dims)
        matrix = matrix[:, :dims]
    scales, q = quantize(matrix)
    scales[~has_vec] = 0.0
    engine_bin = scales.astype("<f4").tobytes() + q.tobytes()

    shelves = [
        {"key": s["key"], "title": s["title"], "ids": [m.id for m in s["items"]]}
        for s in build_shelves()
    ]
    shelves_doc = {
        "shelves": shelves,
        "shortlist": [m.id for m in curated_shortlist(catalog)],
        "mood_targets": _mood_targets(),
    }
    cards_doc = {"attribution": meta.get("attribution"), "items": cards}

    out.mkdir(parents=True, exist_ok=True)
    for old in list(out.glob("cards.*.json")) + list(out.glob("engine.*.bin")) + list(out.glob("shelves.*.json")):
        old.unlink()

    payloads = {
        "cards": ("cards", "json", _json_bytes(cards_doc)),
        "engine": ("engine", "bin", engine_bin),
        "shelves": ("shelves", "json", _json_bytes(shelves_doc)),
    }
    files: dict[str, str] = {}
    sizes: dict[str, dict[str, int]] = {}
    for key, (stem, ext, data) in payloads.items():
        files[key] = _write_hashed(out, stem, ext, data)
        sizes[key] = {"raw": len(data), "gzip": len(gzip.compress(data, 9))}

    manifest = {
        "version": PACK_VERSION,
        "generated_at": meta.get("generated_at"),
        "count": len(ids),
        "dims": int(matrix.shape[1]),
        "files": files,
        "bytes": sizes,
    }
    (out / MANIFEST).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    total_gz = sum(s["gzip"] for s in sizes.values())
    for key, s in sizes.items():
        print(f"  {files[key]:<32} {s['raw'] / 1024:8.0f} KB raw  {s['gzip'] / 1024:8.0f} KB gzip")
    print(f"Pack: {len(ids)} titles, {manifest['dims']} dims, {total_gz / 1024:.0f} KB gzip total")
    if total_gz > budget_mb * 1024 * 1024:
        raise SystemExit(f"ERROR: pack is {total_gz / 1048576:.2f} MB gzip, over the {budget_mb} MB budget.")
    return manifest


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dims", type=int, default=None, help="PCA-reduce embeddings to this many dims")
    ap.add_argument("--budget-mb", type=float, default=3.0, help="fail if the gzip total exceeds this")
    ap.add_argument("--out", type=Path, default=PACK_DIR)
    args = ap.parse_args()
    build(args.out, args.dims, args.budget_mb)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
