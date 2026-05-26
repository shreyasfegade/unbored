import { useCallback, useRef } from "react";
import type { MoodType } from "../../types/mood";
import type { MoodConfig } from "../../config/moodData";
import { MOOD_CONFIGS } from "../../config/moodData";
import { MoodTile } from "./MoodTile";
import styles from "./MoodSelector.module.css";

interface MoodSelectorProps {
  selectedMood: MoodType | null;
  onMoodSelect: (mood: MoodType) => void;
  isReturning?: boolean;
}

export function MoodSelector({ selectedMood, onMoodSelect, isReturning = false }: MoodSelectorProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      let nextIndex: number | null = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = (index + 1) % MOOD_CONFIGS.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex = (index - 1 + MOOD_CONFIGS.length) % MOOD_CONFIGS.length;
      }
      if (nextIndex !== null) {
        refs.current[nextIndex]?.focus();
        onMoodSelect(MOOD_CONFIGS[nextIndex].id);
      }
    },
    [onMoodSelect]
  );

  return (
    <div className={styles.grid} role="radiogroup" aria-label="Select your mood">
      {MOOD_CONFIGS.map((mood: MoodConfig, index: number) => (
        <MoodTile
          key={mood.id}
          ref={(el) => { refs.current[index] = el; }}
          mood={mood}
          isSelected={selectedMood === mood.id}
          onSelect={onMoodSelect}
          onKeyDown={(e) => handleKeyDown(e, index)}
          index={index}
          skipEntrance={isReturning}
        />
      ))}
    </div>
  );
}
