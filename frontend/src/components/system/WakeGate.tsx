import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useBackendStatus } from "../../hooks/useBackendStatus";
import { useTasteStore } from "../../stores/tasteStore";
import SwipeDeck, { type SwipeVerdict } from "../swipe/SwipeDeck";
import type { MediaItem } from "../../types/media";
import starterDeck from "../../data/starter-deck.json";
import styles from "./WakeGate.module.css";

// The bundled deck is a trimmed shape; widen it to what SwipeDeck expects.
// Shuffled once at module load rather than during render, so the component
// stays pure and everyone doesn't see the same first card every time.
const DECK = shuffle(
  (starterDeck as Array<Partial<MediaItem>>).map((d) => ({
    overview: "",
    genres: [],
    keywords: [],
    cast: [],
    ...d,
  })) as MediaItem[],
);

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

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

  // Mirrors `liked` so the banking effect can read it without depending on it
  // (and therefore without having to clear state from inside an effect).
  const likedRef = useRef<string[]>([]);
  const banked = useRef(false);

  // Bank the warm-up swipes as soon as there's a server to use them.
  useEffect(() => {
    if (status !== "ready" || banked.current) return;
    banked.current = true;
    if (likedRef.current.length) addFavouriteIds(likedRef.current);
  }, [status, addFavouriteIds]);

  const visible = !dismissed && (status === "asleep" || status === "waking" || status === "error");
  const secondsLeft = Math.max(0, Math.ceil((50_000 - elapsedMs) / 1000));
  const beat = BEATS[Math.min(BEATS.length - 1, Math.floor(elapsedMs / 10_000))];

  const handleDecide = (item: MediaItem, verdict: SwipeVerdict) => {
    if (verdict !== "like") return;
    likedRef.current = [...likedRef.current, item.id];
    setLiked(likedRef.current);
  };

  const handleStart = () => {
    setStarted(true);
    start();
  };

  // Deliberately not wrapped in AnimatePresence: this is a full-screen overlay,
  // so an exit animation that stalls would leave an invisible sheet swallowing
  // every click. It unmounts the instant the server is ready.
  return (
    <>
      {visible && (
        <motion.div
          className={styles.gate}
          role="dialog"
          aria-modal="true"
          aria-label="Starting up"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
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
                    items={DECK}
                    onDecide={handleDecide}
                    emptyMessage="Great taste. Hang tight — nearly there."
                  />
                </div>
              </>
            )}
          </div>
        </motion.div>
      )}
    </>
  );
}
