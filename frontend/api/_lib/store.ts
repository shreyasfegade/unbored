/**
 * Quota counters and the reason cache, in Supabase (migration 0002_ai.sql).
 *
 * Only the service-role key can touch these tables (RLS on, no policies), and
 * only these functions hold that key. IPs are stored as salted SHA-256 hashes,
 * never raw. Without Supabase configured (local dev) everything falls back to
 * per-instance memory, which is fine for a laptop and weak for production, so
 * health reports it.
 */
import { createHash } from "node:crypto";

const url = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
export const storeConfigured = () => !!(url() && key());

const TIMEOUT_MS = 2500;

async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${url()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key() as string,
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`supabase ${path} ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-vercel-forwarded-for") || req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";
  return fwd.split(",")[0].trim() || "unknown";
}

export function ipHash(ip: string): string {
  return createHash("sha256").update(`${process.env.IP_HASH_SALT ?? "unbored-dev"}|${ip}`).digest("hex").slice(0, 32);
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const today = () => new Date().toISOString().slice(0, 10);
export const thisMinute = () => new Date().toISOString().slice(0, 16);

// ── In-memory fallback ─────────────────────────────────────────────
const memCounts = new Map<string, number>();
const memCache = new Map<string, { result: unknown; at: number }>();
const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;

export interface Take {
  allowed: boolean;
  used: number;
}

/** Count one use against (bucket, ip) and a global cap. Never exceeds `limit`. */
export async function take(bucket: string, ip: string, limit: number, globalLimit: number | null): Promise<Take> {
  if (!storeConfigured()) {
    const k = `${bucket}|${ip}`;
    const g = `${bucket}|*`;
    const used = memCounts.get(k) ?? 0;
    if (used >= limit || (globalLimit !== null && (memCounts.get(g) ?? 0) >= globalLimit)) return { allowed: false, used };
    memCounts.set(k, used + 1);
    memCounts.set(g, (memCounts.get(g) ?? 0) + 1);
    return { allowed: true, used: used + 1 };
  }
  const rows = (await rest("rpc/ai_take", {
    method: "POST",
    body: JSON.stringify({ p_bucket: bucket, p_ip_hash: ip, p_limit: limit, p_global_limit: globalLimit }),
  })) as { allowed: boolean; used: number }[];
  const row = rows?.[0] ?? { allowed: false, used: limit };
  if (Math.random() < 0.01) void rest("rpc/ai_prune", { method: "POST", body: "{}" }).catch(() => {});
  return { allowed: row.allowed, used: row.used };
}

export async function used(bucket: string, ip: string): Promise<number> {
  if (!storeConfigured()) return memCounts.get(`${bucket}|${ip}`) ?? 0;
  const rows = (await rest(
    `ai_usage?select=count&bucket=eq.${encodeURIComponent(bucket)}&ip_hash=eq.${encodeURIComponent(ip)}`,
  )) as { count: number }[];
  return rows?.[0]?.count ?? 0;
}

export async function cacheGet<T>(k: string): Promise<T | null> {
  if (!storeConfigured()) {
    const hit = memCache.get(k);
    return hit && Date.now() - hit.at < CACHE_TTL_MS ? (hit.result as T) : null;
  }
  const rows = (await rest(`ai_reason_cache?select=result,created_at&key=eq.${k}`)) as { result: T; created_at: string }[];
  const row = rows?.[0];
  if (!row || Date.now() - Date.parse(row.created_at) > CACHE_TTL_MS) return null;
  return row.result;
}

export async function cachePut(k: string, result: unknown): Promise<void> {
  if (!storeConfigured()) {
    memCache.set(k, { result, at: Date.now() });
    return;
  }
  await rest("ai_reason_cache?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ key: k, result, created_at: new Date().toISOString() }),
  });
}
