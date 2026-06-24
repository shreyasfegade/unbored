import api from './client';
import type { LlmProvider } from '../stores/llmStore';

export interface ValidateResult {
  ok: boolean;
  provider?: string;
  model?: string;
  error?: string | null;
}

/** Validate a key with one tiny generation. The key is passed explicitly here
 *  (it isn't in the store yet) so the request interceptor doesn't shadow it. */
export async function validateKey(provider: LlmProvider, key: string): Promise<ValidateResult> {
  const { data } = await api.post<ValidateResult>('/api/llm/validate', null, {
    headers: { 'X-LLM-Provider': provider, 'X-LLM-Key': key },
  });
  return data;
}
