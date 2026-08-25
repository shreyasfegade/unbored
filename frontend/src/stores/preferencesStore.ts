import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TuningWeights, MediaTypeChoice, EraPreference } from '../types/recommendation';
import type { TimeSlot } from '../types/mood';

// Durable, cross-session preferences (unlike uiStore, which is per-session). The
// namespaced persist key leaves room for a per-profile prefix once accounts land.
export type TuningAxis = keyof TuningWeights;
export type Density = 'comfortable' | 'compact';

export const NEUTRAL_TUNING: TuningWeights = {
  adventurous: 0,
  obscurity: 0,
  acclaim: 0,
  freshness: 0,
};

interface PreferencesState {
  tuning: TuningWeights;
  // false = follow the OS setting; true = force reduced motion regardless.
  reduceMotion: boolean;
  density: Density;
  defaultMediaType: MediaTypeChoice;
  defaultEra: EraPreference;
  defaultTimeSlot: TimeSlot | null;

  setTuning: (axis: TuningAxis, value: number) => void;
  resetTuning: () => void;
  setReduceMotion: (on: boolean) => void;
  setDensity: (d: Density) => void;
  setDefaultMediaType: (t: MediaTypeChoice) => void;
  setDefaultEra: (e: EraPreference) => void;
  setDefaultTimeSlot: (s: TimeSlot | null) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      tuning: { ...NEUTRAL_TUNING },
      reduceMotion: false,
      density: 'comfortable',
      defaultMediaType: 'surprise',
      defaultEra: 'any',
      defaultTimeSlot: null,

      setTuning: (axis, value) =>
        set((state) => ({ tuning: { ...state.tuning, [axis]: value } })),
      resetTuning: () => set({ tuning: { ...NEUTRAL_TUNING } }),
      setReduceMotion: (on) => set({ reduceMotion: on }),
      setDensity: (d) => set({ density: d }),
      setDefaultMediaType: (t) => set({ defaultMediaType: t }),
      setDefaultEra: (e) => set({ defaultEra: e }),
      setDefaultTimeSlot: (s) => set({ defaultTimeSlot: s }),
    }),
    { name: 'unbored-preferences' },
  ),
);

/** True when nothing is tuned, so the request can omit `tuning` entirely. */
export function isNeutralTuning(t: TuningWeights): boolean {
  return t.adventurous === 0 && t.obscurity === 0 && t.acclaim === 0 && t.freshness === 0;
}
