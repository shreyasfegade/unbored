import { forwardRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { MoodType } from "../../types/mood";
import type { MoodConfig } from "../../config/moodData";
import styles from "./MoodTile.module.css";

interface MoodTileProps {
  mood: MoodConfig;
  isSelected: boolean;
  onSelect: (moodId: MoodType) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  index: number;
  skipEntrance?: boolean;
}

export const MoodTile = forwardRef<HTMLButtonElement, MoodTileProps>(
  function MoodTile({ mood, isSelected, onSelect, onKeyDown, index, skipEntrance = false }, ref) {
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
        tabIndex={isSelected ? 0 : -1}
        aria-label={`${mood.label} — ${mood.description}`}
        title={mood.description}
        initial={prefersReduced || skipEntrance ? false : { opacity: 0, y: 20, scale: 0.92 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={skipEntrance ? {} : {
          delay: 0.15 + index * 0.04,
          stiffness: 400,
          damping: 28,
          mass: 0.7,
        }}
        whileHover={prefersReduced ? {} : { scale: 1.05 }}
        whileTap={prefersReduced ? {} : { scale: 0.95 }}
      >
        <span className={styles.icon}>{mood.icon}</span>
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
