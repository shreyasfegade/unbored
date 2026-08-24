import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useTasteStore } from "../stores/tasteStore";
import { getBrowseDeck } from "../api/browse";
import { sizedPoster } from "../utils/poster";
import type { MediaItem } from "../types/media";
import SwipeDeck, { type SwipeVerdict } from "../components/swipe/SwipeDeck";
import styles from "./SwipePage.module.css";

export default function SwipePage() {
  const navigate = useNavigate();
  const addFavouriteIds = useTasteStore((s) => s.addFavouriteIds);
  const favouriteIds = useTasteStore((s) => s.favouriteIds);

  const [deck, setDeck] = useState<MediaItem[]>([]);
  const [liked, setLiked] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  // Everything already judged or owned, so a refill never repeats a card.
  const decided = useRef<Set<string>>(new Set());

  const fetchDeck = useCallback(async (append: boolean) => {
    // Deferred: this runs from an effect on mount, and a synchronous setState
    // there cascades an extra render before the request is even in flight.
    queueMicrotask(() => {
      if (!append) setLoading(true);
      setError(false);
    });
    try {
      const { data } = await getBrowseDeck({
        limit: 30,
        exclude: [...decided.current, ...favouriteIds],
      });
      setDeck((prev) => (append ? [...prev, ...data.items] : data.items));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
    // favouriteIds is read as a snapshot for exclusion; refetching on every
    // like would rebuild the deck mid-swipe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchDeck(false); }, [fetchDeck]);

  const handleDecide = useCallback((item: MediaItem, verdict: SwipeVerdict) => {
    decided.current.add(item.id);
    if (verdict === "like") setLiked((prev) => [...prev, item]);
  }, []);

  const handleUndo = useCallback((item: MediaItem) => {
    decided.current.delete(item.id);
    setLiked((prev) => prev.filter((i) => i.id !== item.id));
  }, []);

  const loadMore = useCallback(() => {
    setExhausted(false);
    fetchDeck(true);
  }, [fetchDeck]);

  const commitLiked = useCallback(() => {
    if (liked.length) addFavouriteIds(liked.map((i) => i.id));
    sessionStorage.setItem("unbored-enrich-success", String(liked.length));
    navigate("/", { replace: true });
  }, [liked, addFavouriteIds, navigate]);

  return (
    <div className={styles.page}>
      <button className={styles.back} onClick={() => navigate(-1)}>← Back</button>

      <motion.h1
        className={styles.heading}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        Love it or leave it
      </motion.h1>
      <p className={styles.subtitle}>
        Swipe right on what you&rsquo;d watch, left on what you wouldn&rsquo;t —
        we read your taste from what you keep. Nothing here is saved until you add it.
      </p>

      {error && deck.length === 0 ? (
        <div className={styles.empty}>
          <p>Couldn&rsquo;t load the deck.</p>
          <button className={styles.retry} onClick={() => fetchDeck(false)}>Try again</button>
        </div>
      ) : loading ? (
        <div className={styles.skeleton} aria-label="Loading titles" />
      ) : exhausted ? (
        <EndCard liked={liked} onAdd={commitLiked} onMore={loadMore} onDone={() => navigate("/")} />
      ) : (
        <SwipeDeck
          items={deck}
          onDecide={handleDecide}
          onUndo={handleUndo}
          onRunningLow={() => fetchDeck(true)}
          onExhausted={() => setExhausted(true)}
          emptyMessage="You've been through the deck — nice work."
        />
      )}

      {/* Mid-swipe shortcut: bank what you've liked without reaching the end.
          Docked above the bottom nav (see .commitBar). */}
      {!exhausted && liked.length > 0 && (
        <div className={styles.commitBar}>
          <motion.button
            className={styles.commit}
            onClick={commitLiked}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            whileTap={{ scale: 0.97 }}
          >
            Add {liked.length} to my taste
          </motion.button>
        </div>
      )}
    </div>
  );
}

function EndCard({
  liked,
  onAdd,
  onMore,
  onDone,
}: {
  liked: MediaItem[];
  onAdd: () => void;
  onMore: () => void;
  onDone: () => void;
}) {
  return (
    <motion.div
      className={styles.endCard}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <h2 className={styles.endTitle}>
        {liked.length > 0 ? `You kept ${liked.length}` : "That's the deck"}
      </h2>
      <p className={styles.endSub}>
        {liked.length > 0
          ? "Add them to sharpen your picks, or keep going for more."
          : "Nothing caught your eye — try a few more."}
      </p>

      {liked.length > 0 && (
        <div className={styles.endPosters}>
          {liked.slice(-8).map((m) => (
            <div key={m.id} className={styles.endPoster}>
              {m.poster_path ? <img src={sizedPoster(m.poster_path, "thumb")} alt={m.title} /> : null}
            </div>
          ))}
        </div>
      )}

      <div className={styles.endActions}>
        {liked.length > 0 && (
          <button className={styles.endPrimary} onClick={onAdd}>
            Add {liked.length} to my taste
          </button>
        )}
        <button className={styles.endSecondary} onClick={onMore}>Show me more</button>
        <button className={styles.endGhost} onClick={onDone}>Done</button>
      </div>
    </motion.div>
  );
}
