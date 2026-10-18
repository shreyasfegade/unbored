/** The pick flow end to end in the browser: engine, then optional AI. */
import { beforeEach, describe, expect, it } from "vitest";
import { servePack } from "../test/servePack";
import { setCatalogForTests } from "../engine/pack";
import { setReadyForTests } from "../engine/host";
import { useAiTierStore } from "../stores/aiTierStore";
import { useLlmStore } from "../stores/llmStore";
import { getRecommendation } from "./recommend";
import type { RecommendationRequest } from "../types/recommendation";

const REQ: RecommendationRequest = {
  favourite_ids: ["tmdb_27205", "tmdb_157336"],
  mood: "thrilled",
  time_available: "long",
  time_of_day: "evening",
  media_type: "surprise",
  era: "any",
  excluded_ids: [],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let curateBodies: Record<string, unknown>[] = [];

/** Serve the pack plus fake AI functions, recording what curate was sent. */
function capture(curate: () => Response, freeTier = true) {
  curateBodies = [];
  const fake = servePack({
    "/api/ai/quota": () => json({ free_tier: freeTier, limit: 20, remaining: 5 }),
    "/api/ai/curate": curate,
  });
  const inner = fake.getMockImplementation()!;
  fake.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/api/ai/curate") && init?.body) curateBodies.push(JSON.parse(String(init.body)));
    return inner(input, init);
  });
}

beforeEach(() => {
  setCatalogForTests(null);
  setReadyForTests(null);
  useAiTierStore.setState({ freeTier: null, remaining: null, limit: null });
  useLlmStore.getState().clear();
});

describe("getRecommendation", () => {
  it("is engine-only, with no network, when there's no AI", async () => {
    capture(() => json({}), false);
    const { data } = await getRecommendation(REQ);
    expect(data.picked_by).toBe("engine");
    expect(data.ai_status).toBe("off");
    expect(curateBodies).toHaveLength(0);
  });

  it("lets the free-tier AI choose from the engine's shortlist", async () => {
    capture(() =>
      json({
        ai_status: "used",
        tier: "free",
        provider: "gemini",
        remaining: 4,
        curated: { primary_index: 2, alternate_indices: [0], why: "Big, tense, brainy.", why_by_index: { 2: "Big, tense, brainy.", 0: "Also great." } },
      }),
    );
    const { data } = await getRecommendation(REQ);
    const sent = curateBodies[0];
    expect((sent.shortlist_ids as string[]).length).toBe(8);
    expect(data.picked_by).toBe("ai");
    expect(data.ai_tier).toBe("free");
    expect(data.primary.media.id).toBe((sent.shortlist_ids as string[])[2]);
    expect(data.primary.rationale).toBe("Big, tense, brainy.");
    expect(data.alternates[0].media.id).toBe((sent.shortlist_ids as string[])[0]);
    expect(data.alternates[0].rationale).toBe("Also great.");
    expect(data.alternates).toHaveLength(2);
    expect(useAiTierStore.getState().remaining).toBe(4);
  });

  it("keeps the engine pick when the free tier is used up", async () => {
    capture(() => json({ ai_status: "limited", tier: "free", remaining: 0 }));
    const { data } = await getRecommendation(REQ);
    expect(data.picked_by).toBe("engine");
    expect(data.ai_status).toBe("limited");
    expect(data.rationale).toMatch(/./);
  });

  it("keeps the engine pick when the AI function is down", async () => {
    capture(() => json({ detail: "boom" }, 500));
    const { data } = await getRecommendation(REQ);
    expect(data.picked_by).toBe("engine");
    expect(data.ai_status).toBe("error");
  });
});
