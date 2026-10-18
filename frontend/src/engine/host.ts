/**
 * The engine's home: builds the index once from the pack and answers ranking
 * requests. Runs inside the Web Worker (worker.ts), or inline on the main
 * thread where workers aren't available (tests, very old browsers).
 */
import { ContentIndex } from "./content";
import { fetchCatalog, fetchEngineBin, fetchManifest, type Catalog } from "./pack";
import { buildEngine, runPipeline, type PipelineOptions, type PipelineResult } from "./pipeline";
import type { Scored } from "./engine";
import type { RecommendationRequest, ScoredMediaItem } from "../types/recommendation";

export interface Ready {
  index: ContentIndex;
  moodTargets: Record<string, number[]>;
}

let ready: Promise<Ready> | null = null;

export function buildReady(catalog: Catalog, engineBin: ArrayBuffer | null): Ready {
  return {
    index: new ContentIndex(catalog.cards, engineBin, catalog.manifest.dims),
    moodTargets: catalog.shelves.mood_targets,
  };
}

export function getReady(): Promise<Ready> {
  if (!ready) {
    ready = (async () => {
      const manifest = await fetchManifest();
      const [catalog, bin] = await Promise.all([fetchCatalog(manifest), fetchEngineBin(manifest)]);
      return buildReady(catalog, bin);
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/** Test seam. */
export function setReadyForTests(r: Ready | null): void {
  ready = r ? Promise.resolve(r) : null;
}

export type EngineRequest =
  | { op: "warm" }
  | { op: "recommend"; body: RecommendationRequest; opts?: PipelineOptions }
  | { op: "explain"; body: RecommendationRequest; targetId: string };

export interface ExplainResult {
  scored: Scored;
  rank: number | null;
  retrieved: boolean;
  total: number;
  pick: ScoredMediaItem | null;
}

export async function handle(req: EngineRequest): Promise<PipelineResult | ExplainResult | null> {
  const { index, moodTargets } = await getReady();
  switch (req.op) {
    case "warm":
      return null;
    case "recommend":
      return runPipeline(index, moodTargets, req.body, req.opts);
    case "explain": {
      const i = index.indexOf(req.targetId);
      if (i === undefined) throw new Error("That title isn't in the catalog.");
      const pick = runPipeline(index, moodTargets, req.body).response.primary;
      const { engine, candidates } = buildEngine(index, moodTargets, {
        ...req.body,
        // Let the asked-about title compete even if it's been seen or excluded.
        excluded_ids: req.body.excluded_ids.filter((id) => id !== req.targetId),
      });
      return { ...engine.explain(candidates, index.cards[i]), pick };
    }
  }
}
