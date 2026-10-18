/**
 * Mood targets in tone space. A port of the request-dependent half of
 * backend/app/engine/tone.py; each title's own tone vector is precomputed into
 * the pack, so only the personalised target and the distance live here.
 */
import type { Card } from "./types";

const N_AXES = 5;
const MAX_DIST = Math.sqrt(N_AXES);
const AXIS_ENERGY = 0;
const AXIS_DARKNESS = 1;
const AXIS_INTENSITY = 3;
const AXIS_HUMOR = 4;

const clamp = (x: number) => Math.max(0, Math.min(1, x));

export type TasteDims = Record<string, number>;

export function moodTarget(
  targets: Record<string, number[]>,
  mood: string | null | undefined,
  taste?: TasteDims | null,
  timeOfDay?: string | null,
): number[] | null {
  if (!mood) return null;
  const base = targets[mood];
  if (!base) return null;
  const target = [...base];

  if (taste) {
    const nudge = (axis: number, key: string) => {
      const pref = taste[key];
      if (pref !== undefined && pref !== null) target[axis] = clamp(0.75 * target[axis] + 0.25 * pref);
    };
    nudge(AXIS_DARKNESS, "darkness_preference");
    nudge(AXIS_HUMOR, "humor_affinity");
    nudge(AXIS_INTENSITY, "emotional_intensity");
  }

  if (timeOfDay === "late_night") target[AXIS_ENERGY] = clamp(target[AXIS_ENERGY] - 0.12);

  return target.map(clamp);
}

export function moodFitToTarget(card: Card, target: number[] | null): number {
  if (target === null) return 0.5;
  let sq = 0;
  for (let i = 0; i < N_AXES; i++) sq += (card.tone[i] - target[i]) ** 2;
  return clamp(1 - Math.sqrt(sq) / MAX_DIST);
}
