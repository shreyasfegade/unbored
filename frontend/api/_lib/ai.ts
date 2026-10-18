/**
 * The AI layer behind /api/ai/*, as plain Request → Response handlers.
 *
 * The browser engine ranks and shortlists; these only ask the model to choose
 * and explain. Two ways in:
 *
 *  - Free tier: no key from the visitor, so the server's GEMINI_API_KEY is
 *    used, metered per hashed IP per day plus a global daily cap.
 *  - Your own key (X-LLM-Provider / X-LLM-Key): passed straight through, never
 *    stored or logged, only a per-minute burst limit.
 *
 * Requests carry catalog ids, never free text: titles are resolved here from
 * TITLES, so the shared key can't be used as a general-purpose LLM. Answers
 * are cached by (provider, mood, slot, type, shortlist, taste), and a cache hit
 * costs no quota. Any failure answers 200 with an `ai_status` that says what
 * happened, and the browser keeps the engine's own pick and reason.
 */
import { CURATOR_SYSTEM, EXPAND_SYSTEM, curatorPrompt, expandPrompt, parseCurator, parseExpansion, type Curated } from "./prompts";
import { deepseekModel, generate, geminiModel, type Outcome, type ProviderName } from "./providers";
import { cacheGet, cachePut, clientIp, ipHash, sha256, storeConfigured, take, thisMinute, today, used } from "./store";
import { TITLES } from "./titles.gen";

const MOODS = new Set(["happy_energetic", "tired_low", "anxious", "want_to_cry", "mindblown_curious", "want_to_laugh", "thrilled"]);
const SLOTS = new Set(["short", "medium", "long"]);
const TYPES = new Set(["movie", "tv", "anime", "surprise"]);
const ERAS = new Set(["any", "modern", "classic"]);

const freePerIp = () => Number(process.env.AI_FREE_DAILY_PER_IP || 20);
const freeGlobal = () => Number(process.env.AI_FREE_DAILY_GLOBAL || 900);
const BYO_PER_MINUTE = 20;
const CURATE_TIMEOUT_MS = 5000;
const EXPAND_TIMEOUT_MS = 3500;

export const freeTierConfigured = () => !!process.env.GEMINI_API_KEY;

export type AIStatus = "used" | "off" | "timeout" | "limited" | "error";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const bad = (detail: string) => json({ detail, error_code: "VALIDATION_ERROR" }, 400);

interface Caller {
  tier: "free" | "byo";
  provider: ProviderName;
  key: string;
  ip: string;
}

function caller(req: Request): Caller | "no-free-tier" | "bad-provider" {
  const userKey = req.headers.get("x-llm-key")?.trim();
  const ip = ipHash(clientIp(req));
  if (userKey) {
    const p = (req.headers.get("x-llm-provider") || "").trim().toLowerCase();
    if (p !== "gemini" && p !== "deepseek") return "bad-provider";
    return { tier: "byo", provider: p, key: userKey, ip };
  }
  if (!freeTierConfigured()) return "no-free-tier";
  return { tier: "free", provider: "gemini", key: process.env.GEMINI_API_KEY as string, ip };
}

function statusFor(outcome: Outcome): AIStatus {
  if (outcome === "timeout") return "timeout";
  if (outcome === "limited") return "limited";
  return "error";
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const stringList = (v: unknown, max: number): string[] | null =>
  Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string") ? (v as string[]) : null;

function likedTitles(ids: string[]): string[] {
  return ids.map((id) => TITLES[id]?.[0]).filter((t): t is string => !!t).slice(0, 8);
}

/** BYO keys get a burst limit only. Returns a response when over it. */
async function byoBurst(c: Caller): Promise<Response | null> {
  if (c.tier !== "byo") return null;
  try {
    const t = await take(`byo:${thisMinute()}`, c.ip, BYO_PER_MINUTE, null);
    return t.allowed ? null : json({ ai_status: "limited", tier: "byo" });
  } catch {
    return null; // a burst limiter that's down shouldn't block someone's own key
  }
}

async function remaining(ip: string): Promise<number | null> {
  try {
    return Math.max(0, freePerIp() - (await used(`free:${today()}`, ip)));
  } catch {
    return null;
  }
}

export async function curate(req: Request): Promise<Response> {
  const body = await readBody(req);
  if (!body) return bad("Expected a JSON body.");
  const favourites = stringList(body.favourite_ids ?? [], 100);
  const shortlist = stringList(body.shortlist_ids, 8);
  const mood = body.mood;
  const slot = body.time_available;
  const type = body.media_type ?? "surprise";
  if (!favourites) return bad("favourite_ids must be a list of up to 100 ids.");
  if (!shortlist || shortlist.length === 0) return bad("shortlist_ids must list 1 to 8 catalog ids.");
  if (shortlist.some((id) => !TITLES[id])) return bad("shortlist_ids must be catalog ids.");
  if (typeof mood !== "string" || !MOODS.has(mood)) return bad("Unknown mood.");
  if (typeof slot !== "string" || !SLOTS.has(slot)) return bad("Unknown time_available.");
  if (typeof type !== "string" || !TYPES.has(type)) return bad("Unknown media_type.");

  const c = caller(req);
  if (c === "bad-provider") return bad("Choose gemini or deepseek.");
  if (c === "no-free-tier") return json({ ai_status: "off", tier: null });
  const limited = await byoBurst(c);
  if (limited) return limited;

  const liked = likedTitles(favourites);
  const cacheKey = sha256(["curate", c.provider, mood, slot, type, shortlist.join(","), [...liked].sort().join(",")].join("|"));
  const done = async (curated: Curated) =>
    json({
      ai_status: "used",
      tier: c.tier,
      provider: c.provider,
      curated,
      remaining: c.tier === "free" ? await remaining(c.ip) : null,
    });

  try {
    const hit = await cacheGet<Curated>(cacheKey);
    if (hit) return done(hit);
  } catch {
    /* a cold cache is only slower */
  }

  if (c.tier === "free") {
    let allowed: boolean;
    try {
      allowed = (await take(`free:${today()}`, c.ip, freePerIp(), freeGlobal())).allowed;
    } catch {
      // Fail closed: without a working meter the shared key isn't protected.
      return json({ ai_status: "error", tier: "free" });
    }
    if (!allowed) return json({ ai_status: "limited", tier: "free", remaining: 0 });
  }

  const rows = shortlist.map((id) => TITLES[id]);
  const gen = await generate(c.provider, c.key, {
    system: CURATOR_SYSTEM,
    user: curatorPrompt(liked, mood, slot, type, rows),
    temperature: 0.4,
    maxTokens: 200,
    timeoutMs: CURATE_TIMEOUT_MS,
  });
  const curated = gen.outcome === "ok" ? parseCurator(gen.text, rows.length) : null;
  if (!curated) {
    return json({
      ai_status: gen.outcome === "ok" ? "error" : statusFor(gen.outcome),
      tier: c.tier,
      remaining: c.tier === "free" ? await remaining(c.ip) : null,
    });
  }
  try {
    await cachePut(cacheKey, curated);
  } catch {
    /* uncached is fine */
  }
  return done(curated);
}

/** Genres to lean into before ranking. Your own key only: on the free tier
 *  each pick spends one call, on the curation. */
export async function expand(req: Request): Promise<Response> {
  const body = await readBody(req);
  if (!body) return bad("Expected a JSON body.");
  const favourites = stringList(body.favourite_ids ?? [], 100);
  const mood = body.mood;
  if (!favourites) return bad("favourite_ids must be a list of up to 100 ids.");
  if (typeof mood !== "string" || !MOODS.has(mood)) return bad("Unknown mood.");
  for (const [k, allowed] of [["time_available", SLOTS], ["media_type", TYPES], ["era", ERAS]] as const) {
    if (body[k] !== undefined && (typeof body[k] !== "string" || !allowed.has(body[k] as string))) return bad(`Unknown ${k}.`);
  }

  const c = caller(req);
  if (c === "bad-provider") return bad("Choose gemini or deepseek.");
  if (c === "no-free-tier" || c.tier === "free") return json({ ai_status: "off", genres: {} });
  const limited = await byoBurst(c);
  if (limited) return limited;

  const liked = likedTitles(favourites);
  const cacheKey = sha256(["expand", c.provider, mood, body.time_available, body.media_type, body.era, [...liked].sort().join(",")].join("|"));
  try {
    const hit = await cacheGet<Record<string, number>>(cacheKey);
    if (hit) return json({ ai_status: "used", genres: hit });
  } catch {
    /* ignore */
  }
  const gen = await generate(c.provider, c.key, {
    system: EXPAND_SYSTEM,
    user: expandPrompt(liked, mood),
    temperature: 0.3,
    maxTokens: 60,
    timeoutMs: EXPAND_TIMEOUT_MS,
  });
  if (gen.outcome !== "ok") return json({ ai_status: statusFor(gen.outcome), genres: {} });
  const genres = parseExpansion(gen.text);
  try {
    await cachePut(cacheKey, genres);
  } catch {
    /* ignore */
  }
  return json({ ai_status: "used", genres });
}

/** Check a visitor's own key with one tiny generation. */
export async function validate(req: Request): Promise<Response> {
  const c = caller(req);
  if (c === "bad-provider" || c === "no-free-tier" || c.tier === "free") {
    return json({ ok: false, error: "Choose Gemini or DeepSeek and paste a key." });
  }
  const limited = await byoBurst(c);
  if (limited) return json({ ok: false, error: "Too many tries. Wait a minute and try again." });
  const gen = await generate(c.provider, c.key, {
    system: "Reply with exactly: ok",
    user: "ping",
    temperature: 0,
    maxTokens: 5,
    timeoutMs: 8000,
  });
  if (gen.outcome === "ok") {
    return json({ ok: true, provider: c.provider, model: c.provider === "gemini" ? geminiModel() : deepseekModel(), error: null });
  }
  const error =
    gen.outcome === "timeout" ? "The provider took too long. Try again."
      : gen.outcome === "limited" ? "That key is rate-limited right now. Try again shortly."
      : "That key was rejected by the provider.";
  return json({ ok: false, provider: c.provider, error });
}

/** How many free AI picks this visitor has left today. Spends nothing. */
export async function quota(req: Request): Promise<Response> {
  if (!freeTierConfigured()) return json({ free_tier: false, limit: 0, remaining: 0 });
  const left = await remaining(ipHash(clientIp(req)));
  return json({ free_tier: true, limit: freePerIp(), remaining: left ?? freePerIp() });
}

/** Liveness for the uptime check. Calls no model. */
export async function health(): Promise<Response> {
  return json({ ok: true, free_tier: freeTierConfigured(), store: storeConfigured(), model: geminiModel() });
}
