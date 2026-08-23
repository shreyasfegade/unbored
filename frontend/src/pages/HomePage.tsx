import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useUIStore } from "../stores/uiStore";
import { useRecommendationStore } from "../stores/recommendationStore";
import { useTasteStore } from "../stores/tasteStore";
import { useToastStore } from "../stores/toastStore";
import { useRecommendation } from "../hooks/useRecommendation";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { MoodSelector } from "../components/mood";
import { TimeSelector } from "../components/ui/TimeSelector";
import { MediaTypeSelector } from "../components/ui/MediaTypeSelector";
import { EraSelector } from "../components/ui/EraSelector";
import { OracleButton } from "../components/ui/OracleButton";
import { RevealOracle } from "../components/reveal";
import { AIStatusBanner } from "../components/llm/AIStatusBanner";
import styles from "./HomePage.module.css";

const WORDMARK_ANIMATED_KEY = "unbored-home-wordmark-animated";
const HOME_VISITED_KEY = "unbored-home-visited";

export default function HomePage() {
  const selectedMood = useUIStore((s) => s.selectedMood);
  const selectedTimeSlot = useUIStore((s) => s.selectedTimeSlot);
  const selectedMediaType = useUIStore((s) => s.selectedMediaType);
  const selectedEra = useUIStore((s) => s.selectedEra);
  const showMoodPrompt = useUIStore((s) => s.showMoodPrompt);
  const setMood = useUIStore((s) => s.setMood);
  const setTimeSlot = useUIStore((s) => s.setTimeSlot);
  const setMediaType = useUIStore((s) => s.setMediaType);
  const setEra = useUIStore((s) => s.setEra);
  const setShowMoodPrompt = useUIStore((s) => s.setShowMoodPrompt);
  const resetSelections = useUIStore((s) => s.resetSelections);

  const resetRec = useRecommendationStore((s) => s.reset);
  const recStatus = useRecommendationStore((s) => s.status);
  const recError = useRecommendationStore((s) => s.error);

  const hasCompletedOnboarding = useTasteStore((s) => s.hasCompletedOnboarding);
  const favouriteCount = useTasteStore((s) => s.favouriteIds.length);
  const addToast = useToastStore((s) => s.addToast);
  const { recommend, regenerate } = useRecommendation();

  // Read the once-per-session animation flags in state initialisers (pure) and
  // write them in an effect — never mutate storage during render.
  const [hasSeenWordmark] = useState(() => sessionStorage.getItem(WORDMARK_ANIMATED_KEY) !== null);
  const [hasVisitedHome] = useState(() => sessionStorage.getItem(HOME_VISITED_KEY) !== null);
  useEffect(() => {
    sessionStorage.setItem(WORDMARK_ANIMATED_KEY, "1");
    sessionStorage.setItem(HOME_VISITED_KEY, "1");
  }, []);

  useEffect(() => {
    const count = sessionStorage.getItem("unbored-enrich-success");
    if (count) {
      sessionStorage.removeItem("unbored-enrich-success");
      addToast(`Taste updated with ${count} item${count === "1" ? "" : "s"}.`);
    }
  }, [addToast]);

  // Back button: while a pick is on screen, push one history entry so the
  // browser/OS Back gesture returns to the selection screen instead of leaving
  // the site entirely (the reveal is state, not a route).
  useEffect(() => {
    if (recStatus !== "revealed") return;
    if (!window.history.state?.unboredReveal) {
      window.history.pushState({ unboredReveal: true }, "");
    }
    const onPop = () => resetRec();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [recStatus, resetRec]);

  const canRecommend = selectedMood !== null && selectedTimeSlot !== null;
  const isLoading = recStatus === "loading" || recStatus === "regenerating";
  const isError = recStatus === "error";
  const preRecommendShown =
    (recStatus === "idle" || recStatus === "error") && hasCompletedOnboarding;
  const postRecommendShown =
    (recStatus === "revealed" || recStatus === "loading" || recStatus === "regenerating") &&
    hasCompletedOnboarding;

  // What's blocking the button, so the disabled state is never a mystery.
  const missingHint = !selectedMood
    ? "Pick a mood to continue"
    : !selectedTimeSlot
      ? "Choose how much time you have"
      : null;

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
      <>
        {preRecommendShown && (
          <motion.div
            className={styles.preRecommend}
            key="pre-recommend"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
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
              Answer two quick questions and we'll hand you one perfect pick.
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

            <div className={styles.mediaSection}>
              <EraSelector selected={selectedEra} onSelect={setEra} />
            </div>

            <div className={styles.oracleWrap}>
              <OracleButton
                disabled={!canRecommend}
                loading={isLoading}
                onClick={handleOracleClick}
                label="Find my pick"
              />
              {!canRecommend && missingHint && (
                <p className={styles.missingHint}>{missingHint}</p>
              )}
            </div>

            <Link to="/enrich" className={styles.tasteLink}>
              <span aria-hidden="true">✎</span> Tune your taste
              {favouriteCount > 0 && <span className={styles.tasteCount}>{favouriteCount} saved</span>}
            </Link>

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
                  <p className={styles.errorText}>{recError ?? "Something went wrong. Try again."}</p>
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
          >
            <ErrorBoundary label="reveal" onReset={handleStartOver}>
              <RevealOracle onRegenerate={handleRegenerate} onStartOver={handleStartOver} />
            </ErrorBoundary>
          </motion.div>
        )}
      </>
    </div>
  );
}
