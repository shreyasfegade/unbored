import { memo, useState } from 'react';
import { motion } from 'framer-motion';
import type { MediaItem } from '../../types/media';
import PosterArt from './PosterArt';
import { sizedPoster } from '../../utils/poster';
import { SPRING, pressable } from '../../config/motion';
import styles from './PosterCard.module.css';

interface PosterCardProps {
  item: MediaItem;
  isSelected: boolean;
  onToggle: (item: MediaItem) => void;
  disabled?: boolean;
  index?: number;
}

// Memoised: selecting one favourite changes `selectedIds`, and without this
// every card in the grid (36 on the enrich page) re-renders. With a stable
// onToggle, only the toggled card re-renders.
function PosterCard({ item, isSelected, onToggle, disabled, index = 0 }: PosterCardProps) {
  const [failed, setFailed] = useState(false);
  const showArt = !item.poster_path || failed;

  const handleClick = () => {
    if (!disabled || isSelected) onToggle(item);
  };

  return (
    <motion.button
      className={`${styles.poster} ${isSelected ? styles.selected : ''} ${disabled && !isSelected ? styles.disabled : ''}`}
      onClick={handleClick}
      disabled={disabled && !isSelected}
      aria-pressed={isSelected}
      aria-label={`${item.title}${isSelected ? ' — selected' : ''}`}
      initial={{ opacity: 0, scale: 0.92, y: 12 }}
      animate={{
        opacity: 1,
        scale: 1,
        y: 0,
        transition: { ...SPRING.gentle, delay: 0.04 + Math.min(index, 12) * 0.03 },
      }}
      whileHover={!disabled || isSelected ? pressable.whileHover : {}}
      whileTap={!disabled || isSelected ? pressable.whileTap : {}}
      transition={SPRING.snappy}
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
      {showArt ? (
        <PosterArt item={item} />
      ) : (
        <>
          <img
            src={sizedPoster(item.poster_path, 'card')}
            alt=""
            loading="lazy"
            decoding="async"
            width={200}
            height={300}
            onError={() => setFailed(true)}
          />
          <div className={styles.titleOverlay}>{item.title}</div>
        </>
      )}
    </motion.button>
  );
}

export default memo(PosterCard);
