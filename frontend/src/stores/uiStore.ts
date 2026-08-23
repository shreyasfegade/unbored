import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MoodType, TimeSlot } from '../types/mood';
import type { MediaTypeChoice, EraPreference } from '../types/recommendation';

type RevealPhase = 'idle' | 'scanning' | 'revealing' | 'info_cascade' | 'complete';

interface UIState {
  selectedMood: MoodType | null;
  selectedTimeSlot: TimeSlot | null;
  selectedMediaType: MediaTypeChoice;
  selectedEra: EraPreference;
  revealPhase: RevealPhase;
  showMoodPrompt: boolean;

  setMood: (mood: MoodType) => void;
  setTimeSlot: (slot: TimeSlot) => void;
  setMediaType: (type: MediaTypeChoice) => void;
  setEra: (era: EraPreference) => void;
  setRevealPhase: (phase: RevealPhase) => void;
  setShowMoodPrompt: (show: boolean) => void;
  resetSelections: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      selectedMood: null,
      selectedTimeSlot: null,
      selectedMediaType: 'surprise',
      selectedEra: 'any',
      revealPhase: 'idle',
      showMoodPrompt: false,

      setMood: (mood) => set({ selectedMood: mood, showMoodPrompt: false }),
      setTimeSlot: (slot) => set({ selectedTimeSlot: slot }),
      setMediaType: (type) => set({ selectedMediaType: type }),
      setEra: (era) => set({ selectedEra: era }),
      setRevealPhase: (phase) => set({ revealPhase: phase }),
      setShowMoodPrompt: (show) => set({ showMoodPrompt: show }),
      resetSelections: () =>
        set({ selectedMood: null, selectedTimeSlot: null, revealPhase: 'idle' }),
    }),
    {
      name: 'unbored-ui',
      // Selections survive a refresh; transient reveal/prompt state does not.
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        selectedMood: state.selectedMood,
        selectedTimeSlot: state.selectedTimeSlot,
        selectedMediaType: state.selectedMediaType,
        selectedEra: state.selectedEra,
      }),
    }
  )
);
