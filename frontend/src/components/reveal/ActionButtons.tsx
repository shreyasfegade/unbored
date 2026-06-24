import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { useRecommendationStore } from "../../stores/recommendationStore";
import styles from "./ActionButtons.module.css";

interface ActionButtonsProps {
  onRegenerate: () => void;
  onStartOver: () => void;
  watchUrl: string | null;
}

export function ActionButtons({ onRegenerate, onStartOver, watchUrl }: ActionButtonsProps) {
  const prefersReduced = useReducedMotion();
  const recStatus = useRecommendationStore((s) => s.status);
  const isRegenerating = recStatus === "regenerating";

  const row = {
    initial: { opacity: 0, y: 16 },
    animate: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { delay: 0.3 + i * 0.07, duration: 0.3, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] },
    }),
  };

  return (
    <div className={styles.actions}>
      {watchUrl && (
        <motion.a
          className={styles.watch}
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          variants={row}
          initial={prefersReduced ? false : "initial"}
          animate="animate"
          custom={0}
          whileHover={prefersReduced ? {} : { scale: 1.02 }}
          whileTap={prefersReduced ? {} : { scale: 0.97 }}
        >
          <span className={styles.play} aria-hidden="true">▶</span> Where to watch
        </motion.a>
      )}

      <motion.button
        className={styles.regenerate}
        onClick={onRegenerate}
        disabled={isRegenerating}
        variants={row}
        initial={prefersReduced ? false : "initial"}
        animate="animate"
        custom={1}
        whileHover={!isRegenerating && !prefersReduced ? { scale: 1.02 } : {}}
        whileTap={!isRegenerating && !prefersReduced ? { scale: 0.97 } : {}}
      >
        {isRegenerating ? "Finding another…" : "Not feeling it — try again"}
      </motion.button>

      <motion.div
        className={styles.minor}
        variants={row}
        initial={prefersReduced ? false : "initial"}
        animate="animate"
        custom={2}
      >
        <button className={styles.link} onClick={onStartOver} disabled={isRegenerating}>
          Start over
        </button>
        <span className={styles.dot} aria-hidden="true">·</span>
        <Link to="/enrich" className={styles.link}>Tune your taste</Link>
      </motion.div>
    </div>
  );
}
