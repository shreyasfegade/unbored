import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MediaItem } from '../types/media';

// Taste now lives entirely in the browser: `favouriteIds` is the single source
// of truth, sent with every recommend request. There is no server-side taste
// vector and no vectorId to keep in sync.
interface TasteState {
  hasCompletedOnboarding: boolean;
  favouriteIds: string[];
  selectedFavourites: MediaItem[];
  enrichmentItems: MediaItem[];
  curatedShortlist: MediaItem[];

  setFavouriteIds: (ids: string[]) => void;
  addFavouriteIds: (ids: string[]) => void;
  removeFavouriteId: (id: string) => void;
  addFavourite: (item: MediaItem) => void;
  removeFavourite: (id: string) => void;
  clearFavourites: () => void;
  addEnrichmentItem: (item: MediaItem) => void;
  removeEnrichmentItem: (id: string) => void;
  clearEnrichmentItems: () => void;
  setCuratedShortlist: (items: MediaItem[]) => void;
  completeOnboarding: () => void;
  resetProfile: () => void;
}

export const useTasteStore = create<TasteState>()(
  persist(
    (set) => ({
      hasCompletedOnboarding: false,
      favouriteIds: [],
      selectedFavourites: [],
      enrichmentItems: [],
      curatedShortlist: [],

      setFavouriteIds: (ids) => set({ favouriteIds: ids }),
      addFavouriteIds: (ids) =>
        set((state) => ({
          favouriteIds: Array.from(new Set([...state.favouriteIds, ...ids])),
        })),
      removeFavouriteId: (id) =>
        set((state) => ({
          favouriteIds: state.favouriteIds.filter((f) => f !== id),
        })),
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
      clearEnrichmentItems: () => set({ enrichmentItems: [] }),
      setCuratedShortlist: (items) => set({ curatedShortlist: items }),
      completeOnboarding: () => set({ hasCompletedOnboarding: true }),
      resetProfile: () =>
        set({
          hasCompletedOnboarding: false,
          favouriteIds: [],
          selectedFavourites: [],
          enrichmentItems: [],
        }),
    }),
    {
      name: 'unbored-taste',
      partialize: (state) => ({
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        favouriteIds: state.favouriteIds,
      }),
    }
  )
);
