import { useCallback, useEffect, useRef, useState } from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  useReducedMotion,
  type PanInfo,
} from "framer-motion";
import type { MediaItem } from "../../types/media";
import PosterArt from "../poster/PosterArt";
import { sizedPoster } from "../../utils/poster";
import styles from "./SwipeDeck.module.css";

export type SwipeVerdict = "like" | "skip";

interface SwipeDeckProps {
  items: MediaItem[];
  onDecide: (item: MediaItem, verdict: SwipeVerdict) => void;
  /** Reverse the most recent decision in the parent's own state. */
  onUndo?: (item: MediaItem) => void;
  /** Fires when the deck runs low, so the parent can page more in. */
  onRunningLow?: () => void;
  /** Fires once when the last card is gone. */
  onExhausted?: () => void;
  emptyMessage?: string;
}

// Commit if dragged past this OR flicked faster than the velocity threshold —
// a quick flick shouldn't need to travel the full distance.
const COMMIT_PX = 100;
const FLICK_VELOCITY = 480;
const LOW_WATER = 5;
// How deep the visible stack is (top + this many peeking behind).
const DEPTH = 2;

// Resting transform for a card at a given depth (0 = top).
const depthScale = (d: number) => 1 - d * 0.05;
const depthY = (d: number) => d * 14;

/**
 * A swipeable card stack with a springy, snap-free promotion.
 *
 * The old deck advanced on a `setTimeout`, resetting the behind card's inline
 * transform in the same frame — so the next card *jumped* from its dragged
 * position back to rest and then sat there. Here each card is keyed by id and
 * animates its depth, so when the top card leaves, the one behind springs
 * forward continuously instead of cutting. Dragging uses framer's pointer
 * handling for finger-accurate follow and real flick velocity.
 */
export default function SwipeDeck({
  items,
  onDecide,
  onUndo,
  onRunningLow,
  onExhausted,
  emptyMessage,
}: SwipeDeckProps) {
  const prefersReduced = useReducedMotion();
  const [cursor, setCursor] = useState(0);
  const lowFired = useRef(false);
  const exhaustedFired = useRef(false);
  const lastDecision = useRef<{ item: MediaItem; verdict: SwipeVerdict } | null>(null);

  // The top card's live horizontal drag, shared so the card behind can rise
  // toward the front as the top one is pulled away — without a React re-render
  // on every pointer move.
  const drag = useMotionValue(0);
  const peek = useTransform(drag, (v) => Math.min(Math.abs(v) / COMMIT_PX, 1));

  const remaining = items.length - cursor;
  const current = items[cursor];

  useEffect(() => {
    if (remaining <= LOW_WATER && remaining > 0 && !lowFired.current) {
      lowFired.current = true;
      onRunningLow?.();
    }
    if (remaining > LOW_WATER) lowFired.current = false;
  }, [remaining, onRunningLow]);

  useEffect(() => {
    if (remaining === 0 && items.length > 0 && !exhaustedFired.current) {
      exhaustedFired.current = true;
      onExhausted?.();
    }
    if (remaining > 0) exhaustedFired.current = false;
  }, [remaining, items.length, onExhausted]);

  const advance = useCallback(
    (item: MediaItem, verdict: SwipeVerdict) => {
      lastDecision.current = { item, verdict };
      onDecide(item, verdict);
      drag.set(0);
      setCursor((c) => c + 1);
    },
    [onDecide, drag],
  );

  // Button / keyboard path: fling the card off, then advance.
  const fling = useCallback(
    (verdict: SwipeVerdict) => {
      const item = items[cursor];
      if (!item) return;
      const to = verdict === "like" ? 1000 : -1000;
      if (prefersReduced) {
        advance(item, verdict);
        return;
      }
      animate(drag, to, { duration: 0.26, ease: [0.4, 0, 1, 1] });
      window.setTimeout(() => advance(item, verdict), 200);
    },
    [items, cursor, advance, drag, prefersReduced],
  );

  const onDragEnd = useCallback(
    (_e: unknown, info: PanInfo) => {
      const item = items[cursor];
      if (!item) return;
      const committed =
        Math.abs(info.offset.x) > COMMIT_PX || Math.abs(info.velocity.x) > FLICK_VELOCITY;
      if (!committed) {
        // Spring the card back under the finger's release point.
        animate(drag, 0, { type: "spring", stiffness: 420, damping: 34 });
        return;
      }
      const verdict: SwipeVerdict =
        info.offset.x > 0 || info.velocity.x > FLICK_VELOCITY ? "like" : "skip";
      const to = verdict === "like" ? 1000 : -1000;
      animate(drag, to, {
        type: "tween",
        duration: 0.24,
        ease: [0.4, 0, 1, 1],
      });
      window.setTimeout(() => advance(item, verdict), 180);
    },
    [items, cursor, advance, drag],
  );

  const undo = useCallback(() => {
    if (cursor === 0 || !lastDecision.current) return;
    const { item } = lastDecision.current;
    lastDecision.current = null;
    onUndo?.(item);
    drag.set(0);
    setCursor((c) => Math.max(0, c - 1));
  }, [cursor, onUndo, drag]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") fling("like");
      else if (e.key === "ArrowLeft") fling("skip");
      else if (e.key === "ArrowDown" || e.key === "Backspace") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fling, undo]);

  if (!current) {
    return <p className={styles.empty}>{emptyMessage ?? "That's everything for now."}</p>;
  }

  // Render the top card plus a couple peeking behind. Reverse order so the top
  // card is painted last (highest in the DOM) without manual z-index juggling.
  const stack: { item: MediaItem; depth: number }[] = [];
  for (let d = Math.min(DEPTH, remaining - 1); d >= 0; d--) {
    stack.push({ item: items[cursor + d], depth: d });
  }

  return (
    <div className={styles.deck}>
      <div className={styles.stage}>
        {stack.map(({ item, depth }) =>
          depth === 0 ? (
            <TopCard
              key={item.id}
              item={item}
              drag={drag}
              prefersReduced={prefersReduced}
              onDragEnd={onDragEnd}
            />
          ) : (
            <BehindCard key={item.id} item={item} depth={depth} peek={peek} />
          ),
        )}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={`${styles.action} ${styles.skip}`}
          onClick={() => fling("skip")}
          aria-label={`Skip ${current.title}`}
        >
          ✕
        </button>
        <button
          type="button"
          className={styles.undo}
          onClick={undo}
          disabled={cursor === 0}
          aria-label="Undo last swipe"
        >
          ↺
        </button>
        <button
          type="button"
          className={`${styles.action} ${styles.like}`}
          onClick={() => fling("like")}
          aria-label={`Add ${current.title} to my taste`}
        >
          ♥
        </button>
      </div>
      <p className={styles.counter} aria-live="polite">{remaining} left</p>
      <p className={styles.hint}>Drag, tap, or use ← → · ↺ to undo</p>
    </div>
  );
}

function TopCard({
  item,
  drag,
  prefersReduced,
  onDragEnd,
}: {
  item: MediaItem;
  drag: ReturnType<typeof useMotionValue<number>>;
  prefersReduced: boolean | null;
  onDragEnd: (e: unknown, info: PanInfo) => void;
}) {
  const rotate = useTransform(drag, [-260, 0, 260], [-13, 0, 13]);
  const likeOpacity = useTransform(drag, [30, 120], [0, 1]);
  const skipOpacity = useTransform(drag, [-120, -30], [1, 0]);

  return (
    <motion.div
      className={styles.card}
      style={{ x: drag, rotate }}
      drag={prefersReduced ? false : "x"}
      dragElastic={0.55}
      dragMomentum={false}
      onDragEnd={onDragEnd}
      // No enter animation: by the time this card is promoted, the card behind
      // has already risen to the front under the outgoing card (peek → 1), so
      // the new top mounts exactly where the eye already is. An enter spring
      // here would yank it back a step and hitch.
      initial={false}
    >
      <CardFace item={item} />
      <motion.span
        className={`${styles.stamp} ${styles.stampLike}`}
        style={{ opacity: likeOpacity }}
        aria-hidden="true"
      >
        LOVE IT
      </motion.span>
      <motion.span
        className={`${styles.stamp} ${styles.stampSkip}`}
        style={{ opacity: skipOpacity }}
        aria-hidden="true"
      >
        NOT FOR ME
      </motion.span>
    </motion.div>
  );
}

function BehindCard({
  item,
  depth,
  peek,
}: {
  item: MediaItem;
  depth: number;
  peek: ReturnType<typeof useMotionValue<number>>;
}) {
  // At rest, sit at this depth; as the top card is dragged away (peek → 1),
  // rise one step toward the front so the stack feels alive.
  const scale = useTransform(peek, [0, 1], [depthScale(depth), depthScale(depth - 1)]);
  const y = useTransform(peek, [0, 1], [depthY(depth), depthY(depth - 1)]);
  // Purely peek + depth driven. Layering an `animate` here would fight these
  // controlled motion values and snap; the depth change is a small, dim,
  // mostly-occluded move behind the incoming top card, so it needs no spring.
  return (
    <motion.div className={`${styles.card} ${styles.behind}`} style={{ scale, y }} aria-hidden="true">
      <CardFace item={item} />
    </motion.div>
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
          loading="lazy"
          decoding="async"
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
