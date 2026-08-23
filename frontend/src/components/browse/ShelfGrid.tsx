import { useCallback, useEffect, useState } from "react";
import type { MediaItem } from "../../types/media";
import { getBrowseShelf } from "../../api/browse";
import PosterGrid from "../poster/PosterGrid";
import styles from "./ShelfGrid.module.css";

interface ShelfGridProps {
  shelfKey: string;
  title: string;
  mediaType?: string;
  selectedIds: string[];
  onToggle: (item: MediaItem) => void;
  maxSelections: number;
  onBack: () => void;
}

const PAGE = 36;

/** One shelf as a full grid — the comfortable way through a long row. */
export default function ShelfGrid({
  shelfKey, title, mediaType, selectedIds, onToggle, maxSelections, onBack,
}: ShelfGridProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [offset, setOffset] = useState<number | null>(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (from: number) => {
    setLoading(true);
    setFailed(false);
    try {
      const { data } = await getBrowseShelf(shelfKey, { offset: from, limit: PAGE, mediaType });
      setItems((prev) => (from === 0 ? data.items : [...prev, ...data.items]));
      setOffset(data.next_offset);
      setTotal(data.total);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [shelfKey, mediaType]);

  // Deferred so the first page request doesn't set state synchronously during
  // the mount effect and cascade an extra render.
  useEffect(() => { queueMicrotask(() => load(0)); }, [load]);

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <button type="button" className={styles.back} onClick={onBack}>← All rows</button>
        <h2 className={styles.title}>{title}</h2>
        {total > 0 && <span className={styles.count}>{total} titles</span>}
      </div>

      <PosterGrid
        items={items}
        selectedIds={selectedIds}
        onToggle={onToggle}
        maxSelections={maxSelections}
        loading={loading && items.length === 0}
      />

      {failed && (
        <div className={styles.footer}>
          <p className={styles.error}>Couldn&rsquo;t load more.</p>
          <button className={styles.more} onClick={() => load(offset ?? 0)}>Try again</button>
        </div>
      )}

      {!failed && offset !== null && (
        <div className={styles.footer}>
          <button className={styles.more} onClick={() => load(offset)} disabled={loading}>
            {loading ? "Loading…" : "Show more"}
          </button>
        </div>
      )}
    </div>
  );
}
