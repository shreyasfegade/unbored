import { motion, useReducedMotion } from "framer-motion";
import styles from "./OracleButton.module.css";

interface OracleButtonProps {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}

export function OracleButton({ disabled, loading, onClick }: OracleButtonProps) {
  const prefersReduced = useReducedMotion();

  return (
    <motion.button
      className={`${styles.button} ${loading ? styles.loading : ""}`}
      disabled={disabled}
      onClick={onClick}
      initial={prefersReduced ? false : { opacity: 0, y: 20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        delay: 0.6,
        type: "spring",
        stiffness: 300,
        damping: 22,
        mass: 0.9,
      }}
      whileHover={!disabled && !loading && !prefersReduced ? { scale: 1.04 } : {}}
      whileTap={!disabled && !loading && !prefersReduced ? { scale: 0.96 } : {}}
    >
      {loading ? (
        <span className={styles.scanningLabel}>
          <span className={styles.scanningLetter}>S</span>
          <span className={styles.scanningLetter}>c</span>
          <span className={styles.scanningLetter}>a</span>
          <span className={styles.scanningLetter}>n</span>
          <span className={styles.scanningLetter}>n</span>
          <span className={styles.scanningLetter}>i</span>
          <span className={styles.scanningLetter}>n</span>
          <span className={styles.scanningLetter}>g</span>
          <span className={styles.dot1}>.</span>
          <span className={styles.dot2}>.</span>
          <span className={styles.dot3}>.</span>
        </span>
      ) : (
        <span>Just decide for me.</span>
      )}
    </motion.button>
  );
}
