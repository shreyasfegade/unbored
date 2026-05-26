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
  const [takingLonger, setTakingLonger] = useState(false);
  const longTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status === "loading" || status === "regenerating") {
      Promise.resolve().then(() => {
        setPhase("scanning");
        setRevealPhase("scanning");
        setTakingLonger(false);
      });
      scanStartRef.current = Date.now();

      longTimerRef.current = setTimeout(() => {
        setTakingLonger(true);
      }, 5000);
    }

    return () => {
      if (longTimerRef.current) {
        clearTimeout(longTimerRef.current);
        longTimerRef.current = null;
      }
    };
  }, [status, setRevealPhase]);

  useEffect(() => {
    if (phase === "scanning" && status === "revealed") {
      if (longTimerRef.current) {
        clearTimeout(longTimerRef.current);
        longTimerRef.current = null;
      }
      Promise.resolve().then(() => {
        setTakingLonger(false);
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
    setTakingLonger(false);
    if (longTimerRef.current) {
      clearTimeout(longTimerRef.current);
      longTimerRef.current = null;
    }
    setRevealPhase("idle");
  }, [setRevealPhase]);

  return { phase, reset, takingLonger };
}
