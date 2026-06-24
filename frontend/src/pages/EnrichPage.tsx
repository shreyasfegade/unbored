import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useTasteStore } from "../stores/tasteStore";
import { useDebounce } from "../hooks/useDebounce";
import { searchMulti } from "../api/search";
import { updateTasteVector, fetchCuratedShortlist } from "../api/taste";
import type { MediaItem } from "../types/media";
import { EnrichTabs } from "../components/onboarding/EnrichTabs";
import type { EnrichTab } from "../components/onboarding/EnrichTabs";
import { SearchBar } from "../components/ui/SearchBar";
import PosterGrid from "../components/poster/PosterGrid";
import styles from "./EnrichPage.module.css";

const TAB_TYPE: Record<EnrichTab, string> = { movies: "movie", tv: "tv", anime: "anime" };

export default function EnrichPage() {
  const navigate = useNavigate();
  const prefersReduced = useReducedMotion();
  const store = useTasteStore();
  const vectorId = store.vectorId;

  const [activeTab, setActiveTab] = useState<EnrichTab>("movies");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const [results, setResults] = useState<MediaItem[]>([]);
  const [suggestions, setSuggestions] = useState<MediaItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Curated suggestions so the page is never an empty void.
  useEffect(() => {
    fetchCuratedShortlist()
      .then((res) => setSuggestions(res.data.items || []))
      .catch(() => setSuggestions([]));
  }, []);

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (q.length < 1) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    searchMulti(q, TAB_TYPE[activeTab])
      .then((res) => { if (!cancelled) setResults(res.data.results || []); })
      .catch(() => { if (!cancelled) { setSearchError("Search unavailable. Try again."); setResults([]); } })
      .finally(() => { if (!cancelled) setSearchLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedQuery, activeTab]);

  const handleTabChange = useCallback((tab: EnrichTab) => {
    setActiveTab(tab);
    setQuery("");
    setResults([]);
    setSearchError(null);
  }, []);

  const handleToggle = useCallback((item: MediaItem) => {
    if (store.enrichmentItems.some((ei: MediaItem) => ei.id === item.id)) {
      store.removeEnrichmentItem(item.id);
    } else {
      store.addEnrichmentItem(item);
    }
  }, [store]);

  const handleUpdate = useCallback(async () => {
    if (!vectorId || store.enrichmentItems.length === 0) return;
    setUpdating(true);
    setUpdateError(null);
    try {
      await updateTasteVector(vectorId, { add_favourites: store.enrichmentItems.map((i) => i.id) });
      sessionStorage.setItem("unbored-enrich-success", String(store.enrichmentItems.length));
      navigate("/", { replace: true });
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : "Failed to update taste.");
    } finally {
      setUpdating(false);
    }
  }, [vectorId, store.enrichmentItems, navigate]);

  const enrichmentCount = store.enrichmentItems.length;
  const selectedIds = store.enrichmentItems.map((ei: MediaItem) => ei.id);
  const searching = query.trim().length > 0;
  const gridItems = searching
    ? results
    : suggestions.filter((s) => s.media_type === TAB_TYPE[activeTab]);

  return (
    <div className={styles.page}>
      <motion.button
        className={styles.back}
        onClick={() => navigate("/")}
        initial={prefersReduced ? false : { opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.1, duration: 0.3 }}
        whileHover={prefersReduced ? {} : { x: -4 }}
        whileTap={prefersReduced ? {} : { scale: 0.95 }}
      >
        ← Back
      </motion.button>

      <motion.h1
        className={styles.heading}
        initial={prefersReduced ? false : { opacity: 0, y: -10, filter: "blur(3px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ delay: 0.15, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        Add more to sharpen your taste
      </motion.h1>
      <motion.p
        className={styles.subtitle}
        initial={prefersReduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.35 }}
      >
        The more you add, the sharper your picks get.
      </motion.p>

      <motion.div
        className={styles.searchSection}
        initial={prefersReduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.35 }}
      >
        <EnrichTabs activeTab={activeTab} onTabChange={handleTabChange} />
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder={`Search ${activeTab === "anime" ? "anime" : activeTab === "tv" ? "TV shows" : "movies"}…`}
          loading={searchLoading}
        />
      </motion.div>

      <div className={styles.scrollArea}>
        {!searching && gridItems.length > 0 && (
          <p className={styles.sectionLabel}>Popular picks</p>
        )}
        {searching && results.length === 0 && !searchLoading && !searchError ? (
          <p className={styles.empty}>No matches for “{query.trim()}”.</p>
        ) : (
          <PosterGrid items={gridItems} selectedIds={selectedIds} onToggle={handleToggle} maxSelections={99} loading={searchLoading} />
        )}
        <AnimatePresence>
          {searchError && (
            <motion.p className={styles.error} role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {searchError}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {enrichmentCount > 0 && (
          <motion.button
            className={styles.updateButton}
            onClick={handleUpdate}
            disabled={updating}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 300, damping: 25, mass: 0.8 }}
            whileHover={!updating && !prefersReduced ? { scale: 1.03 } : {}}
            whileTap={!updating && !prefersReduced ? { scale: 0.96 } : {}}
          >
            {updating ? "Updating…" : `Add ${enrichmentCount} to my taste`}
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {updateError && (
          <motion.p className={styles.error} role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {updateError}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
