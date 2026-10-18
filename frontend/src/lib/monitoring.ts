/**
 * Error reporting (Sentry), only when VITE_SENTRY_DSN is set.
 *
 * The SDK loads lazily after first paint, so it costs nothing up front and a
 * deployment without a DSN never downloads it. Errors raised before it loads
 * are queued. Nothing personal is sent: no IPs, no cookies, no request
 * headers, and anything that looks like an API key is scrubbed.
 */
type Sentry = typeof import("@sentry/react");

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
let sentry: Sentry | null = null;
const queue: [unknown, Record<string, unknown> | undefined][] = [];

const KEYISH = /(AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z]{16,}|x-llm-key[^,}]*)/gi;

function scrub<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value).replace(KEYISH, "[scrubbed]")) as T;
  } catch {
    return value;
  }
}

export const monitoringEnabled = Boolean(DSN);

export function initMonitoring(): void {
  if (!DSN || typeof window === "undefined") return;
  const load = () =>
    import("@sentry/react").then((mod) => {
      mod.init({
        dsn: DSN,
        environment: import.meta.env.MODE,
        release: import.meta.env.VITE_RELEASE as string | undefined,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        beforeSend(event) {
          if (event.request) {
            delete event.request.headers;
            delete event.request.cookies;
          }
          if (event.user) event.user = { id: event.user.id };
          return scrub(event);
        },
      });
      sentry = mod;
      for (const [err, ctx] of queue.splice(0)) mod.captureException(err, ctx ? { extra: ctx } : undefined);
    }).catch(() => {
      /* reporting is best-effort */
    });
  if ("requestIdleCallback" in window) window.requestIdleCallback(() => void load(), { timeout: 4000 });
  else setTimeout(() => void load(), 2000);

  window.addEventListener("error", (e) => reportError(e.error ?? e.message, { source: "window.onerror" }));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, { source: "unhandledrejection" }));
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!DSN) return;
  if (sentry) sentry.captureException(error, context ? { extra: context } : undefined);
  else if (queue.length < 20) queue.push([error, context]);
}
