import { create } from 'zustand';
import { request } from '../api/client';

interface AiTierState {
  /** null until checked; false when the deployment has no free tier. */
  freeTier: boolean | null;
  remaining: number | null;
  limit: number | null;
  load: () => Promise<void>;
  setRemaining: (n: number | null) => void;
}

let inflight: Promise<void> | null = null;

/**
 * Whether this deployment offers shared free AI picks, and how many this
 * visitor has left today (GET /api/ai/quota, which spends nothing). Anything
 * other than a clean answer reads as "no free tier", so a local dev server
 * without the functions simply runs engine-only.
 */
export const useAiTierStore = create<AiTierState>()((set) => ({
  freeTier: null,
  remaining: null,
  limit: null,
  load: () => {
    if (!inflight) {
      inflight = request<{ free_tier: boolean; limit: number; remaining: number }>('GET', '/api/ai/quota', { timeoutMs: 5000 })
        .then(({ data }) => {
          if (typeof data?.free_tier !== 'boolean') throw new Error('bad quota');
          set({ freeTier: data.free_tier, remaining: data.remaining, limit: data.limit });
        })
        .catch(() => set({ freeTier: false, remaining: null, limit: null }))
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  },
  setRemaining: (n) => set({ remaining: n }),
}));
