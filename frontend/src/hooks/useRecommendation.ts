import { useCallback } from "react";
import { useUIStore } from "../stores/uiStore";
import { useTasteStore } from "../stores/tasteStore";
import { useRecommendationStore } from "../stores/recommendationStore";
import { useTimeContext } from "./useTimeContext";
import { getRecommendation, regenerateRecommendation } from "../api/recommend";

export function useRecommendation() {
  const timeOfDay = useTimeContext();
  const uiStore = useUIStore();
  const tasteStore = useTasteStore();
  const recStore = useRecommendationStore();

  const recommend = useCallback(async () => {
    const vectorId = tasteStore.vectorId;
    if (!vectorId) throw new Error("No taste vector");

    const { selectedMood, selectedTimeSlot } = uiStore;
    if (!selectedMood || !selectedTimeSlot) return;

    const excludedIds = recStore.excludedIds;

    recStore.setLoading();
    uiStore.setRevealPhase("scanning");

    try {
      const response = await getRecommendation({
        taste_vector_id: vectorId,
        mood: selectedMood,
        time_available: selectedTimeSlot,
        time_of_day: timeOfDay,
        excluded_ids: excludedIds,
      });

      recStore.setResult(response.data);
    } catch (error) {
      recStore.setError(
        error instanceof Error ? error.message : "Something went wrong"
      );
      uiStore.setRevealPhase("idle");
    }
  }, [timeOfDay, uiStore, tasteStore.vectorId, recStore]);

  const regenerate = useCallback(async () => {
    const vectorId = tasteStore.vectorId;
    if (!vectorId) throw new Error("No taste vector");

    const { selectedMood, selectedTimeSlot } = uiStore;
    if (!selectedMood || !selectedTimeSlot) return;

    const { excludedIds, requestId, primary } = recStore;
    if (!requestId) return;

    // Add current primary ID to excluded list
    if (primary) {
      recStore.addExcludedId(primary.media.id);
    }

    recStore.setRegenerating();
    uiStore.setRevealPhase("scanning");

    try {
      const response = await regenerateRecommendation({
        taste_vector_id: vectorId,
        mood: selectedMood,
        time_available: selectedTimeSlot,
        time_of_day: timeOfDay,
        original_request_id: requestId,
        excluded_ids: primary ? [...excludedIds, primary.media.id] : excludedIds,
      });

      recStore.setResult(response.data);
    } catch (error) {
      recStore.setError(
        error instanceof Error ? error.message : "Something went wrong"
      );
      uiStore.setRevealPhase("idle");
    }
  }, [timeOfDay, uiStore, tasteStore.vectorId, recStore]);

  return { recommend, regenerate };
}
