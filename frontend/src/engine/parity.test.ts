/**
 * Parity with the Python reference engine.
 *
 * backend/scripts/export_parity_fixtures.py runs the Python engine on a few
 * hundred seeded requests over the same int8 pack the browser ships, and this
 * replays each one through the TypeScript port. Picks must match exactly;
 * scores to 1e-4 (float32 dot products differ in the last bits between numpy
 * and JS). Ranking order may only differ between titles whose rounded scores
 * tie.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ContentIndex } from "./content";
import { runPipeline, buildEngine } from "./pipeline";
import { searchCatalog } from "./search";
import { summariseTaste } from "./taste";
import type { CardsDoc, PackManifest, ShelvesDoc } from "./types";
import type { RecommendationRequest } from "../types/recommendation";

const DATA = resolve(__dirname, "../../public/data");
const FIX = resolve(__dirname, "__fixtures__");

const manifest = JSON.parse(readFileSync(resolve(DATA, "manifest.json"), "utf8")) as PackManifest;
const cards = (JSON.parse(readFileSync(resolve(DATA, manifest.files.cards), "utf8")) as CardsDoc).items;
const shelves = JSON.parse(readFileSync(resolve(DATA, manifest.files.shelves), "utf8")) as ShelvesDoc;
const bin = readFileSync(resolve(DATA, manifest.files.engine));
const engineBuf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
const index = new ContentIndex(cards, engineBuf, manifest.dims);

const fixture = <T>(name: string): T => JSON.parse(readFileSync(resolve(FIX, name), "utf8")) as T;

type Row = [string, number, number, number, number, number, number];
interface Case {
  request: RecommendationRequest;
  response: { primary: Row; alternates: string[]; rationale: string; confidence: string; media_type_applied: boolean };
  top: Row[];
}
const parity = fixture<{ ref_year: number; cases: Case[] }>("parity.json");

const TOL = 1e-4;

describe("pack", () => {
  it("names files that exist", () => {
    const present = new Set(readdirSync(DATA));
    for (const f of Object.values(manifest.files)) expect(present.has(f)).toBe(true);
    expect(cards.length).toBe(manifest.count);
  });
});

describe("BM25 parity", () => {
  const { items } = fixture<{ items: { id: string; nnz: number; sum: number; top: [string, number][] }[] }>("bm25.json");
  it.each(items.map((i) => [i.id, i]))("%s", (_id, want) => {
    const v = index.sparseVector(index.indexOf(want.id) as number);
    expect(v.terms.length).toBe(want.nnz);
    expect(v.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(want.sum, 7);
    const top = Array.from(v.terms, (t, k) => [index.termNames[t], v.weights[k]] as [string, number])
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 5);
    expect(top.map((t) => t[0])).toEqual(want.top.map((t) => t[0]));
  });
});

describe("recommend parity", () => {
  it.each(parity.cases.map((c, i) => [i, c] as const))("case %i", (_i, c) => {
    const got = runPipeline(index, shelves.mood_targets, c.request, { refYear: parity.ref_year });
    const r = got.response;
    expect(r.primary.media.id).toBe(c.response.primary[0]);
    expect(r.primary.score).toBeCloseTo(c.response.primary[1], 3);
    expect(r.alternates.map((a) => a.media.id)).toEqual(c.response.alternates);
    expect(r.confidence).toBe(c.response.confidence);
    expect(r.media_type_applied).toBe(c.response.media_type_applied);
    expect(r.rationale).toBe(c.response.rationale);

    const { engine, candidates } = buildEngine(index, shelves.mood_targets, c.request, { refYear: parity.ref_year });
    const ranked = engine.rank(candidates).slice(0, c.top.length);
    const scoreOf = new Map(c.top.map((row) => [row[0], row]));
    ranked.forEach((s, k) => {
      const want = c.top[k];
      if (s.media.id !== want[0]) {
        // Only acceptable as a tie on the rounded score.
        expect(Math.abs(s.score - want[1])).toBeLessThanOrEqual(TOL);
      }
      const row = scoreOf.get(s.media.id);
      if (!row) return;
      const b = s.score_breakdown;
      const gotRow = [s.score, b.relevance, b.mood, b.runtime, b.quality, b.recency];
      gotRow.forEach((v, j) => expect(Math.abs(v - (row[j + 1] as number))).toBeLessThanOrEqual(TOL + 1e-12));
    });
  });
});

describe("search parity", () => {
  const { cases } = fixture<{ cases: { q: string; type: string | null; ids: string[]; total: number }[] }>("search.json");
  it.each(cases.map((c) => [`${c.q} (${c.type ?? "all"})`, c]))("%s", (_l, c) => {
    const got = searchCatalog(cards, c.q, c.type);
    expect(got.results.map((m) => m.id)).toEqual(c.ids);
    expect(got.total).toBe(c.total);
  });
});

describe("taste profile parity", () => {
  const { cases } = fixture<{ cases: { ids: string[]; profile: unknown }[] }>("taste.json");
  it.each(cases.map((c, i) => [i, c] as const))("case %i", (_i, c) => {
    const byId = new Map(cards.map((m) => [m.id, m]));
    const items = c.ids.map((id) => byId.get(id)).filter((m) => m !== undefined);
    expect(summariseTaste(items, c.ids.length)).toEqual(c.profile);
  });
});
