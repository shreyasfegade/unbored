import { motion, useReducedMotion } from "framer-motion";
import { SPRING, pressableFlat } from "../../config/motion";
import styles from "./OracleButton.module.css";

interface OracleButtonProps {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
  label?: string;
}

export function OracleButton({ disabled, loading, onClick, label = "Find my pick" }: OracleButtonProps) {
  const prefersReduced = useReducedMotion();

  return (
    <motion.button
      className={`${styles.button} ${loading ? styles.loading : ""}`}
      disabled={disabled || loading}
      onClick={onClick}
      initial={prefersReduced ? false : { opacity: 0, y: 18, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { ...SPRING.gentle, delay: 0.5 } }}
      whileHover={!disabled && !loading ? pressableFlat.whileHover : {}}
      whileTap={!disabled && !loading ? pressableFlat.whileTap : {}}
      transition={SPRING.snappy}
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
        <span>{label}</span>
      )}
    </motion.button>
  );
}
