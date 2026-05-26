import { motion } from "framer-motion";
import type { ConfidenceLevel } from "../../types/mood";
import styles from "./ConfidenceBadge.module.css";

interface ConfidenceBadgeProps {
  level: ConfidenceLevel;
}

const CONFIDENCE_DISPLAY: Record<ConfidenceLevel, string> = {
  high: "High confidence pick.",
  strong: "Unusually strong match tonight.",
  moderate: "Best fit right now.",
};

export function ConfidenceBadge({ level }: ConfidenceBadgeProps) {
  return (
    <motion.div
      className={styles.badge}
      initial={{ opacity: 0, scale: 0.9, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay: 0.1, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <motion.span
        className={styles.dot}
        animate={{ opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      />
      <span>{CONFIDENCE_DISPLAY[level]}</span>
    </motion.div>
  );
}
