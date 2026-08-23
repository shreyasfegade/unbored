import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useTasteStore } from "../stores/tasteStore";
import { getBrowseDeck } from "../api/browse";
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
  // Everything already judged or owned, so a refill never repeats a card.
  const decided = useRef<Set<string>>(new Set());

  const fetchDeck = useCallback(async (append: boolean) => {
    if (!append) setLoading(true);
    setError(false);
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

  const handleDone = () => {
    if (liked.length) addFavouriteIds(liked.map((i) => i.id));
    sessionStorage.setItem("unbored-enrich-success", String(liked.length));
    navigate("/", { replace: true });
  };

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
        Swipe through a few titles — we&rsquo;ll read your taste from what you keep.
      </p>

      {error && deck.length === 0 ? (
        <div className={styles.empty}>
          <p>Couldn&rsquo;t load the deck.</p>
          <button className={styles.retry} onClick={() => fetchDeck(false)}>Try again</button>
        </div>
      ) : loading ? (
        <div className={styles.skeleton} aria-label="Loading titles" />
      ) : (
        <SwipeDeck
          items={deck}
          onDecide={handleDecide}
          onRunningLow={() => fetchDeck(true)}
          emptyMessage="You've been through the deck — nice work."
        />
      )}

      {liked.length > 0 && (
        <motion.button
          className={styles.done}
          onClick={handleDone}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          whileTap={{ scale: 0.97 }}
        >
          {`Add ${liked.length} to my taste`}
        </motion.button>
      )}
    </div>
  );
}
