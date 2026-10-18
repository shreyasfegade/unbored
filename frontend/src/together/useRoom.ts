import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MoodType, TimeSlot } from "../types/mood";
import { RoomClient, type RoomSnapshot } from "./room";
import { supabaseBackend, type RoomBackend } from "./transport";

const MEMBER_KEY = "unbored-member-id";
const ROOM_KEY = "unbored-room";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: a reload just means joining again */
  }
}

/** This browser's stable member id, so a reload rejoins as the same person. */
export function memberId(): string {
  let id = read<string>(MEMBER_KEY);
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() ?? `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    write(MEMBER_KEY, id);
  }
  return id;
}

/** The room this browser was last in, so a reload of /together/CODE rejoins it. */
export const lastRoom = () => read<{ code: string; joined_at: number }>(ROOM_KEY);

let backendOverride: RoomBackend | null | undefined;
/** Test seam. */
export function setRoomBackendForTests(b: RoomBackend | null | undefined) {
  backendOverride = b;
}
export const roomBackend = (): RoomBackend | null => (backendOverride !== undefined ? backendOverride : supabaseBackend());

export type RoomPhase = "idle" | "checking" | "expired" | "in-room" | "error";

/** One room session: look the code up, join, stay in sync, leave. */
export function useRoom(name: string, favouriteIds: string[]) {
  const backend = useMemo(() => roomBackend(), []);
  const [phase, setPhase] = useState<RoomPhase>("idle");
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = useRef<RoomClient | null>(null);

  const leave = useCallback(async () => {
    const c = client.current;
    client.current = null;
    write(ROOM_KEY, null);
    setSnap(null);
    setPhase("idle");
    await c?.stop();
  }, []);

  useEffect(() => () => void client.current?.stop(), []);

  const join = useCallback(
    async (code: string) => {
      if (!backend) return;
      setError(null);
      setPhase("checking");
      try {
        const expires = await backend.lookup(code);
        if (!expires) {
          setPhase("expired");
          if (lastRoom()?.code === code) write(ROOM_KEY, null);
          return;
        }
        await client.current?.stop();
        const prior = lastRoom();
        const joined_at = prior?.code === code ? prior.joined_at : Date.now();
        write(ROOM_KEY, { code, joined_at });
        const c = new RoomClient(
          backend,
          code,
          { member_id: memberId(), name: name.trim() || "Guest", favourite_ids: favouriteIds, joined_at },
          setSnap,
        );
        client.current = c;
        setSnap(c.snapshot);
        setPhase("in-room");
        await c.start();
      } catch {
        setPhase("error");
        setError("Couldn't reach the room service. Check your connection and try again.");
      }
    },
    [backend, name, favouriteIds],
  );

  const create = useCallback(async (): Promise<string | null> => {
    if (!backend) return null;
    setError(null);
    setPhase("checking");
    try {
      const { code } = await backend.open();
      await join(code);
      return code;
    } catch {
      setPhase("error");
      setError("Couldn't open a room right now. Try again in a moment.");
      return null;
    }
  }, [backend, join]);

  const pick = useCallback((mood: MoodType, slot: TimeSlot) => client.current?.pick(mood, slot), []);
  const startVeto = useCallback((mood: MoodType, slot: TimeSlot) => client.current?.startVeto(mood, slot), []);
  const vote = useCallback((vetoed: string | null) => client.current?.vote(vetoed), []);
  const endVeto = useCallback(() => client.current?.endVeto(), []);

  return { available: backend !== null, phase, snap, error, setError, join, create, leave, pick, startVeto, vote, endVeto };
}
