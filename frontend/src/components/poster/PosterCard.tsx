import { motion } from 'framer-motion';
import type { MediaItem } from '../../types/media';
import styles from './PosterCard.module.css';

interface PosterCardProps {
  item: MediaItem;
  isSelected: boolean;
  onToggle: (item: MediaItem) => void;
  disabled?: boolean;
  index?: number;
}

export default function PosterCard({ item, isSelected, onToggle, disabled, index = 0 }: PosterCardProps) {
  const handleClick = () => {
    if (!disabled) {
      onToggle(item);
    }
  };

  const posterUrl = item.poster_path;

  if (!posterUrl) {
    return (
      <motion.button
        className={`${styles.poster} ${styles.error}`}
        disabled
        aria-label={`${item.title} — no poster available`}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{
          delay: 0.05 + index * 0.03,
          stiffness: 350,
          damping: 26,
          mass: 0.7,
        }}
      >
        ?
      </motion.button>
    );
  }

  return (
    <motion.button
      className={`${styles.poster} ${isSelected ? styles.selected : ''} ${disabled && !isSelected ? styles.disabled : ''}`}
      onClick={handleClick}
      disabled={disabled && !isSelected}
      aria-pressed={isSelected}
      aria-label={`${item.title}${isSelected ? ' — selected' : ''}`}
      initial={{ opacity: 0, scale: 0.9, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{
        delay: 0.05 + index * 0.03,
        stiffness: 350,
        damping: 26,
        mass: 0.7,
      }}
      whileHover={!disabled ? { scale: 1.05, y: -4 } : {}}
      whileTap={!disabled ? { scale: 0.95 } : {}}
    >
      {isSelected && (
        <motion.div
          className={styles.checkmark}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ stiffness: 500, damping: 25, mass: 0.4 }}
        >
          ✓
        </motion.div>
      )}
      <img
        src={posterUrl}
        alt=""
        loading="lazy"
        width={200}
        height={300}
      />
      <div className={styles.titleOverlay}>{item.title}</div>
    </motion.button>
  );
}
