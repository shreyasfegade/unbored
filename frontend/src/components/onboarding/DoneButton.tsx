import { motion, AnimatePresence } from 'framer-motion';
import styles from './DoneButton.module.css';

interface DoneButtonProps {
  visible: boolean;
  onClick: () => void;
  loading: boolean;
}

export default function DoneButton({ visible, onClick, loading }: DoneButtonProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          className={styles.button}
          onClick={onClick}
          disabled={loading}
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        >
          {loading ? 'Building...' : "Done, let's go"}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
