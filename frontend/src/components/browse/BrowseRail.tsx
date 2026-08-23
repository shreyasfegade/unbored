import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaItem } from "../../types/media";
import { getBrowseShelf } from "../../api/browse";
import PosterCard from "../poster/PosterCard";
import styles from "./BrowseRail.module.css";

interface BrowseRailProps {
  shelfKey: string;
  title: string;
  mediaType?: string;
  selectedIds: string[];
  onToggle: (item: MediaItem) => void;
  maxSelections: number;
  /** Fires once the first page loads empty, so the parent can hide this rail. */
  onEmpty?: (key: string) => void;
}

const PAGE = 18;

export default function BrowseRail({
  shelfKey,
  title,
  mediaType,
  selectedIds,
  onToggle,
  maxSelections,
  onEmpty,
}: BrowseRailProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [offset, setOffset] = useState<number | null>(0); // null = exhausted
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const started = useRef(false);
  const rootRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const selected = new Set(selectedIds);
  const reachedMax = selected.size >= maxSelections;

  const loadMore = useCallback(async () => {
    if (offset === null || loading) return;
    setLoading(true);
    try {
      const { data } = await getBrowseShelf(shelfKey, { offset, limit: PAGE, mediaType });
      setItems((prev) => [...prev, ...data.items]);
      setOffset(data.next_offset);
      if (offset === 0 && data.items.length === 0) {
        setEmpty(true);
        onEmpty?.(shelfKey);
      }
    } catch {
      setOffset(null); // stop paging this rail on error
    } finally {
      setLoading(false);
    }
  }, [offset, loading, shelfKey, mediaType, onEmpty]);

  // Lazy vertical load: fire page 0 once the rail is at (or near) the viewport,
  // then stop. A right-edge sentinel can't do this — it's clipped by the track's
  // horizontal overflow until the user scrolls sideways — so we watch the rail
  // itself. The synchronous in-view check runs first so a rail that's already on
  // screen loads without waiting for (or depending on) an observer callback.
  useEffect(() => {
    if (started.current) return;
    const el = rootRef.current;
    if (!el) return;

    let io: IntersectionObserver | null = null;
    const trigger = () => {
      if (started.current) return;
      started.current = true;
      io?.disconnect();
      loadMore();
    };

    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight + 300) {
      trigger();
      return;
    }

    io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) trigger(); },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io?.disconnect();
  }, [loadMore]);

  // Observer 2 — horizontal paging: watch the trailing sentinel *within the
  // track's own scroll box*, so it fires as the user scrolls toward the end.
  useEffect(() => {
    const el = sentinelRef.current;
    const root = trackRef.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { root, rootMargin: "0px 400px 0px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  if (empty) return null;

  return (
    <section className={styles.rail} aria-label={title} ref={rootRef}>
      <h3 className={styles.title}>{title}</h3>
      <div className={styles.track} ref={trackRef}>
        {items.map((item, i) => (
          <div className={styles.tile} key={item.id}>
            <PosterCard
              item={item}
              isSelected={selected.has(item.id)}
              onToggle={onToggle}
              disabled={reachedMax && !selected.has(item.id)}
              index={Math.min(i % PAGE, 8)}
            />
          </div>
        ))}
        {(loading || items.length === 0) &&
          Array.from({ length: 6 }).map((_, i) => (
            <div className={`${styles.tile} ${styles.skeleton}`} key={`sk-${i}`} />
          ))}
        {/* Trailing sentinel — visible at the right edge (or on the empty rail). */}
        <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />
      </div>
    </section>
  );
}
