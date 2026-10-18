/**
 * Catalog search. A port of backend/app/routers/search.py: prefix, word-start,
 * substring, any-order tokens, keyword/genre, then a typo-tolerant fuzzy match,
 * with Python's difflib ratio reproduced so the same typos find the same titles.
 */
import type { MediaItem } from "../types/media";

export const MAX_RESULTS = 20;

/** Fold for matching: strip diacritics, drop punctuation, lowercase. */
export function norm(s: string | null | undefined): string {
  if (!s) return "";
  const stripped = s.normalize("NFKD").replace(/\p{Mn}/gu, "");
  return stripped.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const words = (s: string) => s.split(" ").filter(Boolean);

/** difflib.SequenceMatcher(None, a, b).ratio(), autojunk included. */
export function seqRatio(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la + lb === 0) return 1;

  const b2j = new Map<string, number[]>();
  for (let j = 0; j < lb; j++) {
    const list = b2j.get(b[j]);
    if (list) list.push(j);
    else b2j.set(b[j], [j]);
  }
  if (lb >= 200) {
    const ntest = Math.floor(lb / 100) + 1;
    for (const [ch, idxs] of Array.from(b2j)) if (idxs.length > ntest) b2j.delete(ch);
  }

  const findLongest = (alo: number, ahi: number, blo: number, bhi: number): [number, number, number] => {
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      for (const j of b2j.get(a[i]) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = next;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti--;
      bestj--;
      bestsize++;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize++;
    }
    return [besti, bestj, bestsize];
  };

  let matches = 0;
  const queue: [number, number, number, number][] = [[0, la, 0, lb]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop() as [number, number, number, number];
    const [i, j, k] = findLongest(alo, ahi, blo, bhi);
    if (k) {
      matches += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return (2 * matches) / (la + lb);
}

/** Lower is better: 0 prefix … 5 fuzzy, 9 no match. */
export function matchRank(item: MediaItem, needle: string, tokens: string[]): number {
  const titles = [norm(item.title), norm(item.original_title)];
  for (const title of titles) {
    if (!title) continue;
    const ws = words(title);
    if (title.startsWith(needle)) return 0;
    if (ws.some((w) => w.startsWith(needle))) return 1;
    if (title.includes(needle)) return 2;
    if (tokens.length && tokens.every((t) => ws.some((w) => w.startsWith(t)))) return 3;
  }
  if ((item.keywords ?? []).some((kw) => norm(kw).includes(needle)) || item.genres.some((g) => norm(g).includes(needle))) {
    return 4;
  }
  for (const title of titles) {
    if (title && seqRatio(needle, title) >= 0.82) return 5;
    if (title && words(title).some((w) => seqRatio(needle, w) >= 0.82)) return 5;
  }
  return 9;
}

export function searchCatalog<T extends MediaItem>(
  catalog: T[],
  q: string,
  type?: string | null,
): { results: T[]; total: number } {
  const needle = norm(q);
  const tokens = words(needle);
  const want = type && ["movie", "tv", "anime"].includes(type.toLowerCase()) ? type.toLowerCase() : null;
  const scored: { rank: number; pop: number; i: number; m: T }[] = [];
  catalog.forEach((m, i) => {
    if (want && m.media_type !== want) return;
    const rank = matchRank(m, needle, tokens);
    if (rank < 9) scored.push({ rank, pop: -(m.popularity_norm ?? 0), i, m });
  });
  scored.sort((a, b) => a.rank - b.rank || a.pop - b.pop || a.i - b.i);
  return { results: scored.slice(0, MAX_RESULTS).map((s) => s.m), total: scored.length };
}
