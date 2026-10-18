/**
 * Hybrid content index: BM25 sparse vectors + int8 dense embeddings.
 *
 * A port of backend/app/engine/content.py. The Python engine is the reference,
 * and parity.test.ts holds this file to it. Change a constant there, change it
 * here.
 *
 * BM25 is rebuilt from the shipped card text at load (a few tens of ms) rather
 * than shipped precomputed, which would add most of a megabyte to the pack.
 */
import type { Card } from "./types";

const K1 = 1.5;
const B = 0.75;
const W_DENSE = 0.65;
const W_SPARSE = 0.35;
const KNN_WEIGHT = 0.55;
const KNN_K = 3;

const W_TITLE = 3.0;
const W_GENRE = 3.0;
const W_KEYWORD = 3.0;
const W_PEOPLE = 1.5;
const W_OVERVIEW = 1.0;

const STOPWORDS = new Set(
  (
    "the a an and or of to in on for with his her their its is are was were be by as at from " +
    "that this it he she they who what when but not into out up down over after before new one " +
    "two all more most than then him them you your about between while must has have had will"
  ).split(" "),
);

export function tokens(text: string | null | undefined): string[] {
  const found = (text ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return found.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function slug(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function weightedTerms(item: Card): Map<string, number> {
  const tf = new Map<string, number>();
  const add = (term: string, weight: number) => {
    if (term) tf.set(term, (tf.get(term) ?? 0) + weight);
  };
  for (const t of tokens(item.title)) add(t, W_TITLE);
  for (const t of tokens(item.original_title)) add(t, W_TITLE * 0.5);
  for (const g of item.genres) add(`g:${slug(g)}`, W_GENRE);
  for (const kw of item.keywords ?? []) add(`k:${slug(kw)}`, W_KEYWORD);
  for (const person of [item.director, item.studio, ...(item.cast ?? []).slice(0, 3)]) {
    if (person) add(`p:${slug(person)}`, W_PEOPLE);
  }
  for (const t of tokens(item.overview)) add(t, W_OVERVIEW);
  return tf;
}

/** A sparse vector: parallel arrays of term ids and weights, in the order the
 *  Python dict would iterate them. */
export interface Sparse {
  terms: Int32Array;
  weights: Float64Array;
}

function normalize(terms: number[], weights: number[]): Sparse {
  let sq = 0;
  for (const w of weights) sq += w * w;
  const norm = Math.sqrt(sq);
  return {
    terms: Int32Array.from(terms),
    weights: Float64Array.from(norm === 0 ? weights : weights.map((w) => w / norm)),
  };
}

export interface TasteProfile {
  /** Sorted, de-duplicated liked indexes present in the index. */
  liked: number[];
  sparseCentroid: Map<number, number>;
  denseCentroid: Float64Array | null;
  nLiked: number;
}

export class ContentIndex {
  readonly cards: Card[];
  readonly dims: number;
  readonly hasDense: boolean;
  private readonly pos = new Map<string, number>();
  private readonly vocab = new Map<string, number>();
  private readonly sparse: Sparse[] = [];
  private readonly dense: Float32Array;
  readonly termNames: string[] = [];

  constructor(cards: Card[], engine: ArrayBuffer | null, dims: number) {
    this.cards = cards;
    this.dims = engine ? dims : 0;
    cards.forEach((c, i) => this.pos.set(c.id, i));

    // ── BM25 ───────────────────────────────────────────────────────────
    const tfs: Map<string, number>[] = [];
    const lens: number[] = [];
    const df = new Map<string, number>();
    for (const card of cards) {
      const tf = weightedTerms(card);
      tfs.push(tf);
      let len = 0;
      for (const v of tf.values()) len += v;
      lens.push(len);
      for (const term of tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    }
    const n = Math.max(cards.length, 1);
    const idf = new Map<string, number>();
    for (const [term, d] of df) idf.set(term, Math.log(1 + (n - d + 0.5) / (d + 0.5)));
    let total = 0;
    for (const l of lens) total += l;
    const avgdl = (cards.length ? total / n : 1) || 1;

    tfs.forEach((tf, i) => {
      const denomNorm = K1 * (1 - B + (B * lens[i]) / avgdl);
      const terms: number[] = [];
      const weights: number[] = [];
      for (const [term, freq] of tf) {
        const w = idf.get(term) ?? 0;
        if (w <= 0) continue;
        terms.push(this.termId(term));
        weights.push((w * (freq * (K1 + 1))) / (freq + denomNorm));
      }
      this.sparse.push(normalize(terms, weights));
    });

    // ── Dense: dequantise once, to the float32 values Python computes ──
    const count = cards.length;
    this.dense = new Float32Array(count * this.dims);
    if (engine && this.dims) {
      const scales = new Float32Array(engine, 0, count);
      const q = new Int8Array(engine, 4 * count, count * this.dims);
      for (let i = 0; i < count; i++) {
        const s = scales[i];
        const off = i * this.dims;
        for (let d = 0; d < this.dims; d++) this.dense[off + d] = q[off + d] * s;
      }
    }
    this.hasDense = this.dims > 0;
  }

  private termId(term: string): number {
    let id = this.vocab.get(term);
    if (id === undefined) {
      id = this.termNames.length;
      this.vocab.set(term, id);
      this.termNames.push(term);
    }
    return id;
  }

  indexOf(id: string): number | undefined {
    return this.pos.get(id);
  }

  sparseVector(i: number): Sparse {
    return this.sparse[i];
  }

  /** Cosine of two items' sparse vectors (both already L2-normalised). */
  sparseCosine(a: number, b: number): number {
    let va = this.sparse[a];
    let vb = this.sparse[b];
    if (va.terms.length > vb.terms.length) [va, vb] = [vb, va];
    const lookup = new Map<number, number>();
    for (let k = 0; k < vb.terms.length; k++) lookup.set(vb.terms[k], vb.weights[k]);
    let sum = 0;
    for (let k = 0; k < va.terms.length; k++) sum += va.weights[k] * (lookup.get(va.terms[k]) ?? 0);
    return sum;
  }

  denseDot(a: number, b: number): number {
    const d = this.dims;
    const oa = a * d;
    const ob = b * d;
    let sum = 0;
    for (let k = 0; k < d; k++) sum += this.dense[oa + k] * this.dense[ob + k];
    return sum;
  }

  private denseDotVec(a: number, v: Float64Array): number {
    const d = this.dims;
    const oa = a * d;
    let sum = 0;
    for (let k = 0; k < d; k++) sum += this.dense[oa + k] * v[k];
    return sum;
  }

  buildProfile(ids: string[]): TasteProfile {
    // Python keys its cache on the sorted id set, so centroid sums run in that
    // order; match it.
    const sortedIds = Array.from(new Set(ids)).sort();
    const liked = sortedIds.map((id) => this.pos.get(id)).filter((i): i is number => i !== undefined);

    const acc = new Map<number, number>();
    for (const i of liked) {
      const v = this.sparse[i];
      for (let k = 0; k < v.terms.length; k++) acc.set(v.terms[k], (acc.get(v.terms[k]) ?? 0) + v.weights[k]);
    }
    const sparseCentroid = new Map<number, number>();
    if (liked.length) {
      let sq = 0;
      const mean: [number, number][] = [];
      for (const [t, w] of acc) {
        const m = w / liked.length;
        mean.push([t, m]);
        sq += m * m;
      }
      const norm = Math.sqrt(sq);
      for (const [t, m] of mean) sparseCentroid.set(t, norm === 0 ? m : m / norm);
    }

    let denseCentroid: Float64Array | null = null;
    if (this.hasDense && liked.length) {
      const d = this.dims;
      const mean = new Float64Array(d);
      for (const i of liked) for (let k = 0; k < d; k++) mean[k] += this.dense[i * d + k];
      let sq = 0;
      for (let k = 0; k < d; k++) {
        mean[k] = Math.fround(mean[k] / liked.length);
        sq += mean[k] * mean[k];
      }
      const norm = Math.sqrt(sq) || 1;
      for (let k = 0; k < d; k++) mean[k] = Math.fround(mean[k] / norm);
      denseCentroid = mean;
    }

    return { liked, sparseCentroid, denseCentroid, nLiked: liked.length };
  }

  /** Hybrid kNN + centroid relevance for many candidates at once. Batching
   *  lets each liked vector be scattered once instead of once per candidate. */
  relevanceMany(candidates: number[], profile: TasteProfile): Float64Array {
    const out = new Float64Array(candidates.length);
    const { liked, sparseCentroid, denseCentroid } = profile;
    const nl = liked.length;

    // Sparse similarities to each liked item: candidates × liked.
    const sparseSims = new Float64Array(candidates.length * nl);
    if (nl) {
      const scatter = new Float64Array(this.termNames.length);
      liked.forEach((li, j) => {
        const lv = this.sparse[li];
        for (let k = 0; k < lv.terms.length; k++) scatter[lv.terms[k]] = lv.weights[k];
        candidates.forEach((ci, r) => {
          const cv = this.sparse[ci];
          let s = 0;
          for (let k = 0; k < cv.terms.length; k++) s += cv.weights[k] * scatter[cv.terms[k]];
          sparseSims[r * nl + j] = s;
        });
        for (let k = 0; k < lv.terms.length; k++) scatter[lv.terms[k]] = 0;
      });
    }

    const sims: number[] = new Array(nl);
    candidates.forEach((ci, r) => {
      const cv = this.sparse[ci];
      let simCentroid = 0;
      if (sparseCentroid.size) {
        for (let k = 0; k < cv.terms.length; k++) simCentroid += cv.weights[k] * (sparseCentroid.get(cv.terms[k]) ?? 0);
      }
      for (let j = 0; j < nl; j++) sims[j] = sparseSims[r * nl + j];
      const sparse = knnCentroid(simCentroid, sims, nl);

      if (this.hasDense && denseCentroid) {
        const dc = this.denseDotVec(ci, denseCentroid);
        for (let j = 0; j < nl; j++) sims[j] = this.denseDot(ci, liked[j]);
        const dense = knnCentroid(dc, sims, nl);
        out[r] = W_DENSE * dense + W_SPARSE * sparse;
      } else {
        out[r] = sparse;
      }
    });
    return out;
  }
}

function knnCentroid(simCentroid: number, sims: number[], n: number): number {
  let simKnn = 0;
  if (n) {
    const top = sims.slice(0, n).sort((a, b) => b - a).slice(0, KNN_K);
    let denom = 0;
    let num = 0;
    for (const s of top) {
      denom += s;
      num += s * s;
    }
    simKnn = denom > 0 ? num / denom : 0;
  }
  return KNN_WEIGHT * simKnn + (1 - KNN_WEIGHT) * simCentroid;
}
