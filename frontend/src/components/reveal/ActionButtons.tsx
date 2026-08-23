import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { useRecommendationStore } from "../../stores/recommendationStore";
import { useToastStore } from "../../stores/toastStore";
import { useLibraryStore } from "../../stores/libraryStore";
import type { MediaItem } from "../../types/media";
import styles from "./ActionButtons.module.css";

interface ActionButtonsProps {
  onRegenerate: () => void;
  onStartOver: () => void;
  watchUrl: string | null;
  shareId: string | null;
  media: MediaItem;
}

export function ActionButtons({ onRegenerate, onStartOver, watchUrl, shareId, media }: ActionButtonsProps) {
  const prefersReduced = useReducedMotion();
  const recStatus = useRecommendationStore((s) => s.status);
  const isRegenerating = recStatus === "regenerating";
  const addToast = useToastStore((s) => s.addToast);

  const watchlist = useLibraryStore((s) => s.watchlist);
  const addToWatchlist = useLibraryStore((s) => s.addToWatchlist);
  const removeFromWatchlist = useLibraryStore((s) => s.removeFromWatchlist);
  const markSeen = useLibraryStore((s) => s.markSeen);
  const markNotInterested = useLibraryStore((s) => s.markNotInterested);
  const saved = watchlist.some((w) => w.id === media.id);

  const handleSave = () => {
    if (saved) {
      removeFromWatchlist(media.id);
      addToast("Removed from your watchlist.");
    } else {
      addToWatchlist(media);
      addToast("Saved to your watchlist.");
    }
  };

  // Both verdicts permanently exclude the title, so each is followed by a fresh
  // pick — leaving a rejected title on screen would be a dead end.
  const handleSeen = () => {
    markSeen(media.id);
    addToast("Noted — we won't suggest it again.");
    onRegenerate();
  };

  const handleNotInterested = () => {
    markNotInterested(media.id);
    addToast("Got it — that one's off the list.");
    onRegenerate();
  };

  const handleShare = async () => {
    if (!shareId) return;
    const url = `${window.location.origin}/pick/${shareId}`;
    try {
      if (navigator.share) {
        await navigator.share({ url, title: "My Unbored pick" });
      } else {
        await navigator.clipboard.writeText(url);
        addToast("Link copied — share your pick.");
      }
    } catch {
      /* user cancelled the share sheet — nothing to do */
    }
  };

  const row = {
    initial: { opacity: 0, y: 16 },
    animate: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { delay: 0.3 + i * 0.07, duration: 0.3, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] },
    }),
  };

  return (
    <div className={styles.actions}>
      {watchUrl && (
        <motion.a
          className={styles.watch}
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          variants={row}
          initial={prefersReduced ? false : "initial"}
          animate="animate"
          custom={0}
          whileHover={prefersReduced ? {} : { scale: 1.02 }}
          whileTap={prefersReduced ? {} : { scale: 0.97 }}
        >
          <span className={styles.play} aria-hidden="true">▶</span> Where to watch
        </motion.a>
      )}

      <motion.button
        className={styles.regenerate}
        onClick={onRegenerate}
        disabled={isRegenerating}
        variants={row}
        initial={prefersReduced ? false : "initial"}
        animate="animate"
        custom={1}
        whileHover={!isRegenerating && !prefersReduced ? { scale: 1.02 } : {}}
        whileTap={!isRegenerating && !prefersReduced ? { scale: 0.97 } : {}}
      >
        {isRegenerating ? "Finding another…" : "Not feeling it — try again"}
      </motion.button>

      <motion.div
        className={styles.verdicts}
        variants={row}
        initial={prefersReduced ? false : "initial"}
        animate="animate"
        custom={2}
      >
        <button
          className={`${styles.verdict} ${saved ? styles.verdictOn : ""}`}
          onClick={handleSave}
          aria-pressed={saved}
        >
          {saved ? "★ Saved" : "☆ Watchlist"}
        </button>
        <button className={styles.verdict} onClick={handleSeen} disabled={isRegenerating}>
          ✓ Seen it
        </button>
        <button className={styles.verdict} onClick={handleNotInterested} disabled={isRegenerating}>
          ✕ Not for me
        </button>
      </motion.div>

      <motion.div
        variants={row}
        initial={prefersReduced ? false : "initial"}
        animate="animate"
        custom={3}
        style={{ width: "100%", display: "flex", justifyContent: "center" }}
      >
        <Link to="/enrich" className={styles.tune}>
          <span aria-hidden="true">✎</span> Tune your taste for sharper picks
        </Link>
      </motion.div>

      <motion.div
        className={styles.minor}
        variants={row}
        initial={prefersReduced ? false : "initial"}
        animate="animate"
        custom={4}
      >
        {shareId && (
          <>
            <button className={styles.link} onClick={handleShare}>
              Share pick
            </button>
            <span className={styles.dot} aria-hidden="true">·</span>
          </>
        )}
        <button className={styles.link} onClick={onStartOver} disabled={isRegenerating}>
          Start over
        </button>
      </motion.div>
    </div>
  );
}
