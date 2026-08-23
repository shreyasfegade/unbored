import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useTasteStore } from "../stores/tasteStore";
import { useDebounce } from "../hooks/useDebounce";
import { searchMulti } from "../api/search";
import { getCatalogItem } from "../api/media";
import type { MediaItem } from "../types/media";
import { EnrichTabs } from "../components/onboarding/EnrichTabs";
import type { EnrichTab } from "../components/onboarding/EnrichTabs";
import { SearchBar } from "../components/ui/SearchBar";
import PosterGrid from "../components/poster/PosterGrid";
import BrowseCatalog from "../components/browse/BrowseCatalog";
import styles from "./EnrichPage.module.css";

const TAB_TYPE: Record<EnrichTab, string> = { movies: "movie", tv: "tv", anime: "anime" };

export default function EnrichPage() {
  const navigate = useNavigate();
  const prefersReduced = useReducedMotion();
  // Per-field selectors, not the whole store — otherwise this page re-renders on
  // every unrelated taste-store change.
  const enrichmentItems = useTasteStore((s) => s.enrichmentItems);
  const addEnrichmentItem = useTasteStore((s) => s.addEnrichmentItem);
  const removeEnrichmentItem = useTasteStore((s) => s.removeEnrichmentItem);
  const clearEnrichmentItems = useTasteStore((s) => s.clearEnrichmentItems);
  const addFavouriteIds = useTasteStore((s) => s.addFavouriteIds);
  const favouriteIds = useTasteStore((s) => s.favouriteIds);
  const removeFavouriteId = useTasteStore((s) => s.removeFavouriteId);

  const [activeTab, setActiveTab] = useState<EnrichTab>("movies");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const [results, setResults] = useState<MediaItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [favItems, setFavItems] = useState<MediaItem[]>([]);

  // Fetch the user's current favourites so they can review and remove them.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      favouriteIds.map((id) => getCatalogItem(id).then((r) => r.data).catch(() => null)),
    ).then((items) => {
      if (!cancelled) setFavItems(items.filter((i): i is MediaItem => i !== null));
    });
    return () => { cancelled = true; };
  }, [favouriteIds]);

  useEffect(() => {
    const q = debouncedQuery.trim();
    // Don't setState synchronously here to clear results; the `searching` flag
    // below already hides stale results when the query is empty.
    if (q.length < 1) {
      return;
    }
    let cancelled = false;
    // Defer the loading flag off the synchronous effect body; results/errors
    // are only set from the async callbacks below.
    queueMicrotask(() => { if (!cancelled) { setSearchLoading(true); setSearchError(null); } });
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
    if (enrichmentItems.some((ei: MediaItem) => ei.id === item.id)) {
      removeEnrichmentItem(item.id);
    } else {
      addEnrichmentItem(item);
    }
  }, [enrichmentItems, addEnrichmentItem, removeEnrichmentItem]);

  const handleUpdate = useCallback(() => {
    if (enrichmentItems.length === 0) return;
    // Taste is local now: enriching just adds ids to the persisted favourites —
    // no server call, so this can't fail or hit a cold start.
    setUpdateError(null);
    const count = enrichmentItems.length;
    addFavouriteIds(enrichmentItems.map((i) => i.id));
    sessionStorage.setItem("unbored-enrich-success", String(count));
    clearEnrichmentItems();
    navigate("/", { replace: true });
  }, [enrichmentItems, addFavouriteIds, clearEnrichmentItems, navigate]);

  const enrichmentCount = enrichmentItems.length;
  const selectedIds = enrichmentItems.map((ei: MediaItem) => ei.id);
  const searching = query.trim().length > 0;

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

      {favItems.length > 0 && (
        <div className={styles.favSection}>
          <p className={styles.sectionLabel}>Your taste · {favItems.length}</p>
          <div className={styles.favRow}>
            {favItems.map((f) => (
              <button
                key={f.id}
                className={styles.favChip}
                onClick={() => removeFavouriteId(f.id)}
                title={`Remove ${f.title}`}
                aria-label={`Remove ${f.title} from your taste`}
              >
                <span className={styles.favTitle}>{f.title}</span>
                <span className={styles.favX} aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <motion.div
        className={styles.searchSection}
        initial={prefersReduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.35 }}
      >
        {searching && <EnrichTabs activeTab={activeTab} onTabChange={handleTabChange} />}
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="Search for a title, or browse below…"
          loading={searchLoading}
        />
      </motion.div>

      <div className={styles.scrollArea}>
        {!searching ? (
          <BrowseCatalog selectedIds={selectedIds} onToggle={handleToggle} maxSelections={99} />
        ) : results.length === 0 && !searchLoading && !searchError ? (
          <p className={styles.empty}>No matches for “{query.trim()}”.</p>
        ) : (
          <PosterGrid items={results} selectedIds={selectedIds} onToggle={handleToggle} maxSelections={99} loading={searchLoading} />
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
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 300, damping: 25, mass: 0.8 }}
            whileHover={!prefersReduced ? { scale: 1.03 } : {}}
            whileTap={!prefersReduced ? { scale: 0.96 } : {}}
          >
            {`Add ${enrichmentCount} to my taste`}
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
