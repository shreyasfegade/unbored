/**
 * Serve the real data pack (public/data) to `fetch` in tests, so the app runs
 * the real catalog and engine instead of mocks.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";

const DATA = resolve(__dirname, "../../public/data");

export function servePack(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const real = globalThis.fetch;
  const fake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, "http://localhost").pathname;
    for (const [prefix, respond] of Object.entries(overrides)) {
      if (path.startsWith(prefix)) return respond();
    }
    if (path.startsWith("/data/")) {
      try {
        return new Response(readFileSync(resolve(DATA, path.slice("/data/".length))));
      } catch {
        return new Response("not found", { status: 404 });
      }
    }
    return real ? real(input, init) : new Response("offline", { status: 503 });
  });
  vi.stubGlobal("fetch", fake);
  return fake;
}
