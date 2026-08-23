import { motion } from "framer-motion";
import type { EraPreference } from "../../types/recommendation";
import styles from "./MediaTypeSelector.module.css";

const OPTIONS: { value: EraPreference; label: string }[] = [
  { value: "modern", label: "Modern" },
  { value: "any", label: "Any era" },
  { value: "classic", label: "Classics" },
];

interface EraSelectorProps {
  selected: EraPreference;
  onSelect: (value: EraPreference) => void;
}

/** Lets the user bias recommendations toward recent or older titles — the
 *  "I prefer modern movies" control the engine previously had no signal for. */
export function EraSelector({ selected, onSelect }: EraSelectorProps) {
  return (
    <div className={styles.section}>
      <p className={styles.prompt} id="era-label">
        Era
        <span className={styles.optional}>optional</span>
      </p>
      <div className={styles.row} role="radiogroup" aria-labelledby="era-label">
        {OPTIONS.map((opt) => (
          <motion.button
            key={opt.value}
            role="radio"
            aria-checked={selected === opt.value}
            className={`${styles.pill} ${selected === opt.value ? styles.active : ""}`}
            onClick={() => onSelect(opt.value)}
            whileTap={{ scale: 0.95 }}
          >
            {opt.label}
          </motion.button>
        ))}
      </div>
    </div>
  );
}
