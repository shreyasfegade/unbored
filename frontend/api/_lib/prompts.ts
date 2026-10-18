/**
 * The AI prompts and their parsers. Ports of backend/app/services/curator.py
 * (pick + reasons from the engine's shortlist) and query_expansion.py (genres
 * to lean into before ranking). Token-frugal by design: titles only, one call.
 */
import type { TitleRow } from "./titles.gen";

export const CURATOR_SYSTEM =
  "You are a sharp film, TV and anime taste expert. From a shortlist, you pick the ONE " +
  "best thing for this person to watch right now plus two backups, and explain each in one " +
  "short, specific sentence tied to what they love. Reply with JSON only.";

export const EXPAND_SYSTEM =
  "You are a film/TV/anime taste analyst. Given what someone loves and how they feel right " +
  "now, name the 2-4 genres most worth surfacing for them tonight. Reply with JSON only.";

const CURATOR_MOOD: Record<string, string> = {
  happy_energetic: "happy and energetic",
  tired_low: "tired and low-energy",
  anxious: "anxious and wanting comfort",
  want_to_cry: "wanting something moving",
  mindblown_curious: "curious, wanting to be amazed",
  want_to_laugh: "wanting to laugh",
  thrilled: "wanting a thrill",
};
const EXPAND_MOOD: Record<string, string> = { ...CURATOR_MOOD, anxious: "anxious, wanting comfort" };
const TIME_LABEL: Record<string, string> = {
  short: "about 30 minutes",
  medium: "about an hour",
  long: "a couple of hours",
};
const TYPE_LABEL: Record<string, string> = {
  movie: "a movie",
  tv: "a TV show",
  anime: "anime",
  surprise: "anything",
};

export const KNOWN_GENRES = new Set([
  "action", "adventure", "animation", "comedy", "crime", "documentary", "drama",
  "family", "fantasy", "history", "horror", "music", "mystery", "romance",
  "science fiction", "sci-fi", "thriller", "war", "western", "supernatural",
  "psychological", "slice of life", "sports", "mecha", "isekai",
]);

export function curatorPrompt(
  likedTitles: string[],
  mood: string | null,
  timeAvailable: string,
  mediaType: string | null,
  shortlist: TitleRow[],
): string {
  const loves = likedTitles.length ? likedTitles.slice(0, 8).join(", ") : "a range of acclaimed films and shows";
  const moodTxt = CURATOR_MOOD[mood ?? ""] ?? "open to anything";
  const want = TYPE_LABEL[mediaType ?? ""] ?? "anything";
  const lines = shortlist.map(([title, year, genres, runtime, rating, eps, type], i) => {
    const g = genres.length ? genres.slice(0, 3).join(", ") : type;
    const rt = runtime ? `${runtime}min` : "?";
    const r = rating ? rating.toFixed(1) : "?";
    const e = eps && eps > 1 ? `, ${eps} eps` : "";
    return `${i + 1}. ${title} (${year ?? ""}) — ${g} — ${rt}${e}, rated ${r}`;
  });
  return (
    `I love: ${loves}.\n` +
    `Right now I'm ${moodTxt}, I have ${TIME_LABEL[timeAvailable] ?? "some time"}, ` +
    `and I want to watch ${want}.\n\n` +
    `Shortlist:\n${lines.join("\n")}\n\n` +
    `Reply ONLY with JSON: {"pick": <number>, "alt": [<number>, <number>], ` +
    `"why": "<max 16 words on the pick>", ` +
    `"alt_why": ["<max 12 words>", "<max 12 words>"]}`
  );
}

export function expandPrompt(likedTitles: string[], mood: string | null): string {
  const loves = likedTitles.length ? likedTitles.slice(0, 8).join(", ") : "a wide range of acclaimed titles";
  const moodTxt = EXPAND_MOOD[mood ?? ""] ?? "open to anything";
  return (
    `They love: ${loves}.\n` +
    `Right now they are ${moodTxt}.\n` +
    `Reply ONLY with JSON: {"genres": ["<genre>", "<genre>"]} — 2 to 4 genres.`
  );
}

export interface Curated {
  primary_index: number;
  alternate_indices: number[];
  why: string;
  /** Reason per shortlist index (0-based), so a swapped alternate shows its own line. */
  why_by_index: Record<number, string>;
}

function clip(text: unknown, limit: number): string {
  let s = String(text ?? "").trim().replace(/^"+|"+$/g, "").trim();
  if (s.length > limit) s = s.slice(0, limit - 3).trimEnd() + "...";
  return s;
}

function firstJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(raw.slice(start, end + 1));
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseCurator(raw: string | null, n: number): Curated | null {
  const data = firstJson(raw ?? "");
  if (!data) return null;
  const pick = data.pick;
  if (typeof pick !== "number" || !Number.isInteger(pick) || pick < 1 || pick > n) return null;

  const alts: number[] = [];
  for (const a of Array.isArray(data.alt) ? data.alt : []) {
    if (typeof a === "number" && Number.isInteger(a) && a >= 1 && a <= n && a !== pick && !alts.includes(a)) alts.push(a);
  }
  const top = alts.slice(0, 2);

  const why = clip(data.why, 160);
  const whyBy: Record<number, string> = { [pick - 1]: why };
  if (Array.isArray(data.alt_why)) {
    top.forEach((idx, k) => {
      const line = clip((data.alt_why as unknown[])[k], 120);
      if (line) whyBy[idx - 1] = line;
    });
  }
  return { primary_index: pick - 1, alternate_indices: top.map((a) => a - 1), why, why_by_index: whyBy };
}

export function parseExpansion(raw: string | null): Record<string, number> {
  const data = firstJson(raw ?? "");
  const out: Record<string, number> = {};
  for (const g of Array.isArray(data?.genres) ? (data!.genres as unknown[]) : []) {
    if (typeof g !== "string") continue;
    const key = g.toLowerCase().trim();
    if (KNOWN_GENRES.has(key)) out[key] = 1.0;
  }
  return out;
}
