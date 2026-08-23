import { useEffect, useState } from "react";
import type { MediaItem } from "../../types/media";
import { getBrowseShelves, type BrowseShelf } from "../../api/browse";
import BrowseRail from "./BrowseRail";
import styles from "./BrowseCatalog.module.css";

interface BrowseCatalogProps {
  selectedIds: string[];
  onToggle: (item: MediaItem) => void;
  maxSelections: number;
}

type TypeFilter = "all" | "movie" | "tv" | "anime";

const FILTERS: { key: TypeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "movie", label: "Movies" },
  { key: "tv", label: "TV" },
  { key: "anime", label: "Anime" },
];

export default function BrowseCatalog({ selectedIds, onToggle, maxSelections }: BrowseCatalogProps) {
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [shelves, setShelves] = useState<BrowseShelf[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [reload, setReload] = useState(0);

  const mediaType = filter === "all" ? undefined : filter;

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setLoading(true);
    setSlow(false);
    // The backend sleeps on the free tier and can take ~50s to wake. Say so
    // instead of leaving the page looking broken.
    const slowTimer = setTimeout(() => { if (!cancelled) setSlow(true); }, 2500);
    getBrowseShelves(mediaType)
      .then((res) => { if (!cancelled) setShelves(res.data.shelves); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => {
        if (!cancelled) { setLoading(false); setSlow(false); }
        clearTimeout(slowTimer);
      });
    return () => { cancelled = true; clearTimeout(slowTimer); };
  }, [mediaType, reload]);

  return (
    <div className={styles.catalog}>
      <div className={styles.filters} role="tablist" aria-label="Filter by type">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            className={`${styles.chip} ${filter === f.key ? styles.active : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {slow && (
        <p className={styles.waking} role="status">
          Waking the server — the free tier takes a moment on the first visit.
        </p>
      )}

      {error ? (
        <div className={styles.error}>
          <p>Couldn't load the catalog.</p>
          <button className={styles.retry} onClick={() => setReload((n) => n + 1)}>Try again</button>
        </div>
      ) : loading ? (
        <div className={styles.rails} aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div className={styles.railSkeleton} key={i}>
              <div className={styles.titleSkeleton} />
              <div className={styles.trackSkeleton}>
                {Array.from({ length: 6 }).map((__, j) => (
                  <div className={styles.tileSkeleton} key={j} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.rails}>
          {shelves.map((s) => (
            <BrowseRail
              key={`${s.key}:${filter}`}
              shelfKey={s.key}
              title={s.title}
              mediaType={mediaType}
              selectedIds={selectedIds}
              onToggle={onToggle}
              maxSelections={maxSelections}
            />
          ))}
        </div>
      )}
    </div>
  );
}
