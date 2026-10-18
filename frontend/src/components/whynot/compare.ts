import type { ScoreBreakdown, ScoredMediaItem } from "../../types/recommendation";

export type Signal = keyof ScoreBreakdown;

export const SIGNALS: { key: Signal; label: string; short: string }[] = [
  { key: "relevance", label: "Matches your taste", short: "taste match" },
  { key: "mood", label: "Fits the mood", short: "mood fit" },
  { key: "runtime", label: "Fits your time", short: "fit for your time" },
  { key: "quality", label: "How well it's rated", short: "rating" },
  { key: "recency", label: "Fits your era", short: "era fit" },
];

/** How far apart two scores must be before the difference is worth a word. */
const NOTABLE = 0.05;

export interface Comparison {
  /** The pick's score minus the other title's, per signal. */
  gaps: Record<Signal, number>;
  /** Signals where the other title falls short, biggest gap first. */
  behind: Signal[];
  /** Signals where the other title does better. */
  ahead: Signal[];
  sentence: string;
}

const join = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function compare(pick: ScoredMediaItem, other: ScoredMediaItem, otherTitle: string, pickedByAi = false): Comparison {
  const gaps = Object.fromEntries(
    SIGNALS.map(({ key }) => [key, pick.score_breakdown[key] - other.score_breakdown[key]]),
  ) as Record<Signal, number>;
  const ordered = SIGNALS.map((s) => s.key).sort((a, b) => Math.abs(gaps[b]) - Math.abs(gaps[a]));
  const behind = ordered.filter((k) => gaps[k] >= NOTABLE);
  const ahead = ordered.filter((k) => gaps[k] <= -NOTABLE);
  const short = (k: Signal) => SIGNALS.find((s) => s.key === k)!.short;

  let sentence: string;
  if (other.score >= pick.score) {
    sentence = pickedByAi
      ? `By the engine's scores ${otherTitle} is level with or ahead of your pick; the AI chose yours from the shortlist on its reading of your taste.`
      : `${otherTitle} scores level with your pick right now, so either is a good call.`;
  } else if (!behind.length) {
    sentence = `${otherTitle} is close. It trails by a little on everything rather than by a lot on one thing.`;
  } else {
    sentence = `${otherTitle} loses mostly on ${join(behind.slice(0, 2).map(short))}`;
    sentence += ahead.length ? `, though it beats your pick on ${join(ahead.slice(0, 2).map(short))}.` : ".";
  }
  return { gaps, behind, ahead, sentence };
}
