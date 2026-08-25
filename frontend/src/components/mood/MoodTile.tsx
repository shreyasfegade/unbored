import { forwardRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { MoodType } from "../../types/mood";
import type { MoodConfig } from "../../config/moodData";
import { SPRING, pressable } from "../../config/motion";
import styles from "./MoodTile.module.css";

interface MoodTileProps {
  mood: MoodConfig;
  isSelected: boolean;
  onSelect: (moodId: MoodType) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  index: number;
  skipEntrance?: boolean;
  tabbable?: boolean;
}

export const MoodTile = forwardRef<HTMLButtonElement, MoodTileProps>(
  function MoodTile({ mood, isSelected, onSelect, onKeyDown, index, skipEntrance = false, tabbable = false }, ref) {
    const prefersReduced = useReducedMotion();

    return (
      <motion.button
        ref={ref}
        className={`${styles.tile} ${isSelected ? styles.selected : ""}`}
        style={{
          "--mood-color": mood.color,
          "--mood-glow": `${mood.color}33`,
        } as React.CSSProperties}
        onClick={() => onSelect(mood.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(mood.id);
          }
          onKeyDown?.(e);
        }}
        role="radio"
        aria-checked={isSelected}
        tabIndex={tabbable ? 0 : -1}
        aria-label={`${mood.label} — ${mood.description}`}
        title={mood.description}
        initial={prefersReduced || skipEntrance ? false : { opacity: 0, y: 16, scale: 0.94 }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
          transition: skipEntrance ? { duration: 0 } : { ...SPRING.snappy, delay: 0.12 + index * 0.04 },
        }}
        whileHover={pressable.whileHover}
        whileTap={pressable.whileTap}
        transition={SPRING.snappy}
      >
        <span className={styles.icon} aria-hidden="true">{mood.icon}</span>
        <span className={styles.label}>{mood.label}</span>
        {isSelected && (
          <motion.span
            className={styles.checkmark}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 25, mass: 0.4 }}
          >
            ✓
          </motion.span>
        )}
      </motion.button>
    );
  }
);
