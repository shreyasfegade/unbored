import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaItem } from "../../types/media";
import PosterArt from "../poster/PosterArt";
import { sizedPoster } from "../../utils/poster";
import styles from "./SwipeDeck.module.css";

export type SwipeVerdict = "like" | "skip";

interface SwipeDeckProps {
  items: MediaItem[];
  onDecide: (item: MediaItem, verdict: SwipeVerdict) => void;
  /** Fires when the deck runs low, so the parent can page more in. */
  onRunningLow?: () => void;
  emptyMessage?: string;
}

// Past this many pixels the card commits to a decision on release.
const COMMIT_PX = 110;
const LOW_WATER = 4;

/**
 * A swipeable card stack. Dragging uses pointer events rather than framer's
 * `drag` feature, which keeps the gesture independent of the animation layer.
 *
 * Every gesture has a keyboard and button equivalent — a deck you can only
 * operate by dragging would be unusable for anyone not using a mouse or touch.
 */
export default function SwipeDeck({ items, onDecide, onRunningLow, emptyMessage }: SwipeDeckProps) {
  const [cursor, setCursor] = useState(0);
  const [dx, setDx] = useState(0);
  const [flyOut, setFlyOut] = useState<SwipeVerdict | null>(null);
  // State, not a ref: the transition below is decided during render, and refs
  // must not be read there.
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const lowFired = useRef(false);

  const remaining = items.length - cursor;
  const current = items[cursor];

  useEffect(() => {
    if (remaining <= LOW_WATER && remaining > 0 && !lowFired.current) {
      lowFired.current = true;
      onRunningLow?.();
    }
    if (remaining > LOW_WATER) lowFired.current = false;
  }, [remaining, onRunningLow]);

  const commit = useCallback(
    (verdict: SwipeVerdict) => {
      const item = items[cursor];
      if (!item) return;
      setFlyOut(verdict);
      // Let the card animate off before the next one becomes interactive.
      window.setTimeout(() => {
        onDecide(item, verdict);
        setCursor((c) => c + 1);
        setDx(0);
        setFlyOut(null);
      }, 220);
    },
    [items, cursor, onDecide],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (flyOut) return;
    setDragging(true);
    startX.current = e.clientX;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || flyOut) return;
    setDx(e.clientX - startX.current);
  };

  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    if (Math.abs(dx) >= COMMIT_PX) commit(dx > 0 ? "like" : "skip");
    else setDx(0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") commit("like");
      else if (e.key === "ArrowLeft") commit("skip");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit]);

  if (!current) {
    return <p className={styles.empty}>{emptyMessage ?? "That's everything for now."}</p>;
  }

  const offset = flyOut ? (flyOut === "like" ? 600 : -600) : dx;
  const rotate = offset / 18;
  const verdictHint = Math.abs(dx) > 40 ? (dx > 0 ? "like" : "skip") : null;
  // The next card peeks out behind, and rises as the top one is dragged away.
  const peek = Math.min(Math.abs(offset) / COMMIT_PX, 1);

  return (
    <div className={styles.deck}>
      <div className={styles.stage}>
        {items[cursor + 1] && (
          <div
            className={`${styles.card} ${styles.behind}`}
            style={{ transform: `scale(${0.94 + peek * 0.06}) translateY(${(1 - peek) * 12}px)` }}
            aria-hidden="true"
          >
            <CardFace item={items[cursor + 1]} />
          </div>
        )}

        <div
          className={styles.card}
          style={{
            transform: `translateX(${offset}px) rotate(${rotate}deg)`,
            transition: dragging ? "none" : "transform 0.22s ease-out",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <CardFace item={current} />
          {verdictHint && (
            <span className={`${styles.stamp} ${verdictHint === "like" ? styles.stampLike : styles.stampSkip}`}>
              {verdictHint === "like" ? "LOVE IT" : "NOT FOR ME"}
            </span>
          )}
        </div>
      </div>

      <div className={styles.controls}>
        <button type="button" className={`${styles.action} ${styles.skip}`} onClick={() => commit("skip")} aria-label={`Skip ${current.title}`}>
          ✕
        </button>
        <span className={styles.counter} aria-live="polite">{remaining} left</span>
        <button type="button" className={`${styles.action} ${styles.like}`} onClick={() => commit("like")} aria-label={`Add ${current.title} to my taste`}>
          ♥
        </button>
      </div>
      <p className={styles.hint}>Drag, tap, or use ← and → </p>
    </div>
  );
}

function CardFace({ item }: { item: MediaItem }) {
  const [failed, setFailed] = useState(false);
  const year = item.release_year ?? item.year;
  return (
    <>
      {item.poster_path && !failed ? (
        <img
          src={sizedPoster(item.poster_path, "hero")}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <PosterArt item={item} />
      )}
      <div className={styles.meta}>
        <span className={styles.title}>{item.title}</span>
        <span className={styles.sub}>
          {[item.genres?.[0], year].filter(Boolean).join(" · ")}
        </span>
      </div>
    </>
  );
}
