"""Precompute semantic embeddings for the catalog (offline, build-time only).

The running app does NOT depend on fastembed — it loads these precomputed
vectors and does pure-Python cosine math. This is what lets the engine match on
*meaning* ("a film about grief" ~ "a story of loss"), not just shared words.

    cd backend && python scripts/build_embeddings.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "app" / "data" / "catalog.json"
OUT = ROOT / "app" / "data" / "catalog_embeddings.json"
MODEL = "BAAI/bge-small-en-v1.5"


def _doc(item: dict) -> str:
    parts = [
        item.get("title", ""),
        " ".join(item.get("genres", [])),
        " ".join(kw.replace("-", " ") for kw in item.get("keywords", [])),
        item.get("overview", ""),
    ]
    return " — ".join(p for p in parts if p).strip()


def main() -> int:
    from fastembed import TextEmbedding  # build-time only

    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    items = data["items"]
    ids = [it["id"] for it in items]
    docs = [_doc(it) for it in items]

    print(f"Embedding {len(docs)} catalog docs with {MODEL}...")
    started = time.time()
    model = TextEmbedding(MODEL)
    vectors = {}
    for i, vec in enumerate(model.embed(docs, batch_size=64)):
        # L2-normalize now so runtime similarity is a plain dot product.
        v = vec.tolist()
        norm = sum(x * x for x in v) ** 0.5 or 1.0
        vectors[ids[i]] = [round(x / norm, 5) for x in v]
        if i % 200 == 0:
            print(f"  {i}/{len(docs)}", end="\r")

    payload = {"model": MODEL, "dim": len(next(iter(vectors.values()))), "vectors": vectors}
    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    size_mb = OUT.stat().st_size / 1_048_576
    print(f"\nWrote {len(vectors)} embeddings to {OUT.name} [{size_mb:.1f} MB] in {time.time()-started:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
