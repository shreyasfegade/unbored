import { summariseTaste } from '../engine/taste';
import { toMedia, withCatalog } from './catalog';

// Taste lives in the browser; these are pure functions of it and the catalog.
export const fetchCuratedShortlist = () =>
  withCatalog(({ shelves, byId }) => ({
    items: shelves.shortlist.map((id) => byId.get(id)).filter((c) => c !== undefined).map(toMedia),
  }));

export interface GenreWeight {
  name: string;
  count: number;
  share: number;
}

export interface DecadeCount {
  decade: string;
  count: number;
}

export interface TasteProfile {
  resolved: number;
  requested: number;
  genres: GenreWeight[];
  decades: DecadeCount[];
  media_types: Record<string, number>;
  mean_runtime: number | null;
  mean_rating: number | null;
  tone: Record<string, number>;
  top_directors: string[];
  top_studios: string[];
  top_cast: string[];
}

export const fetchTasteProfile = (favouriteIds: string[]) =>
  withCatalog(({ byId }): TasteProfile => {
    const ids = favouriteIds.slice(0, 200);
    const items = ids.map((id) => byId.get(id)).filter((c) => c !== undefined);
    return summariseTaste(items, ids.length);
  });
