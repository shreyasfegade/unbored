/**
 * Taste dimensions and the taste-profile summary, computed from favourites.
 * Ports of backend/app/engine/taste_signals.py and routers/taste.py.
 */
import { pyRound } from "./pyround";
import type { TasteProfile } from "../api/taste";
import type { MediaItem } from "../types/media";

const INTENSE = new Set(["drama", "war", "history"]);
const DARK = new Set(["thriller", "horror", "crime", "mystery"]);

export function tasteDims(items: MediaItem[]): Record<string, number> {
  if (!items.length) {
    return { darkness_preference: 0.5, humor_affinity: 0.5, emotional_intensity: 0.5 };
  }
  const total = items.length;
  const all = items.flatMap((i) => i.genres.map((g) => g.toLowerCase().trim()));
  const maxPerPick = Math.max(...items.map((i) => i.genres.length)) || 1;
  const denom = total * maxPerPick;
  const intense = all.filter((g) => INTENSE.has(g)).length;
  const dark = all.filter((g) => DARK.has(g)).length;
  const comedy = all.filter((g) => g === "comedy").length;
  return {
    darkness_preference: pyRound(Math.min(dark / denom, 1), 3),
    humor_affinity: pyRound(Math.min(comedy / total, 1), 3),
    emotional_intensity: pyRound(Math.min(intense / denom, 1), 3),
  };
}

/** Python's Counter.most_common: count descending, first-seen order on ties. */
function mostCommon(values: string[], n?: number): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const entries = Array.from(counts.entries());
  entries.sort((a, b) => b[1] - a[1]);
  return n === undefined ? entries : entries.slice(0, n);
}

const topNames = (values: (string | null | undefined)[], n: number) =>
  mostCommon(values.filter((v): v is string => !!v), n).map(([name]) => name);

export function summariseTaste(items: MediaItem[], requested: number): TasteProfile {
  const empty: TasteProfile = {
    resolved: 0, requested, genres: [], decades: [], media_types: {}, mean_runtime: null,
    mean_rating: null, tone: {}, top_directors: [], top_studios: [], top_cast: [],
  };
  if (!items.length) return empty;

  const genreValues = items.flatMap((m) => m.genres.filter(Boolean).map((g) => g.toLowerCase().trim()));
  const genreCounts = mostCommon(genreValues);
  const totalGenre = genreValues.length || 1;
  const genres = genreCounts.slice(0, 8).map(([name, count]) => ({
    name, count, share: pyRound(count / totalGenre, 3),
  }));

  const decadeCounts = new Map<number, number>();
  for (const m of items) {
    const year = m.release_year || m.year;
    if (year) {
      const d = Math.floor(year / 10) * 10;
      decadeCounts.set(d, (decadeCounts.get(d) ?? 0) + 1);
    }
  }
  const decades = Array.from(decadeCounts.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([d, count]) => ({ decade: `${d}s`, count }));

  const mediaTypes: Record<string, number> = {};
  for (const m of items) mediaTypes[m.media_type] = (mediaTypes[m.media_type] ?? 0) + 1;

  const runtimes = items.map((m) => m.runtime_minutes).filter((r): r is number => !!r);
  const ratings = items.map((m) => m.vote_average).filter((r) => !!r);

  return {
    resolved: items.length,
    requested,
    genres,
    decades,
    media_types: mediaTypes,
    mean_runtime: runtimes.length ? pyRound(runtimes.reduce((a, b) => a + b, 0) / runtimes.length) : null,
    mean_rating: ratings.length ? pyRound(ratings.reduce((a, b) => a + b, 0) / ratings.length, 1) : null,
    tone: tasteDims(items),
    top_directors: topNames(items.map((m) => m.director), 5),
    top_studios: topNames(items.map((m) => m.studio), 5),
    top_cast: topNames(items.flatMap((m) => m.cast ?? []), 5),
  };
}
