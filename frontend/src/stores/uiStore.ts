import { create } from 'zustand';
import type { MoodType, TimeSlot } from '../types/mood';
import type { MediaTypeChoice } from '../types/recommendation';

type RevealPhase = 'idle' | 'scanning' | 'revealing' | 'info_cascade' | 'complete';

interface UIState {
  selectedMood: MoodType | null;
  selectedTimeSlot: TimeSlot | null;
  selectedMediaType: MediaTypeChoice;
  revealPhase: RevealPhase;
  showEnrichPrompt: boolean;
  showMoodPrompt: boolean;

  setMood: (mood: MoodType) => void;
  setTimeSlot: (slot: TimeSlot) => void;
  setMediaType: (type: MediaTypeChoice) => void;
  setRevealPhase: (phase: RevealPhase) => void;
  setShowEnrichPrompt: (show: boolean) => void;
  setShowMoodPrompt: (show: boolean) => void;
  resetSelections: () => void;
}

export const useUIStore = create<UIState>()((set) => ({
  selectedMood: null,
  selectedTimeSlot: null,
  selectedMediaType: 'surprise',
  revealPhase: 'idle',
  showEnrichPrompt: false,
  showMoodPrompt: false,

  setMood: (mood) => set({ selectedMood: mood, showMoodPrompt: false }),
  setTimeSlot: (slot) => set({ selectedTimeSlot: slot }),
  setMediaType: (type) => set({ selectedMediaType: type }),
  setRevealPhase: (phase) => set({ revealPhase: phase }),
  setShowEnrichPrompt: (show) => set({ showEnrichPrompt: show }),
  setShowMoodPrompt: (show) => set({ showMoodPrompt: show }),
  resetSelections: () =>
    set({ selectedMood: null, selectedTimeSlot: null, revealPhase: 'idle' }),
}));
