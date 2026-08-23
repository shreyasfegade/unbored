import api from './client';
import { CATALOG_VERSION } from './catalogVersion';
import type { MediaItem } from '../types/media';

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

export const getBrowseDeck = (
  opts: { limit?: number; exclude?: string[]; mediaType?: string } = {},
) =>
  api.get<{ items: MediaItem[] }>('/api/browse/deck', {
    params: {
      v: CATALOG_VERSION,
      limit: opts.limit ?? 30,
      ...(opts.exclude?.length ? { exclude: opts.exclude.join(',') } : {}),
      ...(opts.mediaType ? { media_type: opts.mediaType } : {}),
    },
  });

export const getBrowseShelves = (mediaType?: string) =>
  api.get<{ shelves: BrowseShelf[] }>('/api/browse/shelves', {
    params: { v: CATALOG_VERSION, ...(mediaType ? { media_type: mediaType } : {}) },
  });

export const getBrowseShelf = (
  key: string,
  opts: { offset?: number; limit?: number; mediaType?: string } = {},
) =>
  api.get<BrowseShelfPage>(`/api/browse/shelf/${encodeURIComponent(key)}`, {
    params: {
      v: CATALOG_VERSION,
      offset: opts.offset ?? 0,
      limit: opts.limit ?? 24,
      ...(opts.mediaType ? { media_type: opts.mediaType } : {}),
    },
  });
