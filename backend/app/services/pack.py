"""The browser data pack: the catalog and its embeddings as the web app ships them.

`scripts/build_web_pack.py` writes the pack into `frontend/public/data/`. The
browser engine (frontend/src/engine) runs on it, so the Python engine can load
the *same* int8-quantised vectors here and act as the reference that the
TypeScript port is checked against (scripts/export_parity_fixtures.py).

Layout of `engine.<hash>.bin`, for N items of D dims in `cards` order:

    N float32 scales (little-endian), then N*D int8 values

and a vector is `int8 * scale`. Per-vector scales keep the error proportional
to each vector's own range.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

PACK_DIR = Path(__file__).resolve().parents[3] / "frontend" / "public" / "data"
MANIFEST = "manifest.json"


def quantize(matrix: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-row symmetric int8 quantisation. Returns (scales float32, q int8)."""
    matrix = np.asarray(matrix, dtype=np.float32)
    peak = np.abs(matrix).max(axis=1)
    scales = np.where(peak > 0, peak / 127.0, 1.0).astype(np.float32)
    q = np.clip(np.rint(matrix / scales[:, None]), -127, 127).astype(np.int8)
    return scales, q


def dequantize(scales: np.ndarray, q: np.ndarray) -> np.ndarray:
    return q.astype(np.float32) * scales[:, None].astype(np.float32)


def read_manifest(pack_dir: Path = PACK_DIR) -> dict:
    return json.loads((pack_dir / MANIFEST).read_text(encoding="utf-8"))


@lru_cache(maxsize=2)
def load_pack_embeddings(pack_dir: Path = PACK_DIR) -> dict[str, list[float]]:
    """id -> dequantised vector, exactly as the browser sees it. Empty when no
    pack has been built."""
    if not (pack_dir / MANIFEST).exists():
        return {}
    manifest = read_manifest(pack_dir)
    cards = json.loads((pack_dir / manifest["files"]["cards"]).read_text(encoding="utf-8"))
    ids = [c["id"] for c in cards["items"]]
    n, dims = manifest["count"], manifest["dims"]
    raw = (pack_dir / manifest["files"]["engine"]).read_bytes()
    scales = np.frombuffer(raw, dtype="<f4", count=n)
    q = np.frombuffer(raw, dtype=np.int8, offset=4 * n, count=n * dims).reshape(n, dims)
    vecs = dequantize(scales, q)
    return {ids[i]: vecs[i] for i in range(n)}
