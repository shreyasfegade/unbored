import { AnimatePresence, motion } from "framer-motion";
import { useRevealAnimation } from "../../hooks/useRevealAnimation";
import { useRecommendationStore } from "../../stores/recommendationStore";
import { useToastStore } from "../../stores/toastStore";
import { ScanningPhase } from "./ScanningPhase";
import { PosterReveal } from "./PosterReveal";
import { InfoCascade } from "./InfoCascade";
import styles from "./RevealOracle.module.css";

interface RevealOracleProps {
  onRegenerate: () => void;
  onStartOver: () => void;
}

export function RevealOracle({ onRegenerate, onStartOver }: RevealOracleProps) {
  const { phase, waitStage } = useRevealAnimation();
  const primary = useRecommendationStore((s) => s.primary);
  const alternates = useRecommendationStore((s) => s.alternates);
  const rationale = useRecommendationStore((s) => s.rationale);
  const pickedBy = useRecommendationStore((s) => s.pickedBy);
  const provider = useRecommendationStore((s) => s.provider);
  const confidence = useRecommendationStore((s) => s.confidence);
  const aiStatus = useRecommendationStore((s) => s.aiStatus);
  const mediaTypeApplied = useRecommendationStore((s) => s.mediaTypeApplied);
  const swapAlternate = useRecommendationStore((s) => s.swapAlternate);
  const addToast = useToastStore((s) => s.addToast);

  const handleAlternateSwap = (index: number) => {
    swapAlternate(index);
    addToast("Swapped to alternate pick.");
  };

  const isScanning = phase === "scanning";
  const showRevealed = phase === "revealing" || phase === "info_cascade" || phase === "complete";
  const showInfo = phase === "info_cascade" || phase === "complete";

  // Degenerate state: we're past scanning but there's no pick to show. Rather
  // than render a blank screen, offer a way out.
  if (showRevealed && !primary) {
    return (
      <div className={styles.container}>
        <p style={{ textAlign: "center", color: "var(--color-text-secondary)" }}>
          Couldn't load that pick.
        </p>
        <div style={{ textAlign: "center", marginTop: "var(--space-4)" }}>
          <button className={styles.retry} onClick={onStartOver}>Start over</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* A dedicated, tiny live region announces the outcome once, instead of
          re-reading the whole card on every one of the ~11 staggered changes. */}
      <p className={styles.srStatus} aria-live="polite">
        {showInfo && primary
          ? `Your pick: ${primary.media.title}${primary.media.release_year ? `, ${primary.media.release_year}` : ""}${confidence ? `, ${confidence} confidence` : ""}.`
          : isScanning
            ? "Finding your pick…"
            : ""}
      </p>
      <AnimatePresence>
        {showRevealed && primary?.media.backdrop_path && (
          <motion.div
            key={`backdrop-${primary.media.id}`}
            className={styles.backdrop}
            style={{ backgroundImage: `url(${primary.media.backdrop_path})` }}
            initial={{ opacity: 0, scale: 1.15 }}
            animate={{ opacity: 1, scale: 1.04 }}
            exit={{ opacity: 0, transition: { duration: 0.25 } }}
            transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
      </AnimatePresence>

      {/* No AnimatePresence here: gating the pick behind the scanning phase's
          exit animation means a stalled animation hides the result entirely. */}
      <>
        {isScanning && <ScanningPhase key="scanning" waitStage={waitStage} />}

        {showRevealed && primary && (
          <motion.div
            key={primary.media.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={styles.revealed}
          >
            <PosterReveal item={primary.media} />

            {showInfo && (
              <InfoCascade
                primary={primary}
                confidence={confidence}
                rationale={rationale}
                pickedBy={pickedBy}
                provider={provider}
                aiStatus={aiStatus}
                mediaTypeApplied={mediaTypeApplied}
                alternates={alternates}
                onAlternateSelect={handleAlternateSwap}
                onRegenerate={onRegenerate}
                onStartOver={onStartOver}
              />
            )}
          </motion.div>
        )}
      </>
    </div>
  );
}
