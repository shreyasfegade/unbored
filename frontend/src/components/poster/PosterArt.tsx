import type { MediaItem } from "../../types/media";
import styles from "./PosterArt.module.css";

/**
 * A procedural, on-brand "poster" rendered entirely in the browser — used when
 * a title has no artwork (every demo-mode item, or any image that fails to
 * load). Deterministic: the same title always gets the same look.
 */

// Deep, cinematic duotones that sit comfortably on the dark background.
const GRADIENTS: [string, string][] = [
  ["#2a1f3d", "#0c0b16"], // violet night
  ["#1f2d3d", "#0b1016"], // deep ocean
  ["#3d2a1f", "#160f0b"], // warm amber (brand)
  ["#1f3d2e", "#0b1611"], // forest
  ["#3d1f2a", "#160b10"], // wine
  ["#2d2d3d", "#0d0d16"], // slate
  ["#3d301f", "#161109"], // ember
  ["#1f3a3d", "#0b1516"], // teal
];

const TYPE_GLYPH: Record<MediaItem["media_type"], string> = {
  movie: "FILM",
  tv: "SERIES",
  anime: "ANIME",
};

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

interface PosterArtProps {
  item: Pick<MediaItem, "title" | "media_type" | "genres" | "release_year" | "year">;
  className?: string;
}

export default function PosterArt({ item, className = "" }: PosterArtProps) {
  const h = hash(item.title || "Unbored");
  const [from, to] = GRADIENTS[h % GRADIENTS.length];
  const angle = 115 + (h % 50);
  const topGenre = item.genres?.[0];
  const year = item.release_year ?? item.year ?? null;

  return (
    <div
      className={`${styles.art} ${className}`}
      style={{ background: `linear-gradient(${angle}deg, ${from}, ${to})` }}
      role="img"
      aria-label={item.title}
    >
      <div className={styles.grain} aria-hidden="true" />
      <span className={styles.kind}>{TYPE_GLYPH[item.media_type]}</span>
      <span className={styles.title}>{item.title}</span>
      <span className={styles.meta}>
        {topGenre ? <span className={styles.genre}>{topGenre}</span> : null}
        {year ? <span className={styles.year}>{year}</span> : null}
      </span>
    </div>
  );
}
