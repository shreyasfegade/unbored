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
  /** Opens the whole shelf as a grid. Omit to hide the affordance. */
  onSeeAll?: (key: string, title: string) => void;
}

const PAGE = 30;

// Ease-out cubic: fast start, gentle settle — the feel of a flick that comes
// to rest rather than a hard stop.
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export default function BrowseRail({
  shelfKey,
  title,
  mediaType,
  selectedIds,
  onToggle,
  maxSelections,
  onEmpty,
  onSeeAll,
}: BrowseRailProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [offset, setOffset] = useState<number | null>(0); // null = exhausted
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [failed, setFailed] = useState(false);
  const [total, setTotal] = useState(0);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const started = useRef(false);
  const rootRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // A single in-flight scroll tween; a new nudge or wheel spin retargets it.
  const tween = useRef<{ raf: number; to: number } | null>(null);

  const selected = new Set(selectedIds);
  const reachedMax = selected.size >= maxSelections;

  const loadMore = useCallback(async () => {
    if (offset === null || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const { data } = await getBrowseShelf(shelfKey, { offset, limit: PAGE, mediaType });
      setItems((prev) => [...prev, ...data.items]);
      setOffset(data.next_offset);
      setTotal(data.total);
      if (offset === 0 && data.items.length === 0) {
        setEmpty(true);
        onEmpty?.(shelfKey);
      }
    } catch {
      // Surface it and offer a retry. Silently stopping here used to leave the
      // row shimmering forever — the failure looked identical to "still loading".
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [offset, loading, shelfKey, mediaType, onEmpty]);

  const retry = useCallback(() => {
    setFailed(false);
    loadMore();
  }, [loadMore]);

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
    // Already on screen, or no observer support to fall back on — load now.
    if (rect.top < window.innerHeight + 300 || typeof IntersectionObserver === "undefined") {
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
    if (!el || !root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { root, rootMargin: "0px 800px 0px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  // A horizontal strip is unreachable with a normal mouse: a vertical wheel
  // doesn't scroll it and there's nothing to grab. Arrows (plus wheel
  // translation below) are what make the row usable on a desktop at all.
  const updateArrows = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);

  useEffect(() => { updateArrows(); }, [items.length, updateArrows]);

  // A hand-rolled rAF tween instead of scrollTo({behavior:"smooth"}): native
  // smooth scrolling silently no-ops on this track in some engines (that was
  // the "arrow doesn't move" bug), and it can't be retargeted mid-flight the
  // way a flurry of clicks or wheel spins needs.
  const scrollTo = useCallback((target: number) => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const to = Math.max(0, Math.min(target, max));
    if (tween.current) cancelAnimationFrame(tween.current.raf);
    const from = el.scrollLeft;
    const dist = to - from;
    if (Math.abs(dist) < 1) return;
    const dur = Math.min(520, 260 + Math.abs(dist) * 0.28);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      el.scrollLeft = from + dist * easeOutCubic(t);
      updateArrows();
      if (t < 1) {
        tween.current = { raf: requestAnimationFrame(step), to };
      } else {
        tween.current = null;
        if (dist > 0) loadMore();
      }
    };
    tween.current = { raf: requestAnimationFrame(step), to };
  }, [updateArrows, loadMore]);

  useEffect(() => () => {
    if (tween.current) cancelAnimationFrame(tween.current.raf);
  }, []);

  const nudge = (dir: -1 | 1) => {
    const el = trackRef.current;
    if (!el) return;
    // Retarget from the tween's destination, not the live scrollLeft, so rapid
    // clicks add up instead of restarting from wherever the animation happens
    // to be. Just under a full screen keeps a partly-visible tile as an anchor.
    const base = tween.current ? tween.current.to : el.scrollLeft;
    scrollTo(base + dir * el.clientWidth * 0.85);
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    if (!el) return;
    // Trackpads send deltaX themselves; only translate a vertical wheel.
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const atStart = el.scrollLeft <= 0 && e.deltaY < 0;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0;
    if (atStart || atEnd) return; // let the page scroll past the row
    e.preventDefault();
    // Glide toward the wheel's direction through the same tween, so a spin
    // eases instead of stepping. Amplified a little so one notch travels a
    // readable distance.
    const base = tween.current ? tween.current.to : el.scrollLeft;
    scrollTo(base + e.deltaY * 2.4);
  };

  // Arrow keys scroll the row, but only when focus is inside this track — a
  // window-level listener would hijack arrow keys for every rail on the page.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") { e.preventDefault(); nudge(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); nudge(-1); }
  };

  if (empty) return null;

  return (
    <section className={styles.rail} aria-label={title} ref={rootRef}>
      <div className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        {onSeeAll && total > items.length && (
          <button type="button" className={styles.seeAll} onClick={() => onSeeAll(shelfKey, title)}>
            See all →
          </button>
        )}
      </div>

      <div className={styles.viewport}>
        {canLeft && (
          <button
            type="button"
            className={`${styles.arrow} ${styles.arrowLeft}`}
            onClick={() => nudge(-1)}
            aria-label={`Scroll ${title} back`}
          >
            ‹
          </button>
        )}
        {canRight && (
          <button
            type="button"
            className={`${styles.arrow} ${styles.arrowRight}`}
            onClick={() => nudge(1)}
            aria-label={`Scroll ${title} forward`}
          >
            ›
          </button>
        )}

      <div
        className={styles.track}
        ref={trackRef}
        onScroll={updateArrows}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
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
        {loading &&
          Array.from({ length: 6 }).map((_, i) => (
            <div className={`${styles.tile} ${styles.skeleton}`} key={`sk-${i}`} />
          ))}
        {failed && (
          <div className={styles.failure}>
            <span>Couldn&rsquo;t load</span>
            <button type="button" className={styles.retry} onClick={retry}>
              Retry
            </button>
          </div>
        )}
        {/* Trailing sentinel — visible at the right edge (or on the empty rail). */}
        <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />
      </div>
      </div>
    </section>
  );
}
