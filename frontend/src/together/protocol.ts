/**
 * Watch Together, as messages. A room is a Realtime channel: each member's
 * presence carries their name and favourites, and picks and veto rounds are
 * broadcasts. There's no server-side room state to lose, and everything below
 * is a pure function of what's been seen, so every client derives the same
 * room from the same messages.
 */
import type { MoodType, TimeSlot } from "../types/mood";

export const MAX_FAVOURITES = 100;
export const MAX_MEMBERS = 12;
export const VETO_CANDIDATES = 5;
export const VETO_MAX_ROUNDS = 3;
export const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;

export interface Presence {
  member_id: string;
  name: string;
  favourite_ids: string[];
  joined_at: number;
}

export interface PickMsg {
  type: "pick";
  primary_id: string;
  alternate_ids: string[];
  rationale: string;
  mood: MoodType;
  slot: TimeSlot;
  by: string;
  at: number;
}

export interface VetoStartMsg {
  type: "veto_start";
  veto_id: string;
  /** Engine order, best first: ties and the final winner follow this order. */
  candidates: string[];
  mood: MoodType;
  slot: TimeSlot;
  by: string;
  at: number;
}

export interface VetoMsg {
  type: "veto";
  veto_id: string;
  round: number;
  member_id: string;
  /** The title vetoed, or null to keep them all. */
  vetoed: string | null;
}

/** Sent on joining, so whoever holds the latest state re-sends it. */
export interface HelloMsg {
  type: "hello";
  member_id: string;
}

export type RoomMsg = PickMsg | VetoStartMsg | VetoMsg | HelloMsg;

/** Members in a stable order (join time, then id), identical on every client. */
export function orderMembers(list: Presence[]): Presence[] {
  const byId = new Map<string, Presence>();
  for (const p of list) {
    const prev = byId.get(p.member_id);
    if (!prev || p.joined_at < prev.joined_at) byId.set(p.member_id, p);
  }
  return Array.from(byId.values()).sort((a, b) => a.joined_at - b.joined_at || (a.member_id < b.member_id ? -1 : 1));
}

/** Everyone's favourites, de-duplicated in join order, capped for the engine. */
export function combinedFavourites(members: Presence[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of orderMembers(members)) {
    for (const id of m.favourite_ids) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out.slice(0, MAX_FAVOURITES);
}

export interface VetoSession {
  start: VetoStartMsg;
  /** round -> member -> vetoed title (or null to keep all). */
  votes: Map<number, Map<string, string | null>>;
}

export interface VetoState {
  round: number;
  candidates: string[];
  /** Still standing after this round's vetoes so far, in engine order. */
  survivors: string[];
  /** Present members who haven't voted this round. */
  waitingOn: string[];
  winner: string | null;
}

export function recordVote(session: VetoSession, msg: VetoMsg): void {
  if (msg.veto_id !== session.start.veto_id) return;
  let round = session.votes.get(msg.round);
  if (!round) session.votes.set(msg.round, (round = new Map()));
  if (!round.has(msg.member_id)) round.set(msg.member_id, msg.vetoed);
}

/**
 * Where a veto session stands. Each round, every present member may veto one
 * title or keep them all. Once everyone has voted: a lone survivor wins; if
 * nobody vetoed anything the top title wins; otherwise the survivors go to the
 * next round, and on the last round the best-ranked survivor wins. If every
 * title is vetoed the best-ranked one wins anyway: the room still needs
 * something to watch. Rounds advance locally from the votes, so nobody has to
 * announce them.
 */
export function vetoState(session: VetoSession, presentIds: string[]): VetoState {
  let candidates = session.start.candidates;
  for (let round = 1; ; round++) {
    const votes = session.votes.get(round) ?? new Map<string, string | null>();
    const vetoed = new Set<string>();
    for (const [member, id] of votes) if (id && presentIds.includes(member) && candidates.includes(id)) vetoed.add(id);
    const survivors = candidates.filter((id) => !vetoed.has(id));
    const waitingOn = presentIds.filter((id) => !votes.has(id));
    if (waitingOn.length) return { round, candidates, survivors, waitingOn, winner: null };
    const decided =
      survivors.length === 0 ? candidates[0]
        : survivors.length === 1 || survivors.length === candidates.length || round >= VETO_MAX_ROUNDS ? survivors[0]
        : null;
    if (decided) return { round, candidates, survivors, waitingOn, winner: decided };
    candidates = survivors;
  }
}
