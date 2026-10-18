/**
 * One pick from a request: exclusions, the engine, the templated reason, and
 * the popularity fallback. A port of `_run_pipeline` in
 * backend/app/routers/recommend.py without the LLM steps; the AI curator runs
 * after this, from the browser, against the shortlist (see api/recommend.ts).
 */
import { ContentIndex } from "./content";
import { RecommendationEngine, type EngineResult, type Scored } from "./engine";
import { engineRationale } from "./rationale";
import { tasteDims } from "./taste";
import type { Card } from "./types";
import type { RecommendationRequest, RecommendationResponse } from "../types/recommendation";

export interface PipelineResult {
  response: RecommendationResponse;
  /** The engine's shortlist for the AI curator (empty on the fallback path). */
  shortlist: Scored[];
  ranked: Scored[];
}

export interface PipelineOptions {
  genreBoosts?: Record<string, number> | null;
  refYear?: number;
}

function fillAlternates(primary: Scored, alternates: Scored[], ranked: Scored[]): Scored[] {
  const chosen = new Set([primary.media.id, ...alternates.map((a) => a.media.id)]);
  const result = [...alternates];
  for (const s of ranked) {
    if (result.length >= 2) break;
    if (!chosen.has(s.media.id)) {
      result.push(s);
      chosen.add(s.media.id);
    }
  }
  return result.slice(0, 2);
}

function requestId(): string {
  const c = globalThis.crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function popularityFallback(candidates: Card[]): PipelineResult | null {
  if (!candidates.length) return null;
  const ranked = candidates
    .map((m, i) => ({ m, i }))
    .sort((a, b) => b.m.popularity_norm - a.m.popularity_norm || a.i - b.i)
    .map((e) => e.m);
  const wrap = (m: Card): Scored => ({
    media: m,
    score: 0.5,
    score_breakdown: { relevance: 0, mood: 0, runtime: 0, quality: 0, recency: 0.5 },
  });
  return {
    response: {
      primary: wrap(ranked[0]),
      alternates: ranked.slice(1, 3).map(wrap),
      rationale: "A crowd favourite to get you started.",
      picked_by: "engine",
      provider: null,
      ai_status: "off",
      media_type_applied: true,
      confidence: "moderate",
      request_id: requestId(),
    },
    shortlist: [],
    ranked: [],
  };
}

export function buildEngine(
  index: ContentIndex,
  moodTargets: Record<string, number[]>,
  body: RecommendationRequest,
  opts: PipelineOptions = {},
): { engine: RecommendationEngine; candidates: Card[]; likedGenres: Set<string> } {
  const cards = index.cards;
  const excluded = new Set([...body.excluded_ids, ...body.favourite_ids]);
  const candidates = cards.filter((c) => !excluded.has(c.id));
  const likedItems = body.favourite_ids
    .map((id) => index.indexOf(id))
    .filter((i): i is number => i !== undefined)
    .map((i) => cards[i]);
  const engine = new RecommendationEngine(index, {
    likedIds: [...body.favourite_ids],
    mood: body.mood,
    timeAvailable: body.time_available,
    mediaType: body.media_type,
    era: body.era ?? "any",
    timeOfDay: body.time_of_day,
    taste: tasteDims(likedItems),
    genreBoosts: opts.genreBoosts,
    tuning: body.tuning ?? null,
    refYear: opts.refYear,
    moodTargets,
  });
  return { engine, candidates, likedGenres: new Set(likedItems.flatMap((m) => m.genres)) };
}

export function runPipeline(
  index: ContentIndex,
  moodTargets: Record<string, number[]>,
  body: RecommendationRequest,
  opts: PipelineOptions = {},
): PipelineResult {
  const { engine, candidates, likedGenres } = buildEngine(index, moodTargets, body, opts);
  const result: EngineResult | null = engine.recommend(candidates, 8);
  if (result === null) {
    const fallback = popularityFallback(candidates.length ? candidates : index.cards);
    if (fallback === null) throw new Error("No candidates available.");
    return fallback;
  }

  const primary = result.primary;
  const alternates = fillAlternates(primary, [...result.alternates], result.ranked);
  const rationale = engineRationale(primary, body.mood, likedGenres);
  if (primary.rationale == null) primary.rationale = rationale;

  return {
    response: {
      primary,
      alternates,
      rationale,
      picked_by: "engine",
      provider: null,
      ai_status: "off",
      media_type_applied: result.media_type_applied,
      confidence: result.confidence,
      request_id: requestId(),
    },
    shortlist: result.shortlist,
    ranked: result.ranked,
  };
}
