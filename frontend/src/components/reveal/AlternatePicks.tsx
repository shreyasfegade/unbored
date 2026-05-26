import { motion, useReducedMotion } from "framer-motion";
import type { ScoredMediaItem } from "../../types/recommendation";
import styles from "./AlternatePicks.module.css";

interface AlternatePicksProps {
  alternates: ScoredMediaItem[];
  onSelect: (index: number) => void;
}

export function AlternatePicks({ alternates, onSelect }: AlternatePicksProps) {
  const prefersReduced = useReducedMotion();

  if (alternates.length === 0) return null;

  return (
    <div className={styles.row}>
      {alternates.map((alt, i) => (
        <motion.button
          key={alt.media.id}
          className={styles.card}
          onClick={() => onSelect(i)}
          initial={prefersReduced ? false : { opacity: 0, y: 20, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            delay: 0.15 + i * 0.08,
            type: "spring",
            stiffness: 350,
            damping: 26,
            mass: 0.7,
          }}
          whileHover={prefersReduced ? {} : { scale: 1.05, y: -4 }}
          whileTap={prefersReduced ? {} : { scale: 0.95 }}
        >
          {alt.media.poster_path && (
            <img
              src={alt.media.poster_path}
              alt={alt.media.title}
              className={styles.poster}
              loading="lazy"
              width={120}
              height={180}
            />
          )}
          <p className={styles.title}>{alt.media.title}</p>
          <motion.p
            className={styles.score}
            initial={prefersReduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 + i * 0.08, duration: 0.3 }}
          >
            {Math.round(alt.score * 100)}% match
          </motion.p>
        </motion.button>
      ))}
    </div>
  );
}
