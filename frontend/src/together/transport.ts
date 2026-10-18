/**
 * Where rooms live. Supabase in production: codes come from two database
 * functions (migration *_rooms.sql) and the live room is a Realtime channel.
 * Both sit behind small interfaces so tests can run several members against an
 * in-memory bus.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { Presence, RoomMsg } from "./protocol";

export type LinkStatus = "connecting" | "live" | "reconnecting" | "closed";

export interface RoomHandlers {
  onPresence: (members: Presence[]) => void;
  onMessage: (msg: RoomMsg) => void;
  onStatus: (status: LinkStatus) => void;
}

export interface RoomLink {
  track: (me: Presence) => Promise<void>;
  send: (msg: RoomMsg) => Promise<void>;
  close: () => Promise<void>;
}

export interface RoomBackend {
  open: () => Promise<{ code: string; expires_at: string }>;
  /** When the room expires, or null if no such live room. */
  lookup: (code: string) => Promise<string | null>;
  connect: (code: string, handlers: RoomHandlers) => RoomLink;
}

export class RoomUnavailable extends Error {}

export function supabaseBackend(): RoomBackend | null {
  const sb = supabase;
  if (!sb) return null;
  return {
    async open() {
      const { data, error } = await sb.rpc("room_open");
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row?.code) throw new RoomUnavailable(error?.message ?? "Couldn't open a room.");
      return { code: row.code as string, expires_at: row.expires_at as string };
    },
    async lookup(code) {
      const { data, error } = await sb.rpc("room_lookup", { p_code: code });
      if (error) throw new RoomUnavailable(error.message);
      return (data as string | null) ?? null;
    },
    connect(code, handlers) {
      const channel: RealtimeChannel = sb.channel(`room:${code}`, {
        config: { broadcast: { self: false, ack: false }, presence: { key: "" } },
      });
      let me: Presence | null = null;
      const emitPresence = () => {
        const state = channel.presenceState<Presence>();
        handlers.onPresence(Object.values(state).flat().map((p) => ({
          member_id: p.member_id, name: p.name, favourite_ids: p.favourite_ids, joined_at: p.joined_at,
        })));
      };
      channel
        .on("presence", { event: "sync" }, emitPresence)
        .on("broadcast", { event: "room" }, ({ payload }) => handlers.onMessage(payload as RoomMsg));
      handlers.onStatus("connecting");
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          handlers.onStatus("live");
          if (me) void channel.track(me); // re-announce after a reconnect
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          handlers.onStatus("reconnecting");
        } else if (status === "CLOSED") {
          handlers.onStatus("closed");
        }
      });
      return {
        async track(p) {
          me = p;
          await channel.track(p);
        },
        async send(msg) {
          await channel.send({ type: "broadcast", event: "room", payload: msg });
        },
        async close() {
          await channel.untrack().catch(() => {});
          await sb.removeChannel(channel);
        },
      };
    },
  };
}

/** An in-memory room service for tests: every link on a code shares a bus. */
export function memoryBackend(): RoomBackend & { expire: (code: string) => void } {
  const rooms = new Map<string, { expires_at: string; links: Set<{ h: RoomHandlers; me: Presence | null }> }>();
  const broadcastPresence = (code: string) => {
    const room = rooms.get(code);
    if (!room) return;
    const list = Array.from(room.links).map((l) => l.me).filter((p): p is Presence => !!p);
    for (const l of room.links) l.h.onPresence(list);
  };
  let n = 0;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return {
    async open() {
      const code = Array.from({ length: 4 }, (_, i) => alphabet[(n * 7 + i * 13 + 3) % alphabet.length]).join("");
      n++;
      const expires_at = new Date(Date.now() + 12 * 3600_000).toISOString();
      rooms.set(code, { expires_at, links: new Set() });
      return { code, expires_at };
    },
    async lookup(code) {
      return rooms.get(code)?.expires_at ?? null;
    },
    connect(code, h) {
      const room = rooms.get(code);
      if (!room) throw new RoomUnavailable("no such room");
      const link = { h, me: null as Presence | null };
      room.links.add(link);
      queueMicrotask(() => h.onStatus("live"));
      return {
        async track(p) {
          link.me = p;
          broadcastPresence(code);
        },
        async send(msg) {
          for (const l of room.links) if (l !== link) l.h.onMessage(structuredClone(msg));
        },
        async close() {
          room.links.delete(link);
          broadcastPresence(code);
        },
      };
    },
    expire(code) {
      rooms.delete(code);
    },
  };
}
