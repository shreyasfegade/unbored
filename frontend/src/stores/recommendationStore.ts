import { create } from 'zustand';
import type { ScoredMediaItem, RecommendationResponse } from '../types/recommendation';
import type { ConfidenceLevel } from '../types/mood';

type Status = 'idle' | 'loading' | 'revealed' | 'regenerating' | 'error';
export type AIStatus = 'off' | 'used' | 'timeout' | 'error';

// Keep the exclusion list bounded so it can't grow without limit across a long
// session (and it's sent in every request body).
const MAX_EXCLUDED = 50;

interface RecommendationState {
  status: Status;
  primary: ScoredMediaItem | null;
  alternates: ScoredMediaItem[];
  rationale: string | null;
  pickedBy: 'ai' | 'engine' | null;
  provider: string | null;
  aiStatus: AIStatus;
  mediaTypeApplied: boolean;
  confidence: ConfidenceLevel | null;
  requestId: string | null;
  excludedIds: string[];
  error: string | null;
  swapped: boolean;

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
  rationale: null,
  pickedBy: null,
  provider: null,
  aiStatus: 'off',
  mediaTypeApplied: true,
  confidence: null,
  requestId: null,
  excludedIds: [],
  error: null,
  swapped: false,

  setLoading: () => set({ status: 'loading', error: null }),
  setRegenerating: () => set({ status: 'regenerating', error: null }),
  setResult: (res) =>
    set({
      status: 'revealed',
      primary: res.primary,
      alternates: res.alternates,
      rationale: res.rationale,
      pickedBy: res.picked_by,
      provider: res.provider,
      aiStatus: res.ai_status ?? (res.picked_by === 'ai' ? 'used' : 'off'),
      mediaTypeApplied: res.media_type_applied ?? true,
      confidence: res.confidence,
      requestId: res.request_id,
      error: null,
      swapped: false,
    }),
  setError: (msg) => set({ status: 'error', error: msg }),
  addExcludedId: (id) =>
    set((state) => {
      if (state.excludedIds.includes(id)) return state;
      const next = [...state.excludedIds, id];
      return { excludedIds: next.slice(-MAX_EXCLUDED) };
    }),
  swapAlternate: (index) =>
    set((state) => {
      const alt = state.alternates[index];
      if (!alt || !state.primary) return state;
      const newAlternates = [...state.alternates];
      newAlternates[index] = state.primary;
      // Show the swapped pick's OWN rationale when the AI provided one; otherwise
      // clear it (confidence too) rather than show a line about the old pick.
      return {
        primary: alt,
        alternates: newAlternates,
        rationale: alt.rationale ?? null,
        confidence: null,
        swapped: true,
      };
    }),
  reset: () =>
    set({
      status: 'idle',
      primary: null,
      alternates: [],
      rationale: null,
      pickedBy: null,
      provider: null,
      aiStatus: 'off',
      mediaTypeApplied: true,
      confidence: null,
      requestId: null,
      excludedIds: [],
      error: null,
      swapped: false,
    }),
}));
