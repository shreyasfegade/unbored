/**
 * The templated "why this, for you" line for engine-only picks. A port of
 * backend/app/services/rationale.py: honest about the signals the engine used,
 * never pretending to be the AI.
 */
import type { Scored } from "./engine";

const MOOD_TAIL: Record<string, string> = {
  happy_energetic: "and it matches the upbeat mood you're in",
  tired_low: "and it's an easy one to sink into right now",
  anxious: "and it's gentle enough for where your head's at",
  want_to_cry: "and it carries the emotional weight you're after",
  mindblown_curious: "and it'll give you plenty to chew on",
  want_to_laugh: "and it brings the laughs you came for",
  thrilled: "and it delivers the charge you're chasing",
};

export function engineRationale(primary: Scored, mood: string | null, likedGenres: Set<string>): string {
  const media = primary.media;
  const genre = (media.genres[0] ?? media.media_type).toLowerCase();
  const liked = new Set(Array.from(likedGenres, (g) => g.toLowerCase()));
  const shares = media.genres.some((g) => liked.has(g.toLowerCase()));
  const rel = primary.score_breakdown.relevance;

  let head: string;
  if (shares && rel >= 0.25) head = `Right in your wheelhouse — it shares the ${genre} streak in what you love`;
  else if (rel >= 0.25) head = `A close match to your taste, with a strong ${genre} core`;
  else head = `A well-reviewed ${genre} pick to broaden the night`;

  const tail = MOOD_TAIL[mood ?? ""] ?? "and it fits the time you have";
  return `${head}, ${tail}.`;
}
