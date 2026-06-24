import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import styles from "./UpgradePrompt.module.css";

/** Shown after an engine-only pick. The engine is the fallback; AI picks chosen
 *  for you are the real product — this makes that unmistakable. */
export function UpgradePrompt() {
  return (
    <motion.div
      className={styles.card}
      variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } }}
      transition={{ duration: 0.5 }}
    >
      <span className={styles.spark} aria-hidden="true">✦</span>
      <div className={styles.body}>
        <p className={styles.title}>This was the built-in engine.</p>
        <p className={styles.sub}>
          Connect your own Gemini or DeepSeek key and the AI chooses and explains your pick,
          grounded in what you love — that's the real Unbored.
        </p>
      </div>
      <Link to="/settings" className={styles.cta}>Connect AI →</Link>
    </motion.div>
  );
}
