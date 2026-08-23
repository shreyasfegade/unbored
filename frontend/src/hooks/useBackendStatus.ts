import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';

export type BackendStatus = 'probing' | 'asleep' | 'waking' | 'ready' | 'error';

/** Render's free tier reports ~50s to wake; the bar is paced against this. */
const EXPECTED_WAKE_MS = 50_000;
/** A warm backend answers well inside this; anything slower means it's asleep. */
const PROBE_TIMEOUT_MS = 3_000;
const POLL_MS = 2_500;
const GIVE_UP_MS = 150_000;

interface BackendState {
  status: BackendStatus;
  /** 0–1. Eases toward 0.95 over the expected wake, then snaps to 1 on ready. */
  progress: number;
  elapsedMs: number;
  /** Begin (or retry) waking. The probe runs automatically; this is the button. */
  start: () => void;
}

/**
 * Probes the API and, when it's cold, tracks the wake so the UI can show honest
 * progress instead of a spinner that says nothing.
 *
 * The bar is deliberately asymptotic: it approaches but never reaches 100% on a
 * timer, so it can't finish early and then sit there lying. Only a real health
 * response completes it.
 */
export function useBackendStatus(): BackendState {
  const [status, setStatus] = useState<BackendStatus>('probing');
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef<number | null>(null);
  const cancelled = useRef(false);
  const polling = useRef(false);

  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    setStatus('waking');
    startedAt.current ??= Date.now();

    while (!cancelled.current) {
      try {
        await api.get('/api/health', { timeout: POLL_MS * 2 });
        if (!cancelled.current) setStatus('ready');
        break;
      } catch {
        if (cancelled.current) break;
        const waited = Date.now() - (startedAt.current ?? Date.now());
        setElapsedMs(waited);
        if (waited > GIVE_UP_MS) {
          setStatus('error');
          break;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    }
    polling.current = false;
  }, []);

  // Quick probe on mount: a warm backend should never see the wake screen.
  useEffect(() => {
    cancelled.current = false;
    (async () => {
      try {
        await api.get('/api/health', { timeout: PROBE_TIMEOUT_MS });
        if (!cancelled.current) setStatus('ready');
      } catch {
        if (!cancelled.current) setStatus('asleep');
      }
    })();
    return () => { cancelled.current = true; };
  }, []);

  // Tick the elapsed clock only while actually waking.
  useEffect(() => {
    if (status !== 'waking') return;
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - (startedAt.current ?? Date.now()));
    }, 250);
    return () => window.clearInterval(id);
  }, [status]);

  // Exponential ease-out: fast at first, asymptotic to 95%. Only `ready` fills it.
  const progress =
    status === 'ready'
      ? 1
      : 0.95 * (1 - Math.exp(-2.6 * (elapsedMs / EXPECTED_WAKE_MS)));

  return { status, progress, elapsedMs, start: poll };
}
