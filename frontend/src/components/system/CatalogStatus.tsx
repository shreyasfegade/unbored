import { useCallback, useEffect, useState } from "react";
import { engine } from "../../engine/client";
import { loadCatalog } from "../../engine/pack";
import styles from "./CatalogStatus.module.css";

/**
 * Starts loading the catalog and the engine as soon as the app mounts, and
 * only shows itself if that fails. There's no server to wake any more, so
 * there's nothing to wait for on the happy path: pages show their own
 * skeletons for the second or two the pack takes on a first visit, and it
 * comes from the service worker after that.
 */
export default function CatalogStatus() {
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    try {
      await Promise.all([loadCatalog(), engine.warm()]);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    // Deferred a tick so the first render never waits on (or sets state
    // during) the effect itself.
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  if (!failed) return null;

  return (
    <div className={styles.bar} role="alert">
      <div className={styles.text}>
        <strong className={styles.title}>The catalog didn&rsquo;t load.</strong>
        <span className={styles.copy}>
          {navigator.onLine === false
            ? "You're offline, and it hasn't been saved on this device yet."
            : "Check your connection and give it another go."}
        </span>
      </div>
      <button
        className={styles.retry}
        disabled={retrying}
        onClick={() => {
          setRetrying(true);
          void load();
        }}
      >
        {retrying ? "Loading…" : "Retry"}
      </button>
    </div>
  );
}
