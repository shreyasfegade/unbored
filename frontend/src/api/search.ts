import api from './client';
import type { MediaItem } from '../types/media';

export const searchMulti = (query: string, type?: string) =>
  api.get<{ results: MediaItem[] }>('/api/search/multi', {
    params: type ? { q: query, type } : { q: query },
  });
