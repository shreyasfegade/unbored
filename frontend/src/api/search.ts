import api from './client';
import { CATALOG_VERSION } from './catalogVersion';
import type { MediaItem } from '../types/media';

export const searchMulti = (query: string, type?: string) =>
  api.get<{ results: MediaItem[] }>('/api/search/multi', {
    params: { q: query, v: CATALOG_VERSION, ...(type ? { type } : {}) },
  });
