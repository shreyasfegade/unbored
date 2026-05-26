import { useMemo } from "react";
import type { TimeOfDay } from "../types/mood";

export function useTimeContext(): TimeOfDay {
  return useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "morning";
    if (hour >= 12 && hour < 17) return "afternoon";
    if (hour >= 17 && hour < 21) return "evening";
    return "late_night";
  }, []);
}
