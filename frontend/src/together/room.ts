/**
 * One member's view of a room. Keeps the members, the latest pick and any veto
 * round in sync over a RoomLink, and runs the group's pick on this device with
 * the same engine solo picks use, then shares the result.
 */
import { engine } from "../engine/client";
import type { PipelineResult } from "../engine/pipeline";
import type { MoodType, TimeSlot } from "../types/mood";
import type { RecommendationRequest } from "../types/recommendation";
import {
  MAX_FAVOURITES, VETO_CANDIDATES, combinedFavourites, orderMembers, recordVote, vetoState,
  type PickMsg, type Presence, type RoomMsg, type VetoSession, type VetoState,
} from "./protocol";
import type { LinkStatus, RoomBackend, RoomLink } from "./transport";

export interface RoomSnapshot {
  code: string;
  status: LinkStatus;
  members: Presence[];
  pick: PickMsg | null;
  veto: (VetoState & { session: VetoSession }) | null;
}

export type Recommend = (req: RecommendationRequest) => Promise<PipelineResult>;

const groupRequest = (favourites: string[], mood: MoodType, slot: TimeSlot): RecommendationRequest => ({
  // Matches the old server's room pick: an evening, any type, any era.
  favourite_ids: favourites,
  mood,
  time_available: slot,
  time_of_day: "evening",
  media_type: "surprise",
  era: "any",
  excluded_ids: [],
});

export class RoomClient {
  private link: RoomLink | null = null;
  private snap: RoomSnapshot;
  private session: VetoSession | null = null;
  private readonly me: Presence;

  constructor(
    private readonly backend: RoomBackend,
    code: string,
    me: Omit<Presence, "favourite_ids"> & { favourite_ids: string[] },
    private readonly listener: (s: RoomSnapshot) => void,
    private readonly recommend: Recommend = (req) => engine.recommend(req),
  ) {
    this.me = { ...me, favourite_ids: me.favourite_ids.slice(-MAX_FAVOURITES) };
    this.snap = { code, status: "connecting", members: [], pick: null, veto: null };
  }

  get snapshot(): RoomSnapshot {
    return this.snap;
  }

  private emit(patch: Partial<RoomSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    if (this.session) {
      const present = this.snap.members.map((m) => m.member_id);
      this.snap = { ...this.snap, veto: { ...vetoState(this.session, present), session: this.session } };
    }
    this.listener(this.snap);
  }

  async start(): Promise<void> {
    this.link = this.backend.connect(this.snap.code, {
      onStatus: (status) => this.emit({ status }),
      onPresence: (list) => {
        const before = new Set(this.snap.members.map((m) => m.member_id));
        const members = orderMembers(list);
        this.emit({ members });
        // Someone new: the longest-standing member re-sends what's on screen.
        const fresh = members.some((m) => !before.has(m.member_id) && m.member_id !== this.me.member_id);
        if (fresh && before.size && members[0]?.member_id === this.me.member_id) void this.resend();
      },
      onMessage: (msg) => this.receive(msg),
    });
    await this.link.track(this.me);
    await this.link.send({ type: "hello", member_id: this.me.member_id });
  }

  async stop(): Promise<void> {
    await this.link?.close();
    this.link = null;
  }

  private async resend() {
    if (!this.link) return;
    if (this.snap.pick) await this.link.send(this.snap.pick);
    if (this.session) {
      await this.link.send(this.session.start);
      for (const [round, votes] of this.session.votes) {
        for (const [member_id, vetoed] of votes) {
          await this.link.send({ type: "veto", veto_id: this.session.start.veto_id, round, member_id, vetoed });
        }
      }
    }
  }

  private receive(msg: RoomMsg) {
    switch (msg.type) {
      case "hello":
        if (this.snap.members[0]?.member_id === this.me.member_id) void this.resend();
        return;
      case "pick":
        if (!this.snap.pick || msg.at > this.snap.pick.at) this.emit({ pick: msg });
        return;
      case "veto_start":
        if (!this.session || msg.at > this.session.start.at) {
          this.session = { start: msg, votes: new Map() };
          this.emit({});
        }
        return;
      case "veto":
        if (this.session) {
          recordVote(this.session, msg);
          this.emit({});
        }
        return;
    }
  }

  private favourites(): string[] {
    const members = this.snap.members.some((m) => m.member_id === this.me.member_id)
      ? this.snap.members
      : [...this.snap.members, this.me];
    return combinedFavourites(members);
  }

  /** The group's pick, worked out here and shared with the room. */
  async pick(mood: MoodType, slot: TimeSlot): Promise<PickMsg> {
    const { response } = await this.recommend(groupRequest(this.favourites(), mood, slot));
    const msg: PickMsg = {
      type: "pick",
      primary_id: response.primary.media.id,
      alternate_ids: response.alternates.map((a) => a.media.id),
      rationale: response.rationale,
      mood,
      slot,
      by: this.me.name,
      at: Date.now(),
    };
    this.session = null;
    this.emit({ pick: msg, veto: null });
    await this.link?.send(msg);
    return msg;
  }

  /** Deal the engine's top titles for a veto round. */
  async startVeto(mood: MoodType, slot: TimeSlot): Promise<void> {
    const result = await this.recommend(groupRequest(this.favourites(), mood, slot));
    const ids: string[] = [];
    for (const s of [result.response.primary, ...result.response.alternates, ...result.ranked]) {
      if (!ids.includes(s.media.id)) ids.push(s.media.id);
      if (ids.length >= VETO_CANDIDATES) break;
    }
    const start = {
      type: "veto_start" as const,
      veto_id: `${this.me.member_id}-${Date.now().toString(36)}`,
      candidates: ids,
      mood,
      slot,
      by: this.me.name,
      at: Date.now(),
    };
    this.session = { start, votes: new Map() };
    this.emit({ pick: null });
    await this.link?.send(start);
  }

  /** Veto one title in the current round, or null to keep them all. */
  async vote(vetoed: string | null): Promise<void> {
    const veto = this.snap.veto;
    if (!this.session || !veto || veto.winner) return;
    const msg = { type: "veto" as const, veto_id: this.session.start.veto_id, round: veto.round, member_id: this.me.member_id, vetoed };
    recordVote(this.session, msg);
    this.emit({});
    await this.link?.send(msg);
  }

  endVeto(): void {
    this.session = null;
    this.emit({ veto: null });
  }
}
