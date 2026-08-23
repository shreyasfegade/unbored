import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { getCatalogItem } from "../api/media";
import PosterArt from "../components/poster/PosterArt";
import { sizedPoster } from "../utils/poster";
import type { MediaItem } from "../types/media";
import styles from "./PickPage.module.css";

/** Standalone, shareable/bookmarkable view of a single pick (/pick/:mediaId).
 *  No onboarding gate — a recipient with no account can see the pick and is
 *  invited to get their own. This is the app's cheapest growth loop. */
export default function PickPage() {
  const { mediaId = "" } = useParams();
  const [item, setItem] = useState<MediaItem | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Defer the reset off the synchronous effect body; item/status are otherwise
    // only set from the async callbacks.
    queueMicrotask(() => { if (!cancelled) setStatus("loading"); });
    getCatalogItem(mediaId)
      .then((res) => { if (!cancelled) { setItem(res.data); setStatus("ready"); } })
      .catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [mediaId]);

  const showArt = !item?.poster_path || imgFailed;

  return (
    <div className={styles.page}>
      {status === "loading" && <p className={styles.muted}>Loading pick…</p>}

      {status === "error" && (
        <div className={styles.center}>
          <p className={styles.muted}>That pick couldn't be found.</p>
          <Link to="/" className={styles.cta}>Find your own pick →</Link>
        </div>
      )}

      {status === "ready" && item && (
        <motion.div
          className={styles.card}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className={styles.kicker}>Someone's perfect pick</span>
          <div className={styles.poster}>
            {showArt ? (
              <PosterArt item={item} />
            ) : (
              <img
                src={sizedPoster(item.poster_path, "card")}
                alt={item.title}
                width={260}
                height={390}
                onError={() => setImgFailed(true)}
              />
            )}
          </div>
          <h1 className={styles.title}>{item.title}</h1>
          <p className={styles.meta}>
            {item.release_year ?? item.year ?? ""}
            {item.runtime_minutes ? ` · ${item.runtime_minutes} min` : ""}
          </p>
          {item.genres.length > 0 && (
            <div className={styles.genres}>
              {item.genres.slice(0, 4).map((g) => (
                <span key={g} className={styles.genre}>{g}</span>
              ))}
            </div>
          )}
          {item.overview && <p className={styles.overview}>{item.overview}</p>}
          <Link to="/" className={styles.cta}>Get your own pick →</Link>
        </motion.div>
      )}
    </div>
  );
}
