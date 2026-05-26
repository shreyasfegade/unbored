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

  const buttonVariant = {
    initial: { opacity: 0, y: 16 },
    animate: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: 0.3 + i * 0.06,
        duration: 0.3,
        ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number],
      },
    }),
  };

  return (
    <motion.div className={styles.actions}>
      <motion.button
        className={styles.regenerate}
        onClick={onRegenerate}
        disabled={isRegenerating}
        variants={buttonVariant}
        initial={prefersReduced ? false : "initial"}
        animate="animate"
        custom={0}
        whileHover={!isRegenerating && !prefersReduced ? { scale: 1.03 } : {}}
        whileTap={!isRegenerating && !prefersReduced ? { scale: 0.96 } : {}}
      >
        {isRegenerating ? "Finding another..." : "Not feeling it"}
      </motion.button>
      {watchUrl && (
        <motion.a
          className={styles.watchLink}
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          variants={buttonVariant}
          initial={prefersReduced ? false : "initial"}
          animate="animate"
          custom={1}
          whileHover={!prefersReduced ? { scale: 1.03 } : {}}
          whileTap={!prefersReduced ? { scale: 0.96 } : {}}
        >
          Where to watch →
        </motion.a>
      )}
      <motion.button
        className={styles.startOver}
        onClick={onStartOver}
        disabled={isRegenerating}
        variants={buttonVariant}
        initial={prefersReduced ? false : "initial"}
        animate="animate"
        custom={watchUrl ? 2 : 1}
        whileHover={!isRegenerating && !prefersReduced ? { scale: 1.03 } : {}}
        whileTap={!isRegenerating && !prefersReduced ? { scale: 0.96 } : {}}
      >
        Start over
      </motion.button>
      <motion.div
        variants={buttonVariant}
        initial={prefersReduced ? false : "initial"}
        animate="animate"
        custom={watchUrl ? 3 : 2}
      >
        <Link to="/enrich" className={styles.enrichLink}>
          Tune your taste
        </Link>
      </motion.div>
    </motion.div>
  );
}
