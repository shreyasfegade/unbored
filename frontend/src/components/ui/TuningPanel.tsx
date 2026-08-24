import { useState } from "react";
import { motion } from "framer-motion";
import { usePreferencesStore, isNeutralTuning, type TuningAxis } from "../../stores/preferencesStore";
import styles from "./TuningPanel.module.css";

interface Axis {
  key: TuningAxis;
  left: string;
  right: string;
}

// Positive is always the right-hand word, matching the backend's sign.
const AXES: Axis[] = [
  { key: "adventurous", left: "Familiar", right: "Adventurous" },
  { key: "obscurity", left: "Crowd-pleasers", right: "Hidden gems" },
  { key: "acclaim", left: "Anything goes", right: "Acclaimed" },
  { key: "freshness", left: "Timeless", right: "Fresh" },
];

/**
 * A collapsible panel of four sliders that bias what a pick optimises for. Every
 * axis defaults to the centre (0), which is a true no-op on the server, so a
 * user who never opens this gets exactly the untuned recommendation.
 */
export default function TuningPanel() {
  const tuning = usePreferencesStore((s) => s.tuning);
  const setTuning = usePreferencesStore((s) => s.setTuning);
  const resetTuning = usePreferencesStore((s) => s.resetTuning);
  const [open, setOpen] = useState(false);

  const tuned = !isNeutralTuning(tuning);

  return (
    <div className={styles.panel}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span aria-hidden="true">⚙</span> Fine-tune
        {tuned && <span className={styles.dot} aria-label="active" />}
        <span className={styles.chevron} data-open={open} aria-hidden="true">⌄</span>
      </button>

      {open && (
        <motion.div
          className={styles.body}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          transition={{ duration: 0.25 }}
        >
          {AXES.map((axis) => (
            <div key={axis.key} className={styles.axis}>
              <div className={styles.labels}>
                <span>{axis.left}</span>
                <span>{axis.right}</span>
              </div>
              <input
                type="range"
                className={styles.slider}
                min={-1}
                max={1}
                step={0.25}
                value={tuning[axis.key]}
                onChange={(e) => setTuning(axis.key, Number(e.target.value))}
                aria-label={`${axis.left} to ${axis.right}`}
              />
            </div>
          ))}
          <button type="button" className={styles.reset} onClick={resetTuning} disabled={!tuned}>
            Reset to balanced
          </button>
        </motion.div>
      )}
    </div>
  );
}
