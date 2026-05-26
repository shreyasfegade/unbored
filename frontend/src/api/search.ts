import api from './client';
import type { MediaItem } from '../types/media';

export const searchMulti = (query: string) =>
  api.get<{ results: MediaItem[] }>('/api/search/multi', { params: { q: query } });
