// @vitest-environment node
/**
 * The AI functions, with the model mocked at fetch and Supabase unset (so the
 * in-memory quota and cache are used).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TITLES } from "./titles.gen";
import { parseCurator } from "./prompts";

const IDS = Object.keys(TITLES);
const SHORTLIST = IDS.slice(0, 8);

let geminiReply: () => Response;
let calls: { url: string; body: unknown; headers: Headers }[];

function req(path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const curateBody = (over: Record<string, unknown> = {}) => ({
  favourite_ids: IDS.slice(10, 13),
  mood: "thrilled",
  time_available: "long",
  media_type: "surprise",
  shortlist_ids: SHORTLIST,
  ...over,
});

const ok = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

async function load() {
  vi.resetModules();
  return import("./ai");
}

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "server-key");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("AI_FREE_DAILY_PER_IP", "3");
  calls = [];
  geminiReply = () => ok('{"pick": 2, "alt": [1, 3], "why": "Tense and smart.", "alt_why": ["Close second.", "Lighter."]}');
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: new Headers(init.headers) });
    return geminiReply();
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("curate", () => {
  it("uses the free tier without a key and resolves titles server-side", async () => {
    const { curate } = await load();
    const res = await (await curate(req("/api/ai/curate", curateBody()))).json();
    expect(res).toMatchObject({ ai_status: "used", tier: "free", provider: "gemini", remaining: 2 });
    expect(res.curated).toEqual({
      primary_index: 1,
      alternate_indices: [0, 2],
      why: "Tense and smart.",
      why_by_index: { 1: "Tense and smart.", 0: "Close second.", 2: "Lighter." },
    });
    const sent = JSON.stringify(calls[0].body);
    expect(sent).toContain(TITLES[SHORTLIST[0]][0].slice(0, 10));
    expect(calls[0].headers.get("x-goog-api-key")).toBe("server-key");
    expect(calls[0].url).not.toContain("server-key");
  });

  it("serves a repeat from cache without spending quota", async () => {
    const { curate } = await load();
    await curate(req("/api/ai/curate", curateBody()));
    const again = await (await curate(req("/api/ai/curate", curateBody()))).json();
    expect(again.ai_status).toBe("used");
    expect(again.remaining).toBe(2);
    expect(calls).toHaveLength(1);
  });

  it("stops at the daily free limit", async () => {
    const { curate } = await load();
    const statuses = [];
    for (const mood of ["thrilled", "anxious", "tired_low", "want_to_laugh"]) {
      statuses.push((await (await curate(req("/api/ai/curate", curateBody({ mood })))).json()).ai_status);
    }
    expect(statuses).toEqual(["used", "used", "used", "limited"]);
  });

  it("passes a visitor's own key through, unmetered", async () => {
    const { curate } = await load();
    const res = await (await curate(req("/api/ai/curate", curateBody(), { "x-llm-provider": "gemini", "x-llm-key": "theirs" }))).json();
    expect(res).toMatchObject({ ai_status: "used", tier: "byo", remaining: null });
    expect(calls[0].headers.get("x-goog-api-key")).toBe("theirs");
  });

  it("reports a provider timeout honestly", async () => {
    geminiReply = () => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    };
    const { curate } = await load();
    expect((await (await curate(req("/api/ai/curate", curateBody()))).json()).ai_status).toBe("timeout");
  });

  it("says off when there's no free tier and no key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const { curate } = await load();
    expect((await (await curate(req("/api/ai/curate", curateBody()))).json()).ai_status).toBe("off");
    expect(calls).toHaveLength(0);
  });

  it.each([
    [{ shortlist_ids: ["not-a-title"] }],
    [{ shortlist_ids: [] }],
    [{ shortlist_ids: IDS.slice(0, 9) }],
    [{ mood: "furious" }],
    [{ time_available: "forever" }],
  ])("rejects a malformed request %#", async (over) => {
    const { curate } = await load();
    expect((await curate(req("/api/ai/curate", curateBody(over)))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("expand + validate + quota", () => {
  it("expands genres for an own key, skips on the free tier", async () => {
    geminiReply = () => ok('{"genres": ["Thriller", "made-up", "crime"]}');
    const { expand } = await load();
    const body = { favourite_ids: IDS.slice(0, 3), mood: "thrilled" };
    expect((await (await expand(req("/api/ai/expand", body))).json()).ai_status).toBe("off");
    const own = await (await expand(req("/api/ai/expand", body, { "x-llm-provider": "gemini", "x-llm-key": "k" }))).json();
    expect(own.genres).toEqual({ thriller: 1, crime: 1 });
  });

  it("validates a key and explains a rejection", async () => {
    const { validate } = await load();
    geminiReply = () => ok("ok");
    expect((await (await validate(req("/api/ai/validate", {}, { "x-llm-provider": "gemini", "x-llm-key": "k" }))).json()).ok).toBe(true);
    geminiReply = () => new Response("{}", { status: 400 });
    const bad = await (await validate(req("/api/ai/validate", {}, { "x-llm-provider": "gemini", "x-llm-key": "k" }))).json();
    expect(bad).toMatchObject({ ok: false, error: "That key was rejected by the provider." });
  });

  it("reports the remaining free quota without spending it", async () => {
    const { quota } = await load();
    expect(await (await quota(req("/api/ai/quota"))).json()).toEqual({ free_tier: true, limit: 3, remaining: 3 });
  });
});

describe("parseCurator", () => {
  it("rejects out-of-range picks and de-duplicates alternates", () => {
    expect(parseCurator('{"pick": 9}', 8)).toBeNull();
    expect(parseCurator("no json here", 8)).toBeNull();
    expect(parseCurator('```json\n{"pick": 1, "alt": [1, 2, 2, 3, 4], "why": "\\"Quoted\\""}\n```', 8)).toMatchObject({
      primary_index: 0,
      alternate_indices: [1, 2],
      why: "Quoted",
    });
  });
});
