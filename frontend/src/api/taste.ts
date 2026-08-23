import api from './client';
import type { MediaItem } from '../types/media';

// The taste vector is no longer a server resource — taste lives in the browser
// and is sent per request. These endpoints are pure functions of that input.
export const fetchCuratedShortlist = () =>
  api.get<{ items: MediaItem[] }>('/api/search/curated-shortlist');

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
  api.post<TasteProfile>('/api/taste/profile', { favourite_ids: favouriteIds });
