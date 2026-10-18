/** Match imported rows to catalog titles: IMDb id first, then title and year. */
import { norm } from "../engine/search";
import type { MediaItem } from "../types/media";
import type { ImportRow } from "./formats";

export interface Matched<T extends MediaItem = MediaItem> {
  row: ImportRow;
  item: T;
}

export interface MatchResult<T extends MediaItem = MediaItem> {
  matched: Matched<T>[];
  unmatched: ImportRow[];
}

const YEAR_SLACK = 1; // release years differ by a year between sources often enough

export function matchRows<T extends MediaItem>(rows: ImportRow[], catalog: T[]): MatchResult<T> {
  const byImdb = new Map<string, T>();
  const byTitle = new Map<string, T[]>();
  for (const item of catalog) {
    if (item.imdb_id) byImdb.set(item.imdb_id, item);
    for (const t of new Set([norm(item.title), norm(item.original_title)])) {
      if (!t) continue;
      const list = byTitle.get(t);
      if (list) list.push(item);
      else byTitle.set(t, [item]);
    }
  }

  const matched: Matched<T>[] = [];
  const unmatched: ImportRow[] = [];
  const used = new Set<string>();

  for (const row of rows) {
    let item = row.imdbId ? byImdb.get(row.imdbId) : undefined;
    if (!item) {
      const candidates = new Set<T>();
      for (const t of [norm(row.title), norm(row.originalTitle)]) {
        for (const c of (t && byTitle.get(t)) || []) candidates.add(c);
      }
      item = bestCandidate([...candidates], row);
    }
    if (item && !used.has(item.id)) {
      used.add(item.id);
      matched.push({ row, item });
    } else if (!item) {
      unmatched.push(row);
    }
    // A second row for an already-matched title (a rewatch) is simply folded in.
  }
  return { matched, unmatched };
}

function bestCandidate<T extends MediaItem>(candidates: T[], row: ImportRow): T | undefined {
  const scored = candidates
    .map((c) => {
      const year = c.release_year ?? c.year ?? null;
      const gap = row.year !== null && year !== null ? Math.abs(year - row.year) : row.year === null ? 0 : 99;
      const kindOk = !row.kind || (row.kind === "movie" ? c.media_type !== "tv" : c.media_type !== "movie");
      return { c, gap, kindOk };
    })
    .filter((x) => x.gap <= YEAR_SLACK && x.kindOk);
  scored.sort((a, b) => a.gap - b.gap || b.c.vote_count - a.c.vote_count);
  return scored[0]?.c;
}
