import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useEffect } from "react";
import { useUIStore } from "../stores/uiStore";
import { useRecommendationStore } from "../stores/recommendationStore";
import { useTasteStore } from "../stores/tasteStore";
import { useToastStore } from "../stores/toastStore";
import { useRecommendation } from "../hooks/useRecommendation";
import { MoodSelector } from "../components/mood";
import { TimeSelector } from "../components/ui/TimeSelector";
import { MediaTypeSelector } from "../components/ui/MediaTypeSelector";
import { OracleButton } from "../components/ui/OracleButton";
import { RevealOracle } from "../components/reveal";
import { AIStatusBanner } from "../components/llm/AIStatusBanner";
import styles from "./HomePage.module.css";

const WORDMARK_ANIMATED_KEY = "unbored-home-wordmark-animated";

function mapRecError(raw: string): string {
  if (!raw) return "Something went wrong. Try again.";
  const lower = raw.toLowerCase();
  if (lower.includes("network") || lower.includes("reach") || lower.includes("connection"))
    return "Can't reach the server. Check your connection.";
  if (lower.includes("not found") || lower.includes("null"))
    return "Can't reach the server. Check your connection.";
  return "Something went wrong. Try again.";
}

export default function HomePage() {
  const selectedMood = useUIStore((s) => s.selectedMood);
  const selectedTimeSlot = useUIStore((s) => s.selectedTimeSlot);
  const selectedMediaType = useUIStore((s) => s.selectedMediaType);
  const showMoodPrompt = useUIStore((s) => s.showMoodPrompt);
  const setMood = useUIStore((s) => s.setMood);
  const setTimeSlot = useUIStore((s) => s.setTimeSlot);
  const setMediaType = useUIStore((s) => s.setMediaType);
  const setShowMoodPrompt = useUIStore((s) => s.setShowMoodPrompt);
  const resetSelections = useUIStore((s) => s.resetSelections);

  const resetRec = useRecommendationStore((s) => s.reset);
  const recStatus = useRecommendationStore((s) => s.status);
  const recError = useRecommendationStore((s) => s.error);

  const hasCompletedOnboarding = useTasteStore((s) => s.hasCompletedOnboarding);
  const addToast = useToastStore((s) => s.addToast);
  const { recommend, regenerate } = useRecommendation();

  useEffect(() => {
    const count = sessionStorage.getItem("unbored-enrich-success");
    if (count) {
      sessionStorage.removeItem("unbored-enrich-success");
      addToast(`Taste updated with ${count} item${count === "1" ? "" : "s"}.`);
    }
  }, [addToast]);

  const canRecommend = selectedMood !== null && selectedTimeSlot !== null;
  const isLoading = recStatus === "loading" || recStatus === "regenerating";
  const isError = recStatus === "error";
  const preRecommendShown =
    (recStatus === "idle" || recStatus === "error") && hasCompletedOnboarding;
  const postRecommendShown =
    (recStatus === "revealed" || recStatus === "loading" || recStatus === "regenerating") &&
    hasCompletedOnboarding;

  const hasSeenWordmark = sessionStorage.getItem(WORDMARK_ANIMATED_KEY) !== null;
  if (!hasSeenWordmark) {
    sessionStorage.setItem(WORDMARK_ANIMATED_KEY, "1");
  }

  const hasVisitedHome = sessionStorage.getItem("unbored-home-visited") !== null;
  if (!hasVisitedHome) {
    sessionStorage.setItem("unbored-home-visited", "1");
  }

  const handleOracleClick = useCallback(() => {
    if (!selectedMood) {
      setShowMoodPrompt(true);
      return;
    }
    if (!selectedTimeSlot) {
      return;
    }
    recommend();
  }, [selectedMood, selectedTimeSlot, recommend, setShowMoodPrompt]);

  const handleRetry = useCallback(() => {
    recommend();
  }, [recommend]);

  const handleRegenerate = useCallback(() => {
    regenerate();
  }, [regenerate]);

  const handleStartOver = useCallback(() => {
    resetSelections();
    resetRec();
  }, [resetSelections, resetRec]);

  return (
    <div className={styles.page}>
      <AnimatePresence mode="wait">
        {preRecommendShown && (
          <motion.div
            className={styles.preRecommend}
            key="pre-recommend"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -20, transition: { duration: 0.25, ease: [0.55, 0, 1, 0.45] } }}
          >
            <motion.h1
              className={styles.wordmark}
              initial={hasSeenWordmark ? false : { opacity: 0, y: -16, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: hasSeenWordmark ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              UNBORED
            </motion.h1>
            <motion.p
              className={styles.tagline}
              initial={hasSeenWordmark ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: hasSeenWordmark ? 0 : 0.15, duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
            >
              One tap. One perfect pick.
            </motion.p>

            <div className={styles.aiBanner}>
              <AIStatusBanner />
            </div>

            <MoodSelector
              selectedMood={selectedMood}
              onMoodSelect={setMood}
              isReturning={hasVisitedHome}
            />

            <AnimatePresence>
              {showMoodPrompt && selectedMood === null && (
                <motion.p
                  className={styles.moodPrompt}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3 }}
                >
                  How are you feeling?
                </motion.p>
              )}
            </AnimatePresence>

            <div className={styles.timeSection}>
              <TimeSelector selectedSlot={selectedTimeSlot} onSelect={setTimeSlot} />
            </div>

            <div className={styles.mediaSection}>
              <MediaTypeSelector selected={selectedMediaType} onSelect={setMediaType} />
            </div>

            <OracleButton
              disabled={!canRecommend}
              loading={isLoading}
              onClick={handleOracleClick}
            />

            <AnimatePresence>
              {isError && (
                <motion.div
                  className={styles.errorBlock}
                  role="alert"
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  transition={{ duration: 0.3 }}
                >
                  <p className={styles.errorText}>{mapRecError(recError ?? "")}</p>
                  <button className={styles.retryBtn} onClick={handleRetry}>
                    Try again
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {postRecommendShown && (
          <motion.div
            className={styles.postRecommend}
            key="post-recommend"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <RevealOracle onRegenerate={handleRegenerate} onStartOver={handleStartOver} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
