import { useState, useCallback } from 'react';
import { useTasteStore } from '../stores/tasteStore';
import type { MediaItem } from '../types/media';
import { createTasteVector as apiCreateVector, fetchCuratedShortlist as apiFetchShortlist } from '../api/taste';

export function useTasteVector() {
  const vector = useTasteStore((s) => s.vector);
  const vectorId = useTasteStore((s) => s.vectorId);
  const selectedFavourites = useTasteStore((s) => s.selectedFavourites);
  const curatedShortlist = useTasteStore((s) => s.curatedShortlist);
  
  const setCuratedShortlist = useTasteStore((s) => s.setCuratedShortlist);
  const setVectorId = useTasteStore((s) => s.setVectorId);
  const setVector = useTasteStore((s) => s.setVector);
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
      setError("Couldn't load the shortlist. Please check your connection.");
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [setCuratedShortlist]);

  const createFromFavourites = useCallback(async (favourites: MediaItem[]) => {
    setIsLoading(true);
    setError(null);
    try {
      const ids = favourites.map((f) => f.id);
      const res = await apiCreateVector(ids);
      setVectorId(res.data.id);
      setVector(res.data);
      completeOnboarding();
      return res.data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create taste profile');
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, [setVectorId, setVector, completeOnboarding]);

  return {
    vector,
    vectorId,
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
