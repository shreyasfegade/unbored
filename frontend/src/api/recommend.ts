import { engine } from '../engine/client';
import { useLlmStore } from '../stores/llmStore';
import type { RecommendationRequest, RecommendationResponse } from '../types/recommendation';
import { apiError, request, toApiError } from './client';

/**
 * One pick. The engine runs in the browser, so a visitor without an AI key
 * gets a pick with no network at all.
 *
 * Interim: a connected key still goes to the hosted API, which does the AI
 * expansion and curation, until the AI moves to its own functions.
 */
export async function getRecommendation(
  req: RecommendationRequest,
  signal?: AbortSignal,
): Promise<{ data: RecommendationResponse }> {
  const { provider, apiKey, validated } = useLlmStore.getState();
  if (provider && apiKey && validated) {
    return request<RecommendationResponse>('POST', '/api/recommend', {
      body: req,
      headers: { 'X-LLM-Provider': provider, 'X-LLM-Key': apiKey },
      signal,
      timeoutMs: 90000,
    });
  }
  try {
    const { response } = await engine.recommend(req);
    if (signal?.aborted) throw apiError('CANCELED', 'Request canceled');
    return { data: response };
  } catch (err) {
    throw toApiError(err);
  }
}
