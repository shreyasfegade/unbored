/**
 * The recommendation engine. A port of backend/app/engine/engine.py, constant
 * for constant; see that file for the reasoning behind each signal. The
 * Python engine stays the reference and parity.test.ts checks this against it.
 *
 * Five signals (taste relevance, mood fit, runtime, quality, recency) blend
 * into one score; the visible picks are then MMR-diversified and a confidence
 * level is read off the top pick's absolute taste relevance.
 */
import { ContentIndex } from "./content";
import { pyRound } from "./pyround";
import { moodFitToTarget, moodTarget, type TasteDims } from "./tone";
import type { Card } from "./types";
import type { ConfidenceLevel } from "../types/mood";
import type { EraPreference, ScoreBreakdown, TuningWeights } from "../types/recommendation";
import type { TimeSlot } from "../types/mood";

type W5 = [number, number, number, number, number];

const RUNTIME_SHAPE: Record<TimeSlot, [number, number]> = {
  short: [28.0, 38.0],
  medium: [75.0, 55.0],
  long: [135.0, 95.0],
};

const W_REL = 0.44;
const W_MOOD = 0.2;
const W_RUNTIME = 0.12;
const W_QUALITY = 0.1;
const W_RECENCY = 0.14;

const RETRIEVE_N = 120;
const W_RERANK: W5 = [0.2, 0.4, 0.13, 0.09, 0.18];

const TUNE_K_POP = 0.22;
const TUNE_K_FRESH = 0.2;

const ERA_HALFLIFE: Record<EraPreference, number | null> = { any: 45.0, modern: 11.0, classic: null };
const ERA_RECENCY_BOOST: Record<EraPreference, number> = { any: 1.0, modern: 2.2, classic: 2.2 };

export interface Scored {
  media: Card;
  score: number;
  score_breakdown: ScoreBreakdown;
  rationale?: string | null;
}

export interface EngineResult {
  ranked: Scored[];
  shortlist: Scored[];
  primary: Scored;
  alternates: Scored[];
  confidence: ConfidenceLevel;
  media_type_applied: boolean;
}

const isAnime = (c: Card) => c.media_type === "anime" || c.source === "anilist";

export function runtimeFit(c: Card, slot: TimeSlot): number {
  const [center, tol] = RUNTIME_SHAPE[slot];
  let rt: number | null = c.runtime_minutes || null;
  if (!rt) rt = isAnime(c) ? 24 : c.media_type === "tv" ? 45 : null;
  if (!rt) return 0.5;
  const z = (rt - center) / tol;
  let fit = Math.max(0.04, Math.exp(-0.7 * z * z));
  if (slot === "short" && (c.episode_count ?? 0) > 50) fit *= 0.9;
  return fit;
}

export function recencyFit(c: Card, era: EraPreference, refYear: number): number {
  const year = c.release_year || c.year;
  if (!year) return 0.5;
  const age = Math.max(0, refYear - year);
  if (era === "classic") return Math.max(0, Math.min(1, 0.35 + age / 45.0));
  const half = ERA_HALFLIFE[era] || (ERA_HALFLIFE.any as number);
  return Math.max(0, Math.min(1, 0.5 ** (age / half)));
}

export interface EngineOptions {
  likedIds: string[];
  mood: string | null;
  timeAvailable: TimeSlot;
  mediaType?: string | null;
  era?: EraPreference;
  timeOfDay?: string | null;
  taste?: TasteDims | null;
  genreBoosts?: Record<string, number> | null;
  tuning?: Partial<TuningWeights> | null;
  refYear?: number;
  moodTargets: Record<string, number[]>;
}

export class RecommendationEngine {
  private readonly index: ContentIndex;
  private readonly slot: TimeSlot;
  private readonly mediaType: string | null;
  private readonly era: EraPreference;
  private readonly profile;
  private readonly nLiked: number;
  private readonly target: number[] | null;
  private readonly genreBoosts: Map<string, number>;
  private readonly adv: number;
  private readonly obscurity: number;
  private readonly acclaim: number;
  private readonly freshness: number;
  private readonly refYear: number;
  private mediaTypeApplied = true;
  private relCache = new Map<number, number>();

  constructor(index: ContentIndex, o: EngineOptions) {
    this.index = index;
    this.slot = o.timeAvailable;
    this.mediaType = o.mediaType && ["movie", "tv", "anime"].includes(o.mediaType) ? o.mediaType : null;
    this.era = o.era ?? "any";
    this.profile = index.buildProfile(o.likedIds);
    this.nLiked = this.profile.nLiked;
    this.target = moodTarget(o.moodTargets, o.mood, o.taste, o.timeOfDay);
    this.genreBoosts = new Map(
      Object.entries(o.genreBoosts ?? {}).map(([g, w]) => [g.toLowerCase().trim(), Number(w)]),
    );
    const t = o.tuning ?? {};
    this.adv = Number(t.adventurous ?? 0);
    this.obscurity = Number(t.obscurity ?? 0);
    this.acclaim = Number(t.acclaim ?? 0);
    this.freshness = Number(t.freshness ?? 0);
    this.refYear = o.refYear ?? new Date().getUTCFullYear();
  }

  private genreBonus(c: Card): number {
    if (!this.genreBoosts.size) return 0;
    const hits = c.genres.map((g) => this.genreBoosts.get(g.toLowerCase().trim()) ?? 0);
    return hits.length ? Math.max(...hits) : 0;
  }

  private tuneWeights(w: W5): W5 {
    const [rel0, mood, rt, q0, rec0] = w;
    const rel = rel0 * (1 - 0.5 * this.adv);
    const q = q0 * (1 + this.acclaim);
    const rec = rec0 * (1 + 0.8 * Math.abs(this.freshness));
    const total = rel + mood + rt + q + rec;
    if (total <= 0) return w;
    return [rel / total, mood / total, rt / total, q / total, rec / total];
  }

  private retrieveN(): number {
    return Math.max(40, Math.min(260, RETRIEVE_N + Math.trunc(80 * this.adv)));
  }

  lam(): number {
    return Math.max(0.45, Math.min(0.92, 0.72 - 0.25 * this.adv));
  }

  private tuneBonus(c: Card, recency: number): number {
    const pop = TUNE_K_POP * -this.obscurity * (c.popularity_norm - 0.5);
    const fresh = TUNE_K_FRESH * this.freshness * (recency - 0.5);
    return pop + fresh;
  }

  private weights(): W5 {
    let base: W5;
    if (this.nLiked >= 2) {
      base = [W_REL, W_MOOD, W_RUNTIME, W_QUALITY, W_RECENCY];
    } else {
      const scale = this.nLiked / 2.0;
      const rel = W_REL * scale;
      const freed = W_REL - rel;
      base = [rel, W_MOOD + freed * 0.4, W_RUNTIME, W_QUALITY + freed * 0.3, W_RECENCY + freed * 0.3];
    }
    return this.applyEraBoost(this.tuneWeights(base));
  }

  private applyEraBoost(w: W5): W5 {
    const boost = ERA_RECENCY_BOOST[this.era] ?? 1.0;
    if (boost === 1.0) return w;
    let [rel, mood, rt, q] = w;
    const rec = w[4];
    const newRec = rec * boost;
    const others = rel + mood + rt + q;
    const extra = newRec - rec;
    if (others > 0) {
      const factor = Math.max(0, (others - extra) / others);
      rel *= factor;
      mood *= factor;
      rt *= factor;
      q *= factor;
    }
    return [rel, mood, rt, q, newRec];
  }

  /** Absolute taste relevance for many cards, memoised per engine. */
  private relevance(cards: Card[]): number[] {
    const idx = cards.map((c) => this.index.indexOf(c.id) ?? -1);
    const missing = Array.from(new Set(idx.filter((i) => i >= 0 && !this.relCache.has(i))));
    if (missing.length) {
      const vals = this.index.relevanceMany(missing, this.profile);
      missing.forEach((i, k) => this.relCache.set(i, vals[k]));
    }
    return idx.map((i) => (i >= 0 ? (this.relCache.get(i) as number) : 0));
  }

  /** Score one card with the given weights. Shared by rank() and explain(). */
  private score(c: Card, rel: number, w: W5): Scored {
    const [wRel, wMood, wRt, wQ, wRec] = w;
    const mood = moodFitToTarget(c, this.target);
    const runtime = runtimeFit(c, this.slot);
    const quality = c.quality;
    const recency = recencyFit(c, this.era, this.refYear);
    const final =
      wRel * rel + wMood * mood + wRt * runtime + wQ * quality + wRec * recency +
      0.12 * this.genreBonus(c) + this.tuneBonus(c, recency);
    return {
      media: c,
      score: pyRound(Math.max(0, Math.min(1, final)), 4),
      score_breakdown: {
        relevance: pyRound(rel, 4),
        mood: pyRound(mood, 4),
        runtime: pyRound(runtime, 4),
        quality: pyRound(quality, 4),
        recency: pyRound(recency, 4),
      },
    };
  }

  private filterPool(candidates: Card[]): Card[] {
    if (!this.mediaType) return candidates;
    const filtered = candidates.filter((c) => c.media_type === this.mediaType);
    if (filtered.length) return filtered;
    this.mediaTypeApplied = false;
    return candidates;
  }

  rank(candidates: Card[]): Scored[] {
    const pool = this.filterPool(candidates);
    const rawList = this.relevance(pool);
    const raw = new Map<string, number>();
    pool.forEach((c, i) => raw.set(c.id, rawList[i]));
    const maxAll = rawList.length ? Math.max(...rawList) : 0;
    const hasTaste = this.nLiked > 0 && Math.max(maxAll, 0) > 0;

    let retrieve: Card[];
    let w: W5;
    if (hasTaste) {
      retrieve = stableSortDesc(pool, (c) => [raw.get(c.id) as number]).slice(0, this.retrieveN());
      if (this.genreBoosts.size) {
        const have = new Set(retrieve.map((c) => c.id));
        let extra = pool.filter((c) => !have.has(c.id) && this.genreBonus(c) > 0);
        extra = stableSortDesc(extra, (c) => [this.genreBonus(c), c.vote_average, c.vote_count]);
        retrieve = retrieve.concat(extra.slice(0, Math.floor(RETRIEVE_N / 2)));
      }
      w = this.applyEraBoost(this.tuneWeights(W_RERANK));
    } else {
      retrieve = pool;
      w = this.weights();
    }

    let maxRel = 0;
    for (const c of retrieve) maxRel = Math.max(maxRel, raw.get(c.id) as number);

    const scored = retrieve.map((c) => {
      const r = raw.get(c.id) as number;
      return this.score(c, maxRel > 0 ? r / maxRel : 0, w);
    });
    return stableSortDesc(scored, (s) => [s.score, s.media.vote_count, s.media.popularity_norm]);
  }

  private mmrSelect(scored: Scored[], n: number, lam: number): Scored[] {
    if (!scored.length) return [];
    const selected = [scored[0]];
    const pool = scored.slice(1, 41);
    while (selected.length < n && pool.length) {
      let best = -1;
      let bestVal = -1e9;
      pool.forEach((cand, k) => {
        const ci = this.index.indexOf(cand.media.id) as number;
        let maxSim = 0;
        selected.forEach((s, j) => {
          const sim = this.index.sparseCosine(ci, this.index.indexOf(s.media.id) as number);
          maxSim = j === 0 ? sim : Math.max(maxSim, sim);
        });
        const val = lam * cand.score - (1 - lam) * maxSim;
        if (val > bestVal) {
          best = k;
          bestVal = val;
        }
      });
      selected.push(pool[best]);
      pool.splice(best, 1);
    }
    return selected;
  }

  private confidence(scored: Scored[], primary: Scored): ConfidenceLevel {
    const sample = scored.slice(0, 60).map((s) => s.score);
    if (sample.length < 4) return "moderate";
    const mean = sample.reduce((a, b) => a + b, 0) / sample.length;
    const variance = sample.reduce((a, x) => a + (x - mean) ** 2, 0) / sample.length;
    const std = Math.sqrt(variance) || 1e-6;
    const z = (primary.score - mean) / std;
    const absRel = this.relevance([primary.media])[0];
    if (absRel >= 0.45 && z >= 1.0) return "high";
    if (absRel >= 0.42 && z >= 0.6) return "strong";
    return "moderate";
  }

  recommend(candidates: Card[], shortlistSize = 8): EngineResult | null {
    const ranked = this.rank(candidates);
    if (!ranked.length) return null;
    const picks = this.mmrSelect(ranked, 3, this.lam());
    const primary = picks[0];
    const alternates = picks.slice(1, 3);
    while (alternates.length < 2 && ranked.length > alternates.length + 1) {
      alternates.push(ranked[alternates.length + 1]);
    }
    return {
      ranked,
      shortlist: ranked.slice(0, shortlistSize),
      primary,
      alternates: alternates.slice(0, 2),
      confidence: this.confidence(ranked, primary),
      media_type_applied: this.mediaTypeApplied,
    };
  }

  /**
   * "Why not X?": score one title under this exact request, with the weights
   * the ranking used, and say where it would have landed. Titles outside the
   * retrieve set are scored as if they'd been let in, so the breakdown is
   * still honest about why they missed.
   */
  explain(candidates: Card[], card: Card): { scored: Scored; rank: number | null; retrieved: boolean; total: number } {
    const ranked = this.rank(candidates);
    const pos = ranked.findIndex((s) => s.media.id === card.id);
    if (pos >= 0) return { scored: ranked[pos], rank: pos + 1, retrieved: true, total: ranked.length };

    const pool = this.filterPool(candidates);
    const rels = this.relevance(pool.concat([card]));
    const own = rels[rels.length - 1];
    const hasTaste = this.nLiked > 0 && Math.max(...rels) > 0;
    const w = hasTaste ? this.applyEraBoost(this.tuneWeights(W_RERANK)) : this.weights();
    const inRanked = ranked.map((s) => this.relevance([s.media])[0]);
    const maxRel = Math.max(own, ...inRanked, 0);
    const scored = this.score(card, maxRel > 0 ? own / maxRel : 0, w);
    const wouldBe = ranked.findIndex((s) => s.score < scored.score);
    return { scored, rank: wouldBe >= 0 ? wouldBe + 1 : ranked.length + 1, retrieved: false, total: ranked.length };
  }
}

/** Python's `sorted(..., key=k, reverse=True)`: descending on a tuple key,
 *  stable for equal keys. */
export function stableSortDesc<T>(items: T[], key: (x: T) => number[]): T[] {
  const keyed = items.map((x, i) => ({ x, i, k: key(x) }));
  keyed.sort((a, b) => {
    for (let j = 0; j < a.k.length; j++) {
      if (a.k[j] !== b.k[j]) return b.k[j] - a.k[j];
    }
    return a.i - b.i;
  });
  return keyed.map((e) => e.x);
}
