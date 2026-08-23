import { useState, useEffect, useRef, useCallback } from "react";
import { useUIStore } from "../stores/uiStore";
import { useRecommendationStore } from "../stores/recommendationStore";

type RevealPhase = "idle" | "scanning" | "revealing" | "info_cascade" | "complete";

export function useRevealAnimation() {
  const status = useRecommendationStore((s) => s.status);
  const initialRevealPhase = useUIStore((s) => s.revealPhase);
  const [phase, setPhase] = useState<RevealPhase>(initialRevealPhase);
  const setRevealPhase = useUIStore((s) => s.setRevealPhase);
  const scanStartRef = useRef<number | null>(null);
  // 0 = normal, 1 = "still working" (~6s), 2 = "waking the server" (~15s).
  const [waitStage, setWaitStage] = useState(0);
  const longTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearLongTimers = () => {
    longTimersRef.current.forEach(clearTimeout);
    longTimersRef.current = [];
  };

  useEffect(() => {
    if (status === "loading" || status === "regenerating") {
      Promise.resolve().then(() => {
        setPhase("scanning");
        setRevealPhase("scanning");
        setWaitStage(0);
      });
      scanStartRef.current = Date.now();

      longTimersRef.current = [
        setTimeout(() => setWaitStage(1), 6000),
        setTimeout(() => setWaitStage(2), 15000),
      ];
    }

    return clearLongTimers;
  }, [status, setRevealPhase]);

  useEffect(() => {
    if (phase === "scanning" && status === "revealed") {
      clearLongTimers();
      Promise.resolve().then(() => {
        setWaitStage(0);
      });

      const elapsed = Date.now() - (scanStartRef.current ?? Date.now());
      const MIN_SCAN_MS = 2000;
      const remaining = Math.max(0, MIN_SCAN_MS - elapsed);

      const timer = setTimeout(() => {
        setPhase("revealing");
        setRevealPhase("revealing");
      }, remaining);

      return () => clearTimeout(timer);
    }
  }, [phase, status, setRevealPhase]);

  useEffect(() => {
    if (phase === "revealing") {
      const timer = setTimeout(() => {
        setPhase("info_cascade");
        setRevealPhase("info_cascade");
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [phase, setRevealPhase]);

  useEffect(() => {
    if (phase === "info_cascade") {
      const timer = setTimeout(() => {
        setPhase("complete");
        setRevealPhase("complete");
      }, 1700);

      return () => clearTimeout(timer);
    }
  }, [phase, setRevealPhase]);

  const reset = useCallback(() => {
    setPhase("idle");
    scanStartRef.current = null;
    setWaitStage(0);
    clearLongTimers();
    setRevealPhase("idle");
  }, [setRevealPhase]);

  return { phase, reset, waitStage };
}
