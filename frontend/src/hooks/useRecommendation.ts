import { useCallback, useRef } from "react";
import { useUIStore } from "../stores/uiStore";
import { useTasteStore } from "../stores/tasteStore";
import { useRecommendationStore } from "../stores/recommendationStore";
import { suppressedIds } from "../stores/libraryStore";
import { useTimeContext } from "./useTimeContext";
import { getRecommendation } from "../api/recommend";
import { describeApiError, isCanceled } from "../api/client";
import type { RecommendationResponse } from "../types/recommendation";

/**
 * Stateless recommendation. The request carries the taste itself
 * (`favourite_ids`) and everything already seen (`excluded_ids`), so there's no
 * server-side taste vector to recover, no 404 self-heal, and no request log —
 * "try again" is just another call with the current pick excluded.
 */
export function useRecommendation() {
  const timeOfDay = useTimeContext();
  // Read fresh store state via getState() inside callbacks — no whole-store
  // subscriptions, so this hook never re-renders the home screen.
  const abortRef = useRef<AbortController | null>(null);

  const buildBody = useCallback(() => {
    const { selectedMood, selectedTimeSlot, selectedMediaType, selectedEra } = useUIStore.getState();
    if (!selectedMood || !selectedTimeSlot) return null;
    return {
      mood: selectedMood,
      time_available: selectedTimeSlot,
      time_of_day: timeOfDay,
      media_type: selectedMediaType,
      era: selectedEra,
    };
  }, [timeOfDay]);

  /** Session exclusions plus anything the user has watched or rejected. The API
   *  caps excluded_ids at 200, so keep the most recent when it overflows. */
  const buildExcluded = useCallback((sessionExcluded: string[]) => {
    const merged = Array.from(new Set([...sessionExcluded, ...suppressedIds()]));
    return merged.length > 200 ? merged.slice(-200) : merged;
  }, []);

  /** The API caps favourite_ids at 100. Someone who saves a huge library would
   *  otherwise 422 every request; keep the most recent, which best reflects
   *  current taste. */
  const buildFavourites = useCallback((ids: string[]) => {
    return ids.length > 100 ? ids.slice(-100) : ids;
  }, []);

  const recommend = useCallback(async () => {
    const taste = useTasteStore.getState();
    const ui = useUIStore.getState();
    const rec = useRecommendationStore.getState();

    // Empty favourites is fine — the server returns a strong cold-start pick, so
    // a "surprise me" visitor can try the product before naming anything.
    const favouriteIds = taste.favouriteIds ?? [];

    const base = buildBody();
    if (!base) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    rec.setLoading();
    ui.setRevealPhase("scanning");

    try {
      const res: { data: RecommendationResponse } = await getRecommendation(
        { favourite_ids: buildFavourites(favouriteIds), excluded_ids: buildExcluded(rec.excludedIds), ...base },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      useRecommendationStore.getState().setResult(res.data);
    } catch (error) {
      if (isCanceled(error)) return;
      useRecommendationStore.getState().setError(describeApiError(error));
      ui.setRevealPhase("idle");
    }
  }, [buildBody, buildExcluded, buildFavourites]);

  const regenerate = useCallback(async () => {
    const taste = useTasteStore.getState();
    const ui = useUIStore.getState();
    const rec = useRecommendationStore.getState();

    const favouriteIds = taste.favouriteIds;
    if (!favouriteIds || favouriteIds.length === 0) return;

    const base = buildBody();
    if (!base) return;

    const { excludedIds, primary } = rec;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    rec.setRegenerating();
    ui.setRevealPhase("scanning");

    // Exclude the current pick in THIS request; only commit it to the persistent
    // exclusion list once the request succeeds, so a failed regenerate never
    // permanently bans a pick the user never replaced.
    const nextExcluded = primary ? [...excludedIds, primary.media.id] : excludedIds;

    try {
      const res: { data: RecommendationResponse } = await getRecommendation(
        { favourite_ids: buildFavourites(favouriteIds), excluded_ids: buildExcluded(nextExcluded), ...base },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (primary) useRecommendationStore.getState().addExcludedId(primary.media.id);
      useRecommendationStore.getState().setResult(res.data);
    } catch (error) {
      if (isCanceled(error)) return;
      useRecommendationStore.getState().setError(describeApiError(error));
      ui.setRevealPhase("idle");
    }
  }, [buildBody, buildExcluded, buildFavourites]);

  return { recommend, regenerate };
}
