import { create } from 'zustand';
import type { ScoredMediaItem, RecommendationResponse, WhyNowResult } from '../types/recommendation';
import type { ConfidenceLevel } from '../types/mood';

type Status = 'idle' | 'loading' | 'revealed' | 'regenerating' | 'error';

interface RecommendationState {
  status: Status;
  primary: ScoredMediaItem | null;
  alternates: ScoredMediaItem[];
  whyNow: WhyNowResult | null;
  confidence: ConfidenceLevel | null;
  requestId: string | null;
  excludedIds: string[];
  error: string | null;

  setLoading: () => void;
  setRegenerating: () => void;
  setResult: (res: RecommendationResponse) => void;
  setError: (msg: string) => void;
  addExcludedId: (id: string) => void;
  swapAlternate: (index: number) => void;
  reset: () => void;
}

export const useRecommendationStore = create<RecommendationState>()((set) => ({
  status: 'idle',
  primary: null,
  alternates: [],
  whyNow: null,
  confidence: null,
  requestId: null,
  excludedIds: [],
  error: null,

  setLoading: () => set({ status: 'loading', error: null }),
  setRegenerating: () => set({ status: 'regenerating', error: null }),
  setResult: (res) =>
    set({
      status: 'revealed',
      primary: res.primary,
      alternates: res.alternates,
      whyNow: res.why_now,
      confidence: res.confidence,
      requestId: res.request_id,
      error: null,
    }),
  setError: (msg) => set({ status: 'error', error: msg }),
  addExcludedId: (id) =>
    set((state) => ({
      excludedIds: [...state.excludedIds, id],
    })),
  swapAlternate: (index) =>
    set((state) => {
      const alt = state.alternates[index];
      if (!alt || !state.primary) return state;
      const newAlternates = [...state.alternates];
      newAlternates[index] = state.primary;
      return { primary: alt, alternates: newAlternates, whyNow: null };
    }),
  reset: () =>
    set({
      status: 'idle',
      primary: null,
      alternates: [],
      whyNow: null,
      confidence: null,
      requestId: null,
      error: null,
    }),
}));
