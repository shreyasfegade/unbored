import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from "framer-motion";
import type { MediaItem } from '../../types/media';
import { useTasteVector } from '../../hooks/useTasteVector';
import { useDebounce } from '../../hooks/useDebounce';
import { searchMulti } from '../../api/search';
import { SearchBar } from '../ui/SearchBar';
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

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MediaItem[]>([]);
  const [searching, setSearching] = useState(false);
  const debounced = useDebounce(query, 300);

  useEffect(() => {
    fetchCuratedShortlist();
  }, [fetchCuratedShortlist]);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length < 1) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    searchMulti(q)
      .then((res) => { if (!cancelled) setResults(res.data.results || []); })
      .catch(() => { if (!cancelled) setResults([]); })
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [debounced]);

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
      // Error is surfaced via the hook.
    }
  };

  const selectedIds = selectedFavourites.map((f) => f.id);
  const searchActive = query.trim().length > 0;
  const gridItems = searchActive ? results : curatedShortlist;

  return (
    <div className={styles.container}>
      <motion.h1
        className={styles.heading}
        initial={prefersReduced ? false : { opacity: 0, y: -12, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        What do you love?
      </motion.h1>
      <motion.p
        className={styles.subtitle}
        initial={prefersReduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.35 }}
      >
        Pick 5 across movies, TV, and anime — search for anything, or choose from below.
      </motion.p>

      <div className={styles.searchRow}>
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="Search any movie, show, or anime…"
          loading={searching}
        />
      </div>

      <SelectionCounter current={selectedFavourites.length} target={5} />

      {error && !searchActive ? (
        <motion.div className={styles.error} role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <p>{error}</p>
          <button className={styles.retryButton} onClick={fetchCuratedShortlist}>Try again</button>
        </motion.div>
      ) : (
        <div className={styles.scrollArea}>
          {searchActive && results.length === 0 && !searching ? (
            <p className={styles.empty}>No matches for “{query.trim()}”. Try another title.</p>
          ) : (
            <PosterGrid
              items={gridItems}
              selectedIds={selectedIds}
              onToggle={handleToggle}
              maxSelections={5}
              loading={!searchActive && isLoading && !error}
            />
          )}
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
