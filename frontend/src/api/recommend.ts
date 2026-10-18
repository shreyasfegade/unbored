import { engine } from '../engine/client';
import type { Scored } from '../engine/engine';
import type { PipelineResult } from '../engine/pipeline';
import { useAiTierStore } from '../stores/aiTierStore';
import { useLlmStore } from '../stores/llmStore';
import type { AIStatus, AITier, RecommendationRequest, RecommendationResponse, ScoredMediaItem } from '../types/recommendation';
import { apiError, request, toApiError } from './client';

/** What /api/ai/curate answers (see api/_lib/ai.ts). */
interface CurateReply {
  ai_status: AIStatus;
  tier: AITier | null;
  provider?: string;
  remaining?: number | null;
  curated?: {
    primary_index: number;
    alternate_indices: number[];
    why: string;
    why_by_index: Record<string, string>;
  };
}

// Slightly longer than the function's own provider timeout, so the function's
// honest "timeout" answer arrives before this gives up.
const CURATE_TIMEOUT_MS = 7000;
const EXPAND_TIMEOUT_MS = 4500;

function aiHeaders(): Record<string, string> | null {
  const { provider, apiKey, validated } = useLlmStore.getState();
  return provider && apiKey && validated ? { 'X-LLM-Provider': provider, 'X-LLM-Key': apiKey } : null;
}

async function expandGenres(req: RecommendationRequest, headers: Record<string, string>, signal?: AbortSignal) {
  try {
    const { data } = await request<{ genres?: Record<string, number> }>('POST', '/api/ai/expand', {
      body: {
        favourite_ids: req.favourite_ids,
        mood: req.mood,
        time_available: req.time_available,
        media_type: req.media_type,
        era: req.era ?? 'any',
      },
      headers,
      signal,
      timeoutMs: EXPAND_TIMEOUT_MS,
    });
    return data.genres && Object.keys(data.genres).length ? data.genres : null;
  } catch {
    return null; // no bias is the safe default
  }
}

function fillAlternates(primary: ScoredMediaItem, alternates: ScoredMediaItem[], ranked: ScoredMediaItem[]) {
  const chosen = new Set([primary.media.id, ...alternates.map((a) => a.media.id)]);
  const out = [...alternates];
  for (const s of ranked) {
    if (out.length >= 2) break;
    if (!chosen.has(s.media.id)) {
      out.push(s);
      chosen.add(s.media.id);
    }
  }
  return out.slice(0, 2);
}

/** Rebuild the response around the AI's choice from the engine's shortlist,
 *  the same way the old server did (backend/app/routers/recommend.py). */
function applyCuration(result: PipelineResult, reply: CurateReply): RecommendationResponse {
  const base = result.response;
  const c = reply.curated!;
  // Fresh copies: the engine attached its own line to its primary, which must
  // not follow that title if the AI demotes it.
  const sl: Scored[] = result.shortlist.map((s) => ({ ...s, rationale: null }));
  for (const [idx, line] of Object.entries(c.why_by_index)) {
    const i = Number(idx);
    if (i >= 0 && i < sl.length) sl[i].rationale = line;
  }
  const primary = sl[c.primary_index];
  const alternates = fillAlternates(
    primary,
    c.alternate_indices.filter((i) => i !== c.primary_index && i < sl.length).map((i) => sl[i]),
    result.ranked,
  );
  const rationale = c.why || base.rationale;
  if (primary.rationale == null) primary.rationale = rationale;
  return {
    ...base,
    primary,
    alternates,
    rationale,
    picked_by: 'ai',
    provider: reply.provider ?? null,
    ai_status: 'used',
    ai_tier: reply.tier,
  };
}

/**
 * One pick. The engine runs in the browser, so a pick never waits on a
 * server. When AI is available (your own key, or this deployment's shared free
 * tier) the AI then chooses among the engine's shortlist and explains it; if
 * that's slow, limited or fails, the engine's own pick and reason stand and
 * `ai_status` says why.
 */
export async function getRecommendation(
  req: RecommendationRequest,
  signal?: AbortSignal,
): Promise<{ data: RecommendationResponse }> {
  const headers = aiHeaders();
  const tier = useAiTierStore.getState();
  if (!headers && tier.freeTier === null) await tier.load();
  const useFree = !headers && useAiTierStore.getState().freeTier === true;

  let result: PipelineResult;
  try {
    // Your own key also biases retrieval first; the free tier spends its one
    // call per pick on the curation.
    const genreBoosts = headers ? await expandGenres(req, headers, signal) : null;
    if (signal?.aborted) throw apiError('CANCELED', 'Request canceled');
    result = await engine.recommend(req, genreBoosts ? { genreBoosts } : undefined);
  } catch (err) {
    throw toApiError(err);
  }
  if (signal?.aborted) throw apiError('CANCELED', 'Request canceled');

  const engineOnly = (status: AIStatus, aiTier: AITier | null): { data: RecommendationResponse } => ({
    data: { ...result.response, ai_status: status, ai_tier: aiTier },
  });

  if ((!headers && !useFree) || !result.shortlist.length) return engineOnly('off', null);

  let reply: CurateReply;
  try {
    ({ data: reply } = await request<CurateReply>('POST', '/api/ai/curate', {
      body: {
        favourite_ids: req.favourite_ids,
        mood: req.mood,
        time_available: req.time_available,
        media_type: req.media_type,
        shortlist_ids: result.shortlist.map((s) => s.media.id),
      },
      headers: headers ?? {},
      signal,
      timeoutMs: CURATE_TIMEOUT_MS,
    }));
  } catch (err) {
    const e = toApiError(err);
    if (e.code === 'CANCELED') throw e;
    return engineOnly(e.code === 'TIMEOUT' ? 'timeout' : 'error', headers ? 'byo' : 'free');
  }

  if (reply.tier === 'free' && reply.remaining !== undefined) useAiTierStore.getState().setRemaining(reply.remaining ?? null);
  if (reply.ai_status !== 'used' || !reply.curated) return engineOnly(reply.ai_status, reply.tier);
  return { data: applyCuration(result, reply) };
}
