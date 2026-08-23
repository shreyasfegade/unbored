import api from './client';
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

export const getBrowseShelves = (mediaType?: string) =>
  api.get<{ shelves: BrowseShelf[] }>('/api/browse/shelves', {
    params: mediaType ? { media_type: mediaType } : undefined,
  });

export const getBrowseShelf = (
  key: string,
  opts: { offset?: number; limit?: number; mediaType?: string } = {},
) =>
  api.get<BrowseShelfPage>(`/api/browse/shelf/${encodeURIComponent(key)}`, {
    params: {
      offset: opts.offset ?? 0,
      limit: opts.limit ?? 24,
      ...(opts.mediaType ? { media_type: opts.mediaType } : {}),
    },
  });
