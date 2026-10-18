/**
 * Report a function crash to Sentry when SENTRY_DSN is set, without the SDK:
 * one envelope POST, so cold starts stay small. Never includes request
 * headers or bodies (they can carry a visitor's own API key).
 */
import { randomUUID } from "node:crypto";

function parseDsn(dsn: string) {
  const m = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(dsn.trim());
  return m ? { key: m[1], host: m[2], project: m[3] } : null;
}

export async function reportError(err: unknown, route: string): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  const parts = dsn ? parseDsn(dsn) : null;
  if (!parts) return;
  const e = err instanceof Error ? err : new Error(String(err));
  const eventId = randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    environment: process.env.VERCEL_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tags: { route },
    exception: { values: [{ type: e.name, value: e.message }] },
    extra: { stack: e.stack?.split("\n").slice(0, 12).join("\n") },
  };
  const body = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
  try {
    await fetch(`https://${parts.host}/api/${parts.project}/envelope/?sentry_key=${parts.key}&sentry_version=7`, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body,
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    /* reporting is best-effort */
  }
}

type Handler = (req: Request) => Promise<Response>;

/** Wrap a route handler: an unexpected throw is reported and answered with a
 *  plain 500 that the browser treats as "AI unavailable". */
export function guarded(route: string, handler: Handler): Handler {
  return async (req) => {
    try {
      return await handler(req);
    } catch (err) {
      console.error(`[${route}]`, (err as Error)?.message);
      await reportError(err, route);
      return new Response(JSON.stringify({ detail: "Internal error", error_code: "INTERNAL_ERROR" }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
  };
}
