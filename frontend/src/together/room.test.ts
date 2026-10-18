/** Watch Together with several members on an in-memory Realtime stand-in. */
import { describe, expect, it } from "vitest";
import { RoomClient, type Recommend, type RoomSnapshot } from "./room";
import { combinedFavourites, vetoState, type VetoSession } from "./protocol";
import { memoryBackend } from "./transport";
import type { PipelineResult } from "../engine/pipeline";

const scored = (id: string) => ({ media: { id } as never, score: 0.5, score_breakdown: { relevance: 0, mood: 0, runtime: 0, quality: 0, recency: 0 } });

/** A stand-in engine: the pick is a function of the pooled favourites. */
const fakeRecommend: Recommend = async (req) => {
  const n = req.favourite_ids.length;
  const ids = ["t_a", "t_b", "t_c", "t_d", "t_e", "t_f"].map((x) => `${x}${n}`);
  return {
    response: { primary: scored(ids[0]), alternates: [scored(ids[1]), scored(ids[2])], rationale: `for ${n}`, picked_by: "engine" },
    shortlist: ids.map(scored),
    ranked: ids.map(scored),
  } as unknown as PipelineResult;
};

const flush = () => new Promise((r) => setTimeout(r, 0));

async function member(backend: ReturnType<typeof memoryBackend>, code: string, id: string, favs: string[], joined: number) {
  const seen: RoomSnapshot[] = [];
  const client = new RoomClient(backend, code, { member_id: id, name: id, favourite_ids: favs, joined_at: joined }, (s) => seen.push(s), fakeRecommend);
  await client.start();
  await flush();
  return { client, last: () => client.snapshot };
}

describe("a room", () => {
  it("shares members, pools taste and spreads the pick", async () => {
    const backend = memoryBackend();
    const { code } = await backend.open();
    const ana = await member(backend, code, "ana", ["x1", "x2"], 1);
    const ben = await member(backend, code, "ben", ["x2", "x3", "x4"], 2);

    expect(ana.last().members.map((m) => m.member_id)).toEqual(["ana", "ben"]);
    expect(ben.last().status).toBe("live");

    await ben.client.pick("thrilled", "long");
    await flush();
    // Four distinct favourites pooled: x1..x4.
    expect(ana.last().pick?.primary_id).toBe("t_a4");
    expect(ana.last().pick?.by).toBe("ben");
  });

  it("catches a late joiner up on the current pick", async () => {
    const backend = memoryBackend();
    const { code } = await backend.open();
    const ana = await member(backend, code, "ana", ["x1"], 1);
    await ana.client.pick("anxious", "short");
    const cal = await member(backend, code, "cal", [], 3);
    await flush();
    expect(cal.last().pick?.primary_id).toBe(ana.last().pick?.primary_id);
  });

  it("survives a member reloading: they rejoin under the same id", async () => {
    const backend = memoryBackend();
    const { code } = await backend.open();
    const ana = await member(backend, code, "ana", ["x1"], 1);
    const ben = await member(backend, code, "ben", ["x2"], 2);
    await ana.client.pick("thrilled", "medium");
    await ben.client.stop();
    await flush();
    expect(ana.last().members.map((m) => m.member_id)).toEqual(["ana"]);
    const benAgain = await member(backend, code, "ben", ["x2"], 2);
    await flush();
    expect(ana.last().members.map((m) => m.member_id)).toEqual(["ana", "ben"]);
    expect(benAgain.last().pick?.primary_id).toBe(ana.last().pick?.primary_id);
  });

  it("runs veto rounds to a winner everyone sees", async () => {
    const backend = memoryBackend();
    const { code } = await backend.open();
    const ana = await member(backend, code, "ana", ["x1"], 1);
    const ben = await member(backend, code, "ben", ["x2"], 2);
    await ana.client.startVeto("thrilled", "long");
    await flush();
    const cands = ben.last().veto!.candidates;
    expect(cands).toHaveLength(5);

    await ana.client.vote(cands[0]);
    await flush();
    expect(ben.last().veto?.waitingOn).toEqual(["ben"]);
    await ben.client.vote(cands[1]);
    await flush();
    // Round 2 with three survivors.
    expect(ana.last().veto?.round).toBe(2);
    expect(ana.last().veto?.candidates).toEqual(cands.slice(2));

    await ana.client.vote(cands[2]);
    await ben.client.vote(cands[3]);
    await flush();
    expect(ana.last().veto?.winner).toBe(cands[4]);
    expect(ben.last().veto?.winner).toBe(cands[4]);
  });
});

describe("protocol", () => {
  it("pools favourites in join order without repeats", () => {
    expect(
      combinedFavourites([
        { member_id: "b", name: "b", favourite_ids: ["2", "3"], joined_at: 2 },
        { member_id: "a", name: "a", favourite_ids: ["1", "2"], joined_at: 1 },
      ]),
    ).toEqual(["1", "2", "3"]);
  });

  const session = (votes: [number, string, string | null][]): VetoSession => {
    const s: VetoSession = {
      start: { type: "veto_start", veto_id: "v", candidates: ["a", "b", "c", "d", "e"], mood: "thrilled", slot: "long", by: "x", at: 1 },
      votes: new Map(),
    };
    for (const [round, m, id] of votes) {
      if (!s.votes.has(round)) s.votes.set(round, new Map());
      s.votes.get(round)!.set(m, id);
    }
    return s;
  };

  it("lets the top title win when nobody vetoes", () => {
    expect(vetoState(session([[1, "p", null], [1, "q", null]]), ["p", "q"]).winner).toBe("a");
  });

  it("ignores votes from people who left, and doesn't wait for them", () => {
    const st = vetoState(session([[1, "p", "a"], [1, "gone", "b"]]), ["p", "q"]);
    expect(st.waitingOn).toEqual(["q"]);
    expect(st.survivors).toEqual(["b", "c", "d", "e"]);
  });

  it("still picks something if everything is vetoed", () => {
    const s = session([[1, "p", "a"], [1, "q", "b"]]);
    s.start.candidates = ["a", "b"];
    expect(vetoState(s, ["p", "q"]).winner).toBe("a");
  });

  it("stops after the last round with the best-ranked survivor", () => {
    const st = vetoState(
      session([[1, "p", "a"], [2, "p", "b"], [3, "p", "c"]]),
      ["p"],
    );
    expect(st.round).toBe(3);
    expect(st.winner).toBe("d");
  });
});
