import { useCallback, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { TimeSlot } from "../../types/mood";
import { TIME_SLOT_DISPLAY_LABELS } from "../../types/mood";
import styles from "./TimeSelector.module.css";

interface TimeSelectorProps {
  selectedSlot: TimeSlot | null;
  onSelect: (slot: TimeSlot) => void;
}

const TIME_OPTIONS: TimeSlot[] = ["short", "medium", "long"];

export function TimeSelector({ selectedSlot, onSelect }: TimeSelectorProps) {
  const prefersReduced = useReducedMotion();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      let nextIndex: number | null = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = (index + 1) % TIME_OPTIONS.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex = (index - 1 + TIME_OPTIONS.length) % TIME_OPTIONS.length;
      }
      if (nextIndex !== null) {
        refs.current[nextIndex]?.focus();
        onSelect(TIME_OPTIONS[nextIndex]);
      }
    },
    [onSelect]
  );

  return (
    <div className={styles.row} role="radiogroup" aria-label="How much time do you have?">
      {TIME_OPTIONS.map((slot, index) => (
        <motion.button
          key={slot}
          ref={(el) => { refs.current[index] = el; }}
          className={`${styles.pill} ${selectedSlot === slot ? styles.selected : ""}`}
          onClick={() => onSelect(slot)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          role="radio"
          aria-checked={selectedSlot === slot}
          tabIndex={selectedSlot === slot ? 0 : -1}
          initial={prefersReduced ? false : { opacity: 0, y: 12, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            delay: 0.3 + index * 0.06,
            type: "spring",
            stiffness: 400,
            damping: 28,
            mass: 0.6,
          }}
          whileHover={prefersReduced ? {} : { scale: 1.04 }}
          whileTap={prefersReduced ? {} : { scale: 0.95 }}
        >
          {TIME_SLOT_DISPLAY_LABELS[slot]}
        </motion.button>
      ))}
    </div>
  );
}
