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
  const { phase, takingLonger } = useRevealAnimation();
  const primary = useRecommendationStore((s) => s.primary);
  const alternates = useRecommendationStore((s) => s.alternates);
  const rationale = useRecommendationStore((s) => s.rationale);
  const pickedBy = useRecommendationStore((s) => s.pickedBy);
  const provider = useRecommendationStore((s) => s.provider);
  const confidence = useRecommendationStore((s) => s.confidence);
  const swapAlternate = useRecommendationStore((s) => s.swapAlternate);
  const addToast = useToastStore((s) => s.addToast);

  const handleAlternateSwap = (index: number) => {
    swapAlternate(index);
    addToast("Swapped to alternate pick.");
  };

  const isScanning = phase === "scanning";
  const showRevealed = phase === "revealing" || phase === "info_cascade" || phase === "complete";
  const showInfo = phase === "info_cascade" || phase === "complete";

  return (
    <div className={styles.container} aria-live="polite" aria-atomic="true">
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

      <AnimatePresence mode="wait">
        {isScanning && <ScanningPhase key="scanning" takingLonger={takingLonger} />}

        {showRevealed && primary && (
          <motion.div
            key={primary.media.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            className={styles.revealed}
          >
            <PosterReveal item={primary.media} />

            {showInfo && confidence && (
              <InfoCascade
                primary={primary}
                confidence={confidence}
                rationale={rationale}
                pickedBy={pickedBy}
                provider={provider}
                alternates={alternates}
                onAlternateSelect={handleAlternateSwap}
                onRegenerate={onRegenerate}
                onStartOver={onStartOver}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
