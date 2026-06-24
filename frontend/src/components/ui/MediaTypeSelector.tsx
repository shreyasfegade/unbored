import { motion } from "framer-motion";
import type { MediaTypeChoice } from "../../types/recommendation";
import styles from "./MediaTypeSelector.module.css";

const OPTIONS: { value: MediaTypeChoice; label: string; icon: string }[] = [
  { value: "surprise", label: "Surprise me", icon: "✦" },
  { value: "movie", label: "Movie", icon: "🎬" },
  { value: "tv", label: "TV", icon: "📺" },
  { value: "anime", label: "Anime", icon: "🌸" },
];

interface MediaTypeSelectorProps {
  selected: MediaTypeChoice;
  onSelect: (value: MediaTypeChoice) => void;
}

export function MediaTypeSelector({ selected, onSelect }: MediaTypeSelectorProps) {
  return (
    <div className={styles.row} role="radiogroup" aria-label="What do you want to watch?">
      {OPTIONS.map((opt) => (
        <motion.button
          key={opt.value}
          role="radio"
          aria-checked={selected === opt.value}
          className={`${styles.pill} ${selected === opt.value ? styles.active : ""}`}
          onClick={() => onSelect(opt.value)}
          whileTap={{ scale: 0.95 }}
        >
          <span className={styles.icon} aria-hidden="true">{opt.icon}</span>
          {opt.label}
        </motion.button>
      ))}
    </div>
  );
}
