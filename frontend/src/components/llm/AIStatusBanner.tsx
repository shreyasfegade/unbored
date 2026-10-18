import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAiTierStore } from "../../stores/aiTierStore";
import { useLlmStore } from "../../stores/llmStore";
import styles from "./AIStatusBanner.module.css";

/** Prominent (not hidden) signal of whether AI picks are on, and whose AI:
 *  the visitor's own key, the deployment's shared free tier, or none. */
export function AIStatusBanner() {
  const connected = useLlmStore((s) => s.validated);
  const provider = useLlmStore((s) => s.provider);
  const freeTier = useAiTierStore((s) => s.freeTier);
  const remaining = useAiTierStore((s) => s.remaining);
  const load = useAiTierStore((s) => s.load);

  useEffect(() => {
    if (!connected) void load();
  }, [connected, load]);

  if (connected) {
    return (
      <Link to="/settings" className={styles.on} title="Manage your AI connection">
        <span className={styles.dot} />
        AI picks on · <span className={styles.provider}>{provider}</span>, your key
      </Link>
    );
  }

  if (freeTier && remaining !== 0) {
    return (
      <Link to="/settings" className={styles.on} title="Use your own key for unlimited AI picks">
        <span className={styles.dot} />
        AI picks on · free tier
        {remaining !== null && <span className={styles.count}>{remaining} left today</span>}
      </Link>
    );
  }

  return (
    <Link to="/settings" className={styles.off}>
      <span className={styles.spark} aria-hidden="true">✦</span>
      {freeTier
        ? "Free AI picks are used up for today. Bring your own key for more"
        : "Bring your Gemini or DeepSeek key for AI-chosen picks"}
      <span className={styles.arrow} aria-hidden="true">→</span>
    </Link>
  );
}
