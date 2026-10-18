/**
 * Browse shelves and the swipe deck, served from the data pack. Shelf
 * membership is precomputed at build time (backend/app/services/shelves.py),
 * so each call here is a filter and a slice.
 */
import type { MediaItem } from '../types/media';
import { notFound, toMedia, typeFilter, withCatalog } from './catalog';

export interface BrowseShelf {
  key: string;
  title: string;
  count: number;
}

export interface BrowseShelfPage {
  key: string;
  title: string;
  items: MediaItem[];
  total: number;
  next_offset: number | null;
}

const MAX_LIMIT = 40;

function shuffle<T>(xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

/** A diverse deck for swipe-to-build-taste: round-robins across the genre rows
 *  so consecutive cards feel different, and never repeats a title. */
export const getBrowseDeck = (
  opts: { limit?: number; exclude?: string[]; mediaType?: string } = {},
) =>
  withCatalog(({ shelves, byId }) => {
    const limit = Math.max(1, Math.min(60, opts.limit ?? 30));
    const excluded = new Set(opts.exclude ?? []);
    const want = typeFilter(opts.mediaType);
    const ok = (id: string) => {
      const m = byId.get(id);
      return !!m && !excluded.has(id) && (!want || m.media_type === want);
    };

    const pools = shelves.shelves
      .filter((s) => s.key.startsWith('genre:'))
      .map((s) => shuffle(s.ids.slice(0, 80).filter(ok)))
      .filter((p) => p.length);

    if (!pools.length) {
      const trending = shelves.shelves.find((s) => s.key === 'trending')?.ids ?? [];
      return { items: shuffle(trending.filter(ok)).slice(0, limit).map((id) => toMedia(byId.get(id)!)) };
    }

    shuffle(pools);
    const picked: string[] = [];
    const seen = new Set<string>();
    const cursors = pools.map(() => 0);
    while (picked.length < limit && pools.some((p, i) => cursors[i] < p.length)) {
      for (let i = 0; i < pools.length && picked.length < limit; i++) {
        while (cursors[i] < pools[i].length) {
          const id = pools[i][cursors[i]++];
          if (!seen.has(id)) {
            seen.add(id);
            picked.push(id);
            break;
          }
        }
      }
    }
    return { items: picked.map((id) => toMedia(byId.get(id)!)) };
  });

export const getBrowseShelves = (mediaType?: string) =>
  withCatalog(({ shelves, byId }) => {
    const want = typeFilter(mediaType);
    const out: BrowseShelf[] = [];
    for (const s of shelves.shelves) {
      const count = want ? s.ids.filter((id) => byId.get(id)?.media_type === want).length : s.ids.length;
      if (count) out.push({ key: s.key, title: s.title, count });
    }
    return { shelves: out };
  });

export const getBrowseShelf = (
  key: string,
  opts: { offset?: number; limit?: number; mediaType?: string } = {},
) =>
  withCatalog(({ shelves, byId }): BrowseShelfPage => {
    const shelf = shelves.shelves.find((s) => s.key === key);
    if (!shelf) throw notFound(`Shelf ${key}`);
    const want = typeFilter(opts.mediaType);
    const ids = want ? shelf.ids.filter((id) => byId.get(id)?.media_type === want) : shelf.ids;
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.max(1, Math.min(MAX_LIMIT, opts.limit ?? 24));
    const page = ids.slice(offset, offset + limit).map((id) => toMedia(byId.get(id)!));
    return {
      key,
      title: shelf.title,
      items: page,
      total: ids.length,
      next_offset: offset + limit < ids.length ? offset + limit : null,
    };
  });
