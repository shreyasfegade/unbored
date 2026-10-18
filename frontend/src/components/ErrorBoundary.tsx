import { Component, type ErrorInfo, type ReactNode } from "react";
import { isChunkLoadError } from "../lib/lazyRetry";
import { reportError } from "../lib/monitoring";
import styles from "./ErrorBoundary.module.css";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  label?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Without this, a render crash left no trace at all in production.
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, error, info.componentStack);
    reportError(error, { boundary: this.props.label, componentStack: info.componentStack });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const stale = isChunkLoadError(this.state.error);

      return (
        <div className={styles.container} role="alert">
          <span className={styles.kicker}>{stale ? "New version" : "Projector jam"}</span>
          <p className={styles.message}>
            {stale
              ? "Unbored was updated while this tab was open, so this page needs a reload."
              : "This part of the page hit a problem. The rest of the app is fine."}
          </p>
          <button
            className={styles.reloadBtn}
            onClick={stale ? () => window.location.reload() : this.handleReset}
          >
            {stale ? "Reload" : "Try again"}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
