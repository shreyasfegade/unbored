import { useState } from "react";
import type { MediaItem, WatchProvider } from "../../types/media";
import { REGION_NAME, logoUrl, searchUrl, watchOptions } from "./watchOptions";
import styles from "./WatchPanel.module.css";

function ProviderChip({ p, href }: { p: WatchProvider; href: string | null }) {
  const [broken, setBroken] = useState(false);
  const src = logoUrl(p.logo);
  const body = (
    <>
      {src && !broken ? (
        <img className={styles.logo} src={src} alt="" width={24} height={24} loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span className={styles.logoFallback} aria-hidden="true">{p.name.charAt(0)}</span>
      )}
      <span>{p.name}</span>
    </>
  );
  return href ? (
    <a className={styles.chip} href={href} target="_blank" rel="noopener noreferrer">{body}</a>
  ) : (
    <span className={styles.chip}>{body}</span>
  );
}

/**
 * Where the pick is available, in India. Availability comes from TMDB, which
 * licenses it from JustWatch; TMDB requires the JustWatch credit wherever it's
 * shown. Anime falls back to AniList's streaming links, which say nothing about
 * region, so they're labelled that way.
 */
export function WatchPanel({ media }: { media: MediaItem }) {
  const opts = watchOptions(media);
  if (opts.kind === "unchecked") return null;

  return (
    <section className={styles.panel} aria-labelledby={`watch-${media.id}`}>
      <h3 className={styles.heading} id={`watch-${media.id}`}>
        {opts.kind === "links" ? "Streaming links" : `Where to watch in ${REGION_NAME}`}
      </h3>

      {opts.kind === "providers" && (
        <>
          {opts.stream.length > 0 ? (
            <div className={styles.row}>
              <span className={styles.label}>Stream</span>
              <div className={styles.chips}>
                {opts.stream.slice(0, 5).map((p) => <ProviderChip key={p.id} p={p} href={opts.link} />)}
              </div>
            </div>
          ) : (
            <p className={styles.empty}>Not on a subscription service in {REGION_NAME} right now.</p>
          )}
          {(opts.rent.length > 0 || opts.buy.length > 0) && (
            <div className={styles.row}>
              <span className={styles.label}>Rent or buy</span>
              <p className={styles.stores}>{[...opts.rent, ...opts.buy].slice(0, 4).map((p) => p.name).join(", ")}</p>
            </div>
          )}
          <p className={styles.credit}>
            Availability from{" "}
            <a href="https://www.justwatch.com" target="_blank" rel="noopener noreferrer">JustWatch</a>{" "}
            via TMDB. It changes often, so check before you settle in.
          </p>
        </>
      )}

      {opts.kind === "links" && (
        <>
          <div className={styles.chips}>
            {opts.links.slice(0, 5).map((l) => (
              <a key={l.url} className={styles.chip} href={l.url} target="_blank" rel="noopener noreferrer">
                <span className={styles.logoFallback} aria-hidden="true">{l.name.charAt(0)}</span>
                <span>{l.name}</span>
              </a>
            ))}
          </div>
          <p className={styles.credit}>Links from AniList. Not checked for {REGION_NAME}; some may be region-locked.</p>
        </>
      )}

      {opts.kind === "none" && (
        <p className={styles.empty}>
          Not streaming, renting or selling in {REGION_NAME} that we know of.{" "}
          {searchUrl(media) && (
            <a href={searchUrl(media)!} target="_blank" rel="noopener noreferrer">Search the web</a>
          )}
        </p>
      )}
    </section>
  );
}
