import { useState, useCallback } from 'react';
import { useTasteStore } from '../stores/tasteStore';
import type { MediaItem } from '../types/media';
import { fetchCuratedShortlist as apiFetchShortlist } from '../api/taste';

export function useTasteVector() {
  const selectedFavourites = useTasteStore((s) => s.selectedFavourites);
  const curatedShortlist = useTasteStore((s) => s.curatedShortlist);

  const setCuratedShortlist = useTasteStore((s) => s.setCuratedShortlist);
  const setFavouriteIds = useTasteStore((s) => s.setFavouriteIds);
  const completeOnboarding = useTasteStore((s) => s.completeOnboarding);
  const addFavourite = useTasteStore((s) => s.addFavourite);
  const removeFavourite = useTasteStore((s) => s.removeFavourite);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCuratedShortlist = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetchShortlist();
      const items: MediaItem[] = res.data.items || [];
      setCuratedShortlist(items);
      return items;
    } catch {
      // Usually a cold backend waking up, not a real connection problem — say so.
      setError("Still waking up the server… give it a moment and tap retry.");
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [setCuratedShortlist]);

  // Onboarding is now purely local: store the chosen ids and mark complete.
  // No server round-trip, so no cold-start wall and nothing to lose on refresh.
  const createFromFavourites = useCallback(
    async (favourites: MediaItem[]) => {
      const ids = favourites.map((f) => f.id);
      setFavouriteIds(ids);
      completeOnboarding();
      return ids;
    },
    [setFavouriteIds, completeOnboarding]
  );

  return {
    selectedFavourites,
    curatedShortlist,
    isLoading,
    error,
    fetchCuratedShortlist,
    createFromFavourites,
    addFavourite,
    removeFavourite,
  };
}
