import { lazy, type ComponentType } from "react";

const RELOADED = "unbored-chunk-reload";

/** True for the errors browsers raise when a code-split chunk can't load,
 *  usually because a deploy replaced it while the tab was open. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return /dynamically imported module|Importing a module script failed|error loading dynamically|Loading chunk|ChunkLoadError/i.test(msg);
}

/**
 * React.lazy that survives a deploy: retry the import once, and if the chunk is
 * really gone, reload the page once to pick up the new build. A second failure
 * in the same session is left to the route's error boundary.
 */
export function lazyRetry<T extends ComponentType<object>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (first) {
      try {
        return await factory();
      } catch (second) {
        if (isChunkLoadError(second) && !sessionStorage.getItem(RELOADED)) {
          sessionStorage.setItem(RELOADED, "1");
          window.location.reload();
          return new Promise<never>(() => {});
        }
        throw second ?? first;
      }
    }
  });
}
