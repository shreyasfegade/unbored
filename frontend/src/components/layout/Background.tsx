import { motion, useReducedMotion } from "framer-motion";
import styles from "./Background.module.css";

/**
 * Ambient cinematic background: deep base gradient with a few large, soft,
 * slowly-drifting colour blooms, a film-grain texture, and an edge vignette.
 * Gives every screen depth and warmth without needing foreground imagery.
 */
export default function Background() {
  const prefersReduced = useReducedMotion();

  const blooms = [
    { className: styles.bloomGold, x: [0, 40, -20, 0], y: [0, -30, 20, 0], duration: 26 },
    { className: styles.bloomEmber, x: [0, -50, 30, 0], y: [0, 25, -15, 0], duration: 32 },
    { className: styles.bloomCool, x: [0, 30, -40, 0], y: [0, -20, 30, 0], duration: 38 },
  ];

  return (
    <div className={styles.background} aria-hidden="true">
      <div className={styles.base} />
      {blooms.map((b, i) => (
        <motion.div
          key={i}
          className={`${styles.bloom} ${b.className}`}
          animate={prefersReduced ? {} : { x: b.x, y: b.y }}
          transition={
            prefersReduced
              ? { duration: 0 }
              : { duration: b.duration, repeat: Infinity, ease: "easeInOut" }
          }
        />
      ))}
      <div className={styles.grain} />
      <div className={styles.vignette} />
    </div>
  );
}
