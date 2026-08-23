import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useLibraryStore } from "../stores/libraryStore";
import { getCatalogItem } from "../api/media";
import type { MediaItem } from "../types/media";
import { sizedPoster } from "../utils/poster";
import PosterArt from "../components/poster/PosterArt";
import styles from "./LibraryPage.module.css";

type Tab = "watchlist" | "seen" | "notInterested";

const TABS: { key: Tab; label: string }[] = [
  { key: "watchlist", label: "Watchlist" },
  { key: "seen", label: "Seen" },
  { key: "notInterested", label: "Not for me" },
];

export default function LibraryPage() {
  const navigate = useNavigate();
  const watchlist = useLibraryStore((s) => s.watchlist);
  const seen = useLibraryStore((s) => s.seen);
  const notInterested = useLibraryStore((s) => s.notInterested);
  const removeFromWatchlist = useLibraryStore((s) => s.removeFromWatchlist);
  const unmarkSeen = useLibraryStore((s) => s.unmarkSeen);
  const unmarkNotInterested = useLibraryStore((s) => s.unmarkNotInterested);

  const [tab, setTab] = useState<Tab>("watchlist");
  // Seen / not-interested are stored as bare ids, so resolve them for display.
  const [resolved, setResolved] = useState<Record<string, MediaItem>>({});

  const ids = tab === "seen" ? seen : tab === "notInterested" ? notInterested : [];

  useEffect(() => {
    let cancelled = false;
    const missing = ids.filter((id) => !resolved[id]);
    if (missing.length === 0) return;
    Promise.all(
      missing.map((id) => getCatalogItem(id).then((r) => r.data).catch(() => null)),
    ).then((items) => {
      if (cancelled) return;
      const next: Record<string, MediaItem> = {};
      items.forEach((it) => { if (it) next[it.id] = it; });
      if (Object.keys(next).length) setResolved((prev) => ({ ...prev, ...next }));
    });
    return () => { cancelled = true; };
  }, [ids, resolved]);

  const items: MediaItem[] =
    tab === "watchlist" ? watchlist : ids.map((id) => resolved[id]).filter(Boolean);

  const remove = (id: string) => {
    if (tab === "watchlist") removeFromWatchlist(id);
    else if (tab === "seen") unmarkSeen(id);
    else unmarkNotInterested(id);
  };

  const counts: Record<Tab, number> = {
    watchlist: watchlist.length,
    seen: seen.length,
    notInterested: notInterested.length,
  };

  const emptyCopy: Record<Tab, string> = {
    watchlist: "Nothing saved yet. Hit ☆ Watchlist on a pick to keep it for later.",
    seen: "Titles you mark as seen land here, and stop showing up in your picks.",
    notInterested: "Titles you rule out land here, and won't be suggested again.",
  };

  return (
    <div className={styles.page}>
      <button className={styles.back} onClick={() => navigate("/")}>← Back</button>

      <motion.h1
        className={styles.heading}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        Your library
      </motion.h1>

      <div className={styles.tabs} role="tablist" aria-label="Library sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`${styles.tab} ${tab === t.key ? styles.tabActive : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} {counts[t.key] > 0 && <span className={styles.count}>{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className={styles.empty}>
          <p>{emptyCopy[tab]}</p>
          <Link to="/" className={styles.cta}>Get a pick</Link>
        </div>
      ) : (
        <ul className={styles.grid}>
          {items.map((item) => (
            <li key={item.id} className={styles.cell}>
              <Link to={`/pick/${item.id}`} className={styles.poster} aria-label={item.title}>
                {item.poster_path ? (
                  <img src={sizedPoster(item.poster_path, "card")} alt="" loading="lazy" />
                ) : (
                  <PosterArt item={item} />
                )}
              </Link>
              <span className={styles.title}>{item.title}</span>
              <button
                className={styles.remove}
                onClick={() => remove(item.id)}
                aria-label={`Remove ${item.title}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
