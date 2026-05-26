import { useEffect } from 'react';
import { motion, useReducedMotion } from "framer-motion";
import type { MediaItem } from '../../types/media';
import { useTasteVector } from '../../hooks/useTasteVector';
import PosterGrid from '../poster/PosterGrid';
import SelectionCounter from './SelectionCounter';
import DoneButton from './DoneButton';
import styles from './FavouritePicker.module.css';

interface FavouritePickerProps {
  onComplete: (picks: MediaItem[]) => void;
}

export default function FavouritePicker({ onComplete }: FavouritePickerProps) {
  const prefersReduced = useReducedMotion();
  const {
    selectedFavourites,
    curatedShortlist,
    isLoading,
    error,
    fetchCuratedShortlist,
    createFromFavourites,
    addFavourite,
    removeFavourite,
  } = useTasteVector();

  useEffect(() => {
    fetchCuratedShortlist();
  }, [fetchCuratedShortlist]);

  const handleToggle = (item: MediaItem) => {
    if (selectedFavourites.some((f) => f.id === item.id)) {
      removeFavourite(item.id);
    } else {
      addFavourite(item);
    }
  };

  const handleDone = async () => {
    if (selectedFavourites.length < 5) return;
    try {
      await createFromFavourites(selectedFavourites);
      onComplete(selectedFavourites);
    } catch {
      // Error is set in the hook via setError
    }
  };

  const selectedIds = selectedFavourites.map((f) => f.id);

  return (
    <div className={styles.container}>
      <motion.h1
        className={styles.heading}
        initial={prefersReduced ? false : { opacity: 0, y: -12, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        Pick 5 favourites
      </motion.h1>
      <motion.p
        className={styles.subtitle}
        initial={prefersReduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      >
        These shape your first recommendation.
      </motion.p>

      <SelectionCounter current={selectedFavourites.length} target={5} />

      {error ? (
        <motion.div
          className={styles.error}
          role="alert"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <p>{error}</p>
          <button className={styles.retryButton} onClick={fetchCuratedShortlist}>
            Try Again
          </button>
        </motion.div>
      ) : (
        <div className={styles.scrollArea}>
          <PosterGrid
            items={curatedShortlist}
            selectedIds={selectedIds}
            onToggle={handleToggle}
            maxSelections={5}
            loading={isLoading && !error}
          />
        </div>
      )}

      <DoneButton
        visible={selectedFavourites.length >= 5}
        onClick={handleDone}
        loading={isLoading}
      />
    </div>
  );
}
