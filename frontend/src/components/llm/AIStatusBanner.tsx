import { Link } from "react-router-dom";
import { useLlmStore } from "../../stores/llmStore";
import styles from "./AIStatusBanner.module.css";

/** Prominent (not hidden) signal of whether AI picks are on, with a clear path
 *  to connect a key — the core of the product's value. */
export function AIStatusBanner() {
  const connected = useLlmStore((s) => s.validated);
  const provider = useLlmStore((s) => s.provider);

  if (connected) {
    return (
      <Link to="/settings" className={styles.on} title="Manage your AI connection">
        <span className={styles.dot} />
        AI picks on · <span className={styles.provider}>{provider}</span>
      </Link>
    );
  }

  return (
    <Link to="/settings" className={styles.off}>
      <span className={styles.spark} aria-hidden="true">✦</span>
      Bring your Gemini or DeepSeek key for AI-chosen picks
      <span className={styles.arrow} aria-hidden="true">→</span>
    </Link>
  );
}
