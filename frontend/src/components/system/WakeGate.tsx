import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useBackendStatus } from "../../hooks/useBackendStatus";
import { useTasteStore } from "../../stores/tasteStore";
import SwipeDeck, { type SwipeVerdict } from "../swipe/SwipeDeck";
import type { MediaItem } from "../../types/media";
import starterDeck from "../../data/starter-deck.json";
import styles from "./WakeGate.module.css";

// The bundled deck is a trimmed shape; widen it to what SwipeDeck expects.
const DECK = (starterDeck as Array<Partial<MediaItem>>).map((d) => ({
  overview: "",
  genres: [],
  keywords: [],
  cast: [],
  ...d,
})) as MediaItem[];

const BEATS = [
  "Unlocking the booth…",
  "Threading the reel…",
  "Focusing the lens…",
  "Dimming the lights…",
  "Almost showtime…",
];

/**
 * The free-tier API sleeps and takes about a minute to wake. Rather than hide
 * that behind a spinner, this makes the wait the first useful thing that
 * happens: the visitor swipes a deck that ships with the app (no API needed),
 * and whatever they keep becomes their taste the moment the server is up.
 */
export default function WakeGate() {
  const { status, progress, elapsedMs, start } = useBackendStatus();
  const addFavouriteIds = useTasteStore((s) => s.addFavouriteIds);
  const [started, setStarted] = useState(false);
  const [liked, setLiked] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);

  const shuffled = useMemo(() => {
    const d = [...DECK];
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }, []);

  // Bank the warm-up swipes as soon as there's a server to use them.
  useEffect(() => {
    if (status === "ready" && liked.length) {
      addFavouriteIds(liked);
      setLiked([]);
    }
  }, [status, liked, addFavouriteIds]);

  const visible = !dismissed && (status === "asleep" || status === "waking" || status === "error");
  const secondsLeft = Math.max(0, Math.ceil((50_000 - elapsedMs) / 1000));
  const beat = BEATS[Math.min(BEATS.length - 1, Math.floor(elapsedMs / 10_000))];

  const handleDecide = (item: MediaItem, verdict: SwipeVerdict) => {
    if (verdict === "like") setLiked((prev) => [...prev, item.id]);
  };

  const handleStart = () => {
    setStarted(true);
    start();
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={styles.gate}
          role="dialog"
          aria-modal="true"
          aria-label="Starting up"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          // While it fades out the node is still mounted; a full-screen overlay
          // would go on swallowing clicks, so it stops accepting them up front.
          exit={{ opacity: 0, pointerEvents: "none" }}
        >
          <div className={styles.inner}>
            <span className={styles.kicker}>Now showing</span>

            {!started ? (
              <>
                <h2 className={styles.heading}>The projector&rsquo;s asleep</h2>
                <p className={styles.copy}>
                  This runs on a free server that naps between visits — waking it takes
                  about a minute. Start it now and swipe a few titles while it warms up;
                  we&rsquo;ll have your taste ready by the time it&rsquo;s awake.
                </p>
                <button className={styles.start} onClick={handleStart}>
                  Roll the projector
                </button>
                <button className={styles.skip} onClick={() => setDismissed(true)}>
                  skip and wait quietly
                </button>
              </>
            ) : status === "error" ? (
              <>
                <h2 className={styles.heading}>The server didn&rsquo;t wake</h2>
                <p className={styles.copy}>It&rsquo;s taking unusually long. Give it another go.</p>
                <button className={styles.start} onClick={start}>Try again</button>
                <button className={styles.skip} onClick={() => setDismissed(true)}>
                  continue anyway
                </button>
              </>
            ) : (
              <>
                <h2 className={styles.heading}>{beat}</h2>
                <div
                  className={styles.barTrack}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress * 100)}
                  aria-label="Server startup"
                >
                  <motion.div
                    className={styles.barFill}
                    animate={{ width: `${progress * 100}%` }}
                    transition={{ ease: "linear", duration: 0.3 }}
                  />
                </div>
                <p className={styles.countdown}>
                  {secondsLeft > 0 ? `about ${secondsLeft}s left` : "any moment now…"}
                  {liked.length > 0 && ` · ${liked.length} saved`}
                </p>

                <div className={styles.deckWrap}>
                  <SwipeDeck
                    items={shuffled}
                    onDecide={handleDecide}
                    emptyMessage="Great taste. Hang tight — nearly there."
                  />
                </div>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
