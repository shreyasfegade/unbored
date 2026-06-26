import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserTasteVector } from '../types/taste';
import type { MediaItem } from '../types/media';

interface TasteState {
  vectorId: string | null;
  vector: UserTasteVector | null;
  hasCompletedOnboarding: boolean;
  favouriteIds: string[];
  selectedFavourites: MediaItem[];
  enrichmentItems: MediaItem[];
  curatedShortlist: MediaItem[];
  isLoadingShortlist: boolean;

  setVectorId: (id: string) => void;
  setVector: (v: UserTasteVector) => void;
  setFavouriteIds: (ids: string[]) => void;
  addFavourite: (item: MediaItem) => void;
  removeFavourite: (id: string) => void;
  clearFavourites: () => void;
  addEnrichmentItem: (item: MediaItem) => void;
  removeEnrichmentItem: (id: string) => void;
  setCuratedShortlist: (items: MediaItem[]) => void;
  setLoadingShortlist: (v: boolean) => void;
  completeOnboarding: () => void;
  resetProfile: () => void;
}

export const useTasteStore = create<TasteState>()(
  persist(
    (set) => ({
      vectorId: null,
      vector: null,
      hasCompletedOnboarding: false,
      favouriteIds: [],
      selectedFavourites: [],
      enrichmentItems: [],
      curatedShortlist: [],
      isLoadingShortlist: false,

      setVectorId: (id) => set({ vectorId: id }),
      setVector: (v) => set({ vector: v }),
      setFavouriteIds: (ids) => set({ favouriteIds: ids }),
      addFavourite: (item) =>
        set((state) => {
          if (state.selectedFavourites.length >= 5) return state;
          if (state.selectedFavourites.some((f) => f.id === item.id)) return state;
          return { selectedFavourites: [...state.selectedFavourites, item] };
        }),
      removeFavourite: (id) =>
        set((state) => ({
          selectedFavourites: state.selectedFavourites.filter((f) => f.id !== id),
        })),
      clearFavourites: () => set({ selectedFavourites: [] }),
      addEnrichmentItem: (item) =>
        set((state) => ({
          enrichmentItems: [...state.enrichmentItems, item],
        })),
      removeEnrichmentItem: (id) =>
        set((state) => ({
          enrichmentItems: state.enrichmentItems.filter((i) => i.id !== id),
        })),
      setCuratedShortlist: (items) => set({ curatedShortlist: items }),
      setLoadingShortlist: (v) => set({ isLoadingShortlist: v }),
      completeOnboarding: () => set({ hasCompletedOnboarding: true }),
      resetProfile: () =>
        set({
          vectorId: null,
          vector: null,
          hasCompletedOnboarding: false,
          favouriteIds: [],
          selectedFavourites: [],
          enrichmentItems: [],
        }),
    }),
    {
      name: 'unbored-taste',
      partialize: (state) => ({
        vectorId: state.vectorId,
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        favouriteIds: state.favouriteIds,
      }),
    }
  )
);
