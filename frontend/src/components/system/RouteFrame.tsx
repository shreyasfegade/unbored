import { Suspense, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ErrorBoundary } from "../ErrorBoundary";
import styles from "./RouteFrame.module.css";

/** What a route shows while its code chunk loads: the page's frame, quietly. */
export function RouteSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="Loading">
      <span className={styles.bar} style={{ width: "42%" }} />
      <span className={styles.bar} style={{ width: "68%" }} />
      <span className={styles.block} />
    </div>
  );
}

/**
 * Every route gets its own error boundary and loading state, so one broken
 * page never takes the header, nav or the other pages down with it. Keyed on
 * the path, so navigating away clears the error.
 */
export function RouteFrame({ label, children }: { label: string; children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary key={pathname} label={`route:${label}`}>
      <Suspense fallback={<RouteSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}
