import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TuningWeights } from '../types/recommendation';

// Durable, cross-session preferences (unlike uiStore, which is per-session). The
// namespaced persist key leaves room for a per-profile prefix once accounts land.
export type TuningAxis = keyof TuningWeights;

export const NEUTRAL_TUNING: TuningWeights = {
  adventurous: 0,
  obscurity: 0,
  acclaim: 0,
  freshness: 0,
};

interface PreferencesState {
  tuning: TuningWeights;
  setTuning: (axis: TuningAxis, value: number) => void;
  resetTuning: () => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      tuning: { ...NEUTRAL_TUNING },
      setTuning: (axis, value) =>
        set((state) => ({ tuning: { ...state.tuning, [axis]: value } })),
      resetTuning: () => set({ tuning: { ...NEUTRAL_TUNING } }),
    }),
    { name: 'unbored-preferences' },
  ),
);

/** True when nothing is tuned, so the request can omit `tuning` entirely. */
export function isNeutralTuning(t: TuningWeights): boolean {
  return t.adventurous === 0 && t.obscurity === 0 && t.acclaim === 0 && t.freshness === 0;
}
