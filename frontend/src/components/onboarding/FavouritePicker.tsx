import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from "framer-motion";
import type { MediaItem } from '../../types/media';
import { useTasteVector } from '../../hooks/useTasteVector';
import { useDebounce } from '../../hooks/useDebounce';
import { searchMulti } from '../../api/search';
import { SearchBar } from '../ui/SearchBar';
import PosterGrid from '../poster/PosterGrid';
import BrowseCatalog from '../browse/BrowseCatalog';
import SelectionCounter from './SelectionCounter';
import DoneButton from './DoneButton';
import styles from './FavouritePicker.module.css';

interface FavouritePickerProps {
  onComplete: (picks: MediaItem[]) => void;
}

// Browse-first: add as few or as many as you like. The 5 floor is the real
// gate; this ceiling only exists so the request stays within the API's cap.
const MAX_PICKS = 40;

export default function FavouritePicker({ onComplete }: FavouritePickerProps) {
  const prefersReduced = useReducedMotion();
  const {
    selectedFavourites,
    isLoading,
    createFromFavourites,
    addFavourite,
    removeFavourite,
  } = useTasteVector();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MediaItem[]>([]);
  const [searching, setSearching] = useState(false);
  const debounced = useDebounce(query, 300);

  useEffect(() => {
    const q = debounced.trim();
    // The `searchActive` flag hides stale results when the query is empty, so we
    // don't need to setState synchronously here (which triggered a lint error).
    if (q.length < 1) {
      return;
    }
    let cancelled = false;
    // Defer the loading flag off the synchronous effect body (avoids a
    // cascading render); results are only ever set from the async callbacks.
    queueMicrotask(() => { if (!cancelled) setSearching(true); });
    searchMulti(q)
      .then((res) => { if (!cancelled) setResults(res.data.results || []); })
      .catch(() => { if (!cancelled) setResults([]); })
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [debounced]);

  // Stable so the memoised PosterCards don't all re-render on each toggle.
  const handleToggle = useCallback((item: MediaItem) => {
    if (selectedFavourites.some((f) => f.id === item.id)) {
      removeFavourite(item.id);
    } else {
      addFavourite(item);
    }
  }, [selectedFavourites, removeFavourite, addFavourite]);

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
        Pick at least 5 across movies, TV, and anime — the more you add, the
        sharper your picks. Browse below, or search for anything.
      </motion.p>

      <div className={styles.searchRow}>
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="Search a title, or browse below…"
          loading={searching}
        />
      </div>

      <SelectionCounter current={selectedFavourites.length} target={5} />

      <div className={styles.scrollArea}>
        {!searchActive ? (
          <BrowseCatalog selectedIds={selectedIds} onToggle={handleToggle} maxSelections={MAX_PICKS} />
        ) : results.length === 0 && !searching ? (
          <p className={styles.empty}>No matches for “{query.trim()}”. Try another title.</p>
        ) : (
          <PosterGrid
            items={results}
            selectedIds={selectedIds}
            onToggle={handleToggle}
            maxSelections={MAX_PICKS}
          />
        )}
      </div>

      <DoneButton
        visible={selectedFavourites.length >= 5}
        onClick={handleDone}
        loading={isLoading}
      />
    </div>
  );
}
