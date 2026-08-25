import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
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
import { SPRING, EASE_OUT } from "../../config/motion";
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
// Where a committed card flies to — comfortably off any screen.
const FLY_OUT = 1400;

// Resting transform for a card at a given depth (0 = top).
const depthScale = (d: number) => 1 - d * 0.05;
const depthY = (d: number) => d * 14;

interface CardHandle {
  flick: (verdict: SwipeVerdict) => void;
}

/**
 * A swipeable card stack that flings and promotes seamlessly.
 *
 * The rebuilt design gives **each card its own `x` motion value** and drives
 * **depth through an `animate` target**. There is no shared drag value and no
 * timer coupling — the two things that made the old deck dart sideways and
 * hitch. A committed card animates its *own* `x` off-screen and only tells the
 * parent to advance once that animation completes, so unmounting it can never
 * corrupt the next card. The card behind keeps the same key as `cursor`
 * advances; its `depth` prop drops from 1 to 0 and framer springs it forward,
 * a continuous promotion rather than a remount.
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
  const committingRef = useRef(false);
  const lastDecision = useRef<{ item: MediaItem; verdict: SwipeVerdict } | null>(null);
  const topRef = useRef<CardHandle>(null);

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

  // Called by a card once it has finished flying off. The flown card owns its
  // own x, so advancing here can't disturb the card being promoted.
  const handleExit = useCallback(
    (item: MediaItem, verdict: SwipeVerdict) => {
      lastDecision.current = { item, verdict };
      committingRef.current = false;
      onDecide(item, verdict);
      setCursor((c) => c + 1);
    },
    [onDecide],
  );

  const undo = useCallback(() => {
    if (cursor === 0 || !lastDecision.current) return;
    const { item } = lastDecision.current;
    lastDecision.current = null;
    onUndo?.(item);
    setCursor((c) => Math.max(0, c - 1));
  }, [cursor, onUndo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") topRef.current?.flick("like");
      else if (e.key === "ArrowLeft") topRef.current?.flick("skip");
      else if (e.key === "ArrowDown" || e.key === "Backspace") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  if (!current) {
    return <p className={styles.empty}>{emptyMessage ?? "That's everything for now."}</p>;
  }

  // Reverse order so the top card is painted last (highest in the DOM) without
  // manual z-index juggling.
  const stack: { item: MediaItem; depth: number }[] = [];
  for (let d = Math.min(DEPTH, remaining - 1); d >= 0; d--) {
    stack.push({ item: items[cursor + d], depth: d });
  }

  return (
    <div className={styles.deck}>
      <div className={styles.stage}>
        {stack.map(({ item, depth }) => (
          <SwipeCard
            key={item.id}
            ref={depth === 0 ? topRef : undefined}
            item={item}
            depth={depth}
            isTop={depth === 0}
            prefersReduced={Boolean(prefersReduced)}
            committingRef={committingRef}
            onExit={handleExit}
          />
        ))}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={`${styles.action} ${styles.skip}`}
          onClick={() => topRef.current?.flick("skip")}
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
          onClick={() => topRef.current?.flick("like")}
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

interface SwipeCardProps {
  item: MediaItem;
  depth: number;
  isTop: boolean;
  prefersReduced: boolean;
  committingRef: MutableRefObject<boolean>;
  onExit: (item: MediaItem, verdict: SwipeVerdict) => void;
}

const SwipeCard = forwardRef<CardHandle, SwipeCardProps>(function SwipeCard(
  { item, depth, isTop, prefersReduced, committingRef, onExit },
  ref,
) {
  // Each card owns its horizontal position — no value is ever shared between
  // cards, which is what keeps a departing card from disturbing the next one.
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-FLY_OUT, 0, FLY_OUT], [-16, 0, 16]);
  const likeOpacity = useTransform(x, [30, 120], [0, 1]);
  const skipOpacity = useTransform(x, [-120, -30], [1, 0]);

  const flyOff = useCallback(
    (verdict: SwipeVerdict) => {
      if (committingRef.current) return;
      committingRef.current = true;
      const to = verdict === "like" ? FLY_OUT : -FLY_OUT;
      if (prefersReduced) {
        onExit(item, verdict);
        return;
      }
      animate(x, to, { duration: 0.34, ease: EASE_OUT }).then(() => onExit(item, verdict));
    },
    [committingRef, prefersReduced, onExit, item, x],
  );

  useImperativeHandle(ref, () => ({ flick: flyOff }), [flyOff]);

  const onDragEnd = useCallback(
    (_e: unknown, info: PanInfo) => {
      const committed =
        Math.abs(info.offset.x) > COMMIT_PX || Math.abs(info.velocity.x) > FLICK_VELOCITY;
      if (!committed) {
        animate(x, 0, { type: "spring", stiffness: 500, damping: 34 });
        return;
      }
      const verdict: SwipeVerdict =
        info.offset.x > 0 || info.velocity.x > FLICK_VELOCITY ? "like" : "skip";
      flyOff(verdict);
    },
    [x, flyOff],
  );

  return (
    <motion.div
      className={`${styles.card} ${isTop ? "" : styles.behind}`}
      // x + rotate (drag) and scale + y (depth) are independent props, so the
      // drag and the promotion never fight. Depth changes spring via `animate`.
      style={isTop ? { x, rotate } : { x: 0 }}
      animate={{ scale: depthScale(depth), y: depthY(depth) }}
      transition={SPRING.gentle}
      drag={isTop && !prefersReduced ? "x" : false}
      dragElastic={0.6}
      dragMomentum={false}
      onDragEnd={isTop ? onDragEnd : undefined}
    >
      <CardFace item={item} />
      {isTop && (
        <>
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
        </>
      )}
    </motion.div>
  );
});

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
