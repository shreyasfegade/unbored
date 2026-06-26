import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useUIStore } from "../stores/uiStore";
import { useTasteStore } from "../stores/tasteStore";
import { useRecommendationStore } from "../stores/recommendationStore";
import { useTimeContext } from "./useTimeContext";
import { getRecommendation, regenerateRecommendation } from "../api/recommend";
import { createTasteVector } from "../api/taste";
import type { RecommendationResponse } from "../types/recommendation";

type ApiError = Error & { status?: number; errorCode?: string };

/** The server's taste store is ephemeral (free-tier hosting wipes it on restart),
 *  so a saved vectorId can vanish. We persist the favourite IDs and transparently
 *  re-create the vector when the server no longer knows it. */
function isMissingVector(e: unknown): boolean {
  const err = e as ApiError;
  return err?.status === 404 || /not found/i.test(err?.message || "");
}

export function useRecommendation() {
  const timeOfDay = useTimeContext();
  const navigate = useNavigate();
  const uiStore = useUIStore();
  const tasteStore = useTasteStore();
  const recStore = useRecommendationStore();

  // Re-create the taste vector from persisted favourites; returns new id or null.
  const recoverVector = useCallback(async (): Promise<string | null> => {
    const favIds = useTasteStore.getState().favouriteIds;
    if (!favIds || favIds.length < 5) return null;
    try {
      const res = await createTasteVector(favIds.slice(0, 5));
      useTasteStore.getState().setVectorId(res.data.id);
      return res.data.id;
    } catch {
      return null;
    }
  }, []);

  const recommend = useCallback(async () => {
    let vectorId = tasteStore.vectorId;
    if (!vectorId) {
      // Stale/old state with no vector — re-create or restart onboarding.
      vectorId = await recoverVector();
      if (!vectorId) {
        tasteStore.resetProfile();
        navigate("/onboarding", { replace: true });
        return;
      }
    }

    const { selectedMood, selectedTimeSlot, selectedMediaType } = uiStore;
    if (!selectedMood || !selectedTimeSlot) return;

    recStore.setLoading();
    uiStore.setRevealPhase("scanning");

    const body = {
      mood: selectedMood,
      time_available: selectedTimeSlot,
      time_of_day: timeOfDay,
      media_type: selectedMediaType,
      excluded_ids: recStore.excludedIds,
    };

    try {
      let res: { data: RecommendationResponse };
      try {
        res = await getRecommendation({ taste_vector_id: vectorId, ...body });
      } catch (e) {
        if (isMissingVector(e)) {
          const newId = await recoverVector();
          if (!newId) throw e;
          res = await getRecommendation({ taste_vector_id: newId, ...body });
        } else {
          throw e;
        }
      }
      recStore.setResult(res.data);
    } catch (error) {
      if (isMissingVector(error)) {
        // Couldn't recover (no stored favourites) — start onboarding fresh.
        tasteStore.resetProfile();
        recStore.reset();
        uiStore.setRevealPhase("idle");
        navigate("/onboarding", { replace: true });
        return;
      }
      recStore.setError(error instanceof Error ? error.message : "Something went wrong");
      uiStore.setRevealPhase("idle");
    }
  }, [timeOfDay, uiStore, tasteStore, recStore, navigate, recoverVector]);

  const regenerate = useCallback(async () => {
    const vectorId = tasteStore.vectorId;
    if (!vectorId) return;

    const { selectedMood, selectedTimeSlot, selectedMediaType } = uiStore;
    if (!selectedMood || !selectedTimeSlot) return;

    const { excludedIds, requestId, primary } = recStore;
    if (primary) recStore.addExcludedId(primary.media.id);

    recStore.setRegenerating();
    uiStore.setRevealPhase("scanning");

    const nextExcluded = primary ? [...excludedIds, primary.media.id] : excludedIds;
    const body = {
      mood: selectedMood,
      time_available: selectedTimeSlot,
      time_of_day: timeOfDay,
      media_type: selectedMediaType,
    };

    try {
      let res: { data: RecommendationResponse };
      try {
        // The original request log is also ephemeral; if it's gone, fall back
        // to a fresh recommendation that excludes the current pick.
        if (requestId) {
          res = await regenerateRecommendation({
            taste_vector_id: vectorId,
            original_request_id: requestId,
            excluded_ids: nextExcluded,
            ...body,
          });
        } else {
          res = await getRecommendation({ taste_vector_id: vectorId, excluded_ids: nextExcluded, ...body });
        }
      } catch (e) {
        const newId = isMissingVector(e) ? await recoverVector() : vectorId;
        res = await getRecommendation({
          taste_vector_id: newId || vectorId,
          excluded_ids: nextExcluded,
          ...body,
        });
      }
      recStore.setResult(res.data);
    } catch (error) {
      recStore.setError(error instanceof Error ? error.message : "Something went wrong");
      uiStore.setRevealPhase("idle");
    }
  }, [timeOfDay, uiStore, tasteStore, recStore, recoverVector]);

  return { recommend, regenerate };
}
