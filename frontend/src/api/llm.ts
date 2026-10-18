import type { LlmProvider } from '../stores/llmStore';
import { request } from './client';

export interface ValidateResult {
  ok: boolean;
  provider?: string;
  model?: string;
  error?: string | null;
}

/** Validate a key with one tiny generation. The key is passed explicitly here
 *  because it isn't in the store yet. */
export async function validateKey(provider: LlmProvider, key: string): Promise<ValidateResult> {
  const { data } = await request<ValidateResult>('POST', '/api/ai/validate', {
    headers: { 'X-LLM-Provider': provider, 'X-LLM-Key': key },
    timeoutMs: 12000,
  });
  return data;
}
