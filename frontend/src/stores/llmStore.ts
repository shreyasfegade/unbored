import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type LlmProvider = 'gemini' | 'deepseek';

interface LlmState {
  provider: LlmProvider | null;
  apiKey: string | null;
  validated: boolean;
  setKey: (provider: LlmProvider, apiKey: string) => void;
  clear: () => void;
}

/**
 * The user's own LLM key, kept in this browser only. Persisted to
 * sessionStorage (not localStorage) so a raw API key doesn't sit indefinitely
 * on disk readable by any script — it lives for the tab session and is cleared
 * when the tab closes. The key is attached only to /api/recommend and
 * /api/llm/* requests (see api/client.ts) and never stored on the server.
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
    { name: 'unbored-llm', storage: createJSONStorage(() => sessionStorage) }
  )
);
