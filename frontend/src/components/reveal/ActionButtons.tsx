import { useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { useRecommendationStore } from "../../stores/recommendationStore";
import { useToastStore } from "../../stores/toastStore";
import { useLibraryStore } from "../../stores/libraryStore";
import type { MediaItem } from "../../types/media";
import { pressableFlat } from "../../config/motion";
import { downloadCard, sharePick } from "../../share/shareCard";
import styles from "./ActionButtons.module.css";

interface ActionButtonsProps {
  onRegenerate: () => void;
  onStartOver: () => void;
  watchUrl: string | null;
  shareId: string | null;
  media: MediaItem;
  reason?: string | null;
}

export function ActionButtons({ onRegenerate, onStartOver, watchUrl, shareId, media, reason = null }: ActionButtonsProps) {
  const prefersReduced = useReducedMotion();
  const recStatus = useRecommendationStore((s) => s.status);
  const isRegenerating = recStatus === "regenerating";
  const addToast = useToastStore((s) => s.addToast);
  const [showMore, setShowMore] = useState(false);

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

  const [sharing, setSharing] = useState(false);
  const shareInput = () => ({ media, reason, url: `${window.location.origin}/pick/${shareId}` });

  const handleShare = async () => {
    if (!shareId || sharing) return;
    setSharing(true);
    const outcome = await sharePick(shareInput());
    setSharing(false);
    if (outcome === "copied") addToast("Link copied — share your pick.");
    else if (outcome === "failed") addToast("Couldn't share from this browser. Try saving the image instead.");
  };

  const handleSaveImage = async () => {
    if (!shareId || sharing) return;
    setSharing(true);
    const ok = await downloadCard(shareInput());
    setSharing(false);
    addToast(ok ? "Saved the card to your downloads." : "Couldn't make the image in this browser.");
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
        <motion.button
          className={`${styles.verdict} ${saved ? styles.verdictOn : ""}`}
          onClick={handleSave}
          aria-pressed={saved}
          whileHover={pressableFlat.whileHover}
          whileTap={pressableFlat.whileTap}
          transition={pressableFlat.transition}
        >
          {saved ? "★ Saved" : "☆ Watchlist"}
        </motion.button>
        <motion.button
          className={styles.verdict}
          onClick={handleSeen}
          disabled={isRegenerating}
          whileHover={pressableFlat.whileHover}
          whileTap={pressableFlat.whileTap}
          transition={pressableFlat.transition}
        >
          ✓ Seen it
        </motion.button>
        <motion.button
          className={styles.verdict}
          onClick={handleNotInterested}
          disabled={isRegenerating}
          whileHover={pressableFlat.whileHover}
          whileTap={pressableFlat.whileTap}
          transition={pressableFlat.transition}
        >
          ✕ Not for me
        </motion.button>
      </motion.div>

      {/* Everything past the verdicts is occasional, and ten equally-weighted
          buttons made none of them readable. Tucked behind one disclosure. */}
      <motion.div
        className={styles.minor}
        variants={row}
        initial={prefersReduced ? false : "initial"}
        animate="animate"
        custom={3}
      >
        <button
          className={styles.link}
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
        >
          {showMore ? "Fewer options" : "More options"}
        </button>
      </motion.div>

      {showMore && (
        <motion.div
          className={styles.more}
          initial={prefersReduced ? false : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Link to="/enrich" className={styles.tune}>
            <span aria-hidden="true">✎</span> Tune your taste for sharper picks
          </Link>
          <div className={styles.moreRow}>
            {shareId && (
              <>
                <button className={styles.link} onClick={handleShare} disabled={sharing}>
                  {sharing ? "Preparing…" : "Share pick"}
                </button>
                <button className={styles.link} onClick={handleSaveImage} disabled={sharing}>Save as image</button>
              </>
            )}
            <Link to="/together" className={styles.link}>Watch together</Link>
            <Link to="/taste" className={styles.link}>See your taste</Link>
          </div>
        </motion.div>
      )}

      <motion.div
        className={styles.minor}
        variants={row}
        initial={prefersReduced ? false : "initial"}
        animate="animate"
        custom={4}
      >
        <button className={styles.link} onClick={onStartOver} disabled={isRegenerating}>
          Start over
        </button>
      </motion.div>
    </div>
  );
}
