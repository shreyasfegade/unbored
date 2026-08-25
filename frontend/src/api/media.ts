import api from './client';
import type { MediaItem } from '../types/media';

// Fetch one catalog item by composite id — powers shareable /pick/:id links,
// which render for anyone with no local state.
export const getCatalogItem = (id: string) =>
  api.get<MediaItem>(`/api/media/item/${encodeURIComponent(id)}`);

// Resolve many ids in one request (order preserved, unknown ids skipped).
export const getCatalogItems = (ids: string[]) =>
  api.get<{ items: MediaItem[] }>(`/api/media/batch`, {
    params: { ids: ids.join(",") },
  });
