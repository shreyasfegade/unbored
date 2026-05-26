import { motion, AnimatePresence } from 'framer-motion';
import styles from './SelectionCounter.module.css';

interface SelectionCounterProps {
  current: number;
  target: number;
}

export default function SelectionCounter({ current, target }: SelectionCounterProps) {
  const isComplete = current >= target;

  return (
    <div className={styles.counter}>
      <p className={`${styles.text} ${isComplete ? styles.textComplete : ''}`}>
        <AnimatePresence mode="wait">
          <motion.span
            key={current}
            className={styles.number}
            initial={{ y: -16, opacity: 0, scale: 0.6 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, scale: 0.6 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22, mass: 0.5 }}
          >
            {current}
          </motion.span>
        </AnimatePresence>
        {' '}of {target} selected
      </p>
      <div className={styles.dots}>
        {Array.from({ length: target }).map((_, i) => (
          <motion.div
            key={i}
            className={`${styles.dot} ${i < current ? styles.dotFilled : ''}`}
            initial={false}
            animate={
              i < current
                ? { scale: [1, 1.4, 1], transition: { duration: 0.3, ease: "easeOut" } }
                : { scale: 1 }
            }
            transition={{ delay: 0.05 }}
          />
        ))}
      </div>
      {isComplete && (
        <motion.p
          className={styles.ready}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          Ready when you are.
        </motion.p>
      )}
    </div>
  );
}
