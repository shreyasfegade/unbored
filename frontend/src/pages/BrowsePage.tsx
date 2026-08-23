import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useTasteStore } from "../stores/tasteStore";
import { useToastStore } from "../stores/toastStore";
import { useDebounce } from "../hooks/useDebounce";
import { searchMulti } from "../api/search";
import type { MediaItem } from "../types/media";
import { SearchBar } from "../components/ui/SearchBar";
import PosterGrid from "../components/poster/PosterGrid";
import BrowseCatalog from "../components/browse/BrowseCatalog";
import styles from "./BrowsePage.module.css";

/**
 * The browsing home: rows of titles you can add to your taste by tapping.
 * Selections are staged, then committed in one go, so a mis-tap is cheap.
 */
export default function BrowsePage() {
  const navigate = useNavigate();
  const favouriteIds = useTasteStore((s) => s.favouriteIds);
  const addFavouriteIds = useTasteStore((s) => s.addFavouriteIds);
  const addToast = useToastStore((s) => s.addToast);

  const [staged, setStaged] = useState<MediaItem[]>([]);
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 300);
  const [results, setResults] = useState<MediaItem[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length < 1) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) setSearching(true); });
    searchMulti(q)
      .then((r) => { if (!cancelled) setResults(r.data.results || []); })
      .catch(() => { if (!cancelled) setResults([]); })
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [debounced]);

  const stagedIds = useMemo(() => staged.map((s) => s.id), [staged]);

  const handleToggle = useCallback((item: MediaItem) => {
    setStaged((prev) =>
      prev.some((p) => p.id === item.id)
        ? prev.filter((p) => p.id !== item.id)
        : [...prev, item],
    );
  }, []);

  const commit = () => {
    addFavouriteIds(stagedIds);
    addToast(`Added ${staged.length} to your taste.`);
    setStaged([]);
  };

  const isSearching = query.trim().length > 0;

  return (
    <div className={styles.page}>
      <motion.h1
        className={styles.heading}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        Browse
      </motion.h1>
      <p className={styles.subtitle}>
        Tap anything you love — the more we know, the sharper your picks.
        {favouriteIds.length > 0 && ` You've added ${favouriteIds.length} so far.`}
      </p>

      <div className={styles.searchRow}>
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="Search a title, or just browse…"
          loading={searching}
        />
        <button className={styles.swipeLink} onClick={() => navigate("/swipe")}>
          ♥ Prefer swiping? Try the deck
        </button>
      </div>

      {isSearching ? (
        results.length === 0 && !searching ? (
          <p className={styles.empty}>No matches for “{query.trim()}”.</p>
        ) : (
          <PosterGrid
            items={results}
            selectedIds={stagedIds}
            onToggle={handleToggle}
            maxSelections={99}
            loading={searching}
          />
        )
      ) : (
        <BrowseCatalog selectedIds={stagedIds} onToggle={handleToggle} maxSelections={99} />
      )}

      {staged.length > 0 && (
        <motion.button
          className={styles.commit}
          onClick={commit}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          whileTap={{ scale: 0.97 }}
        >
          {`Add ${staged.length} to my taste`}
        </motion.button>
      )}
    </div>
  );
}
