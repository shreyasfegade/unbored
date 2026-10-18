import { useState } from "react";
import type { MediaItem } from "../../types/media";
import styles from "./Trailer.module.css";

/**
 * The official trailer, behind a click. Nothing loads from YouTube until it's
 * asked for, and then from youtube-nocookie.com, which sets no tracking
 * cookies until playback. Starts muted so it never blares.
 */
export function Trailer({ media }: { media: MediaItem }) {
  const [playing, setPlaying] = useState(false);
  const [thumbBroken, setThumbBroken] = useState(false);
  const key = media.trailer?.site === "youtube" ? media.trailer.key : null;
  if (!key || !/^[\w-]{6,20}$/.test(key)) return null;

  if (playing) {
    return (
      <div className={styles.frame}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${key}?autoplay=1&mute=1&rel=0&playsinline=1`}
          title={`${media.title} trailer`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }

  return (
    <button className={styles.poster} onClick={() => setPlaying(true)} aria-label={`Play the ${media.title} trailer`}>
      {!thumbBroken && (
        <img
          src={`https://i.ytimg.com/vi/${key}/hqdefault.jpg`}
          alt=""
          loading="lazy"
          onError={() => setThumbBroken(true)}
        />
      )}
      <span className={styles.play}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
        Play trailer
      </span>
      <span className={styles.note}>Loads from YouTube</span>
    </button>
  );
}
