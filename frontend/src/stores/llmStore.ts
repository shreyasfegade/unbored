import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LlmProvider = 'gemini' | 'deepseek';

interface LlmState {
  provider: LlmProvider | null;
  apiKey: string | null;
  validated: boolean;
  setKey: (provider: LlmProvider, apiKey: string) => void;
  clear: () => void;
}

/**
 * The user's own LLM key, kept in this browser only. It's sent per request via
 * headers (see api/client.ts) and never stored on the server.
 */
export const useLlmStore = create<LlmState>()(
  persist(
    (set) => ({
      provider: null,
      apiKey: null,
      validated: false,
      setKey: (provider, apiKey) => set({ provider, apiKey, validated: true }),
      clear: () => set({ provider: null, apiKey: null, validated: false }),
    }),
    { name: 'unbored-llm' }
  )
);
