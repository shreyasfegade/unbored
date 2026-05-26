import api from './client';
import type { UserTasteVector, UpdateTasteRequest } from '../types/taste';
import type { MediaItem, YouTubeImportResult } from '../types/media';

export const createTasteVector = (favouriteIds: string[]) =>
  api.post<UserTasteVector>('/api/taste', { favourite_ids: favouriteIds });

export const getTasteVector = (id: string) =>
  api.get<UserTasteVector>(`/api/taste/${id}`);

export const updateTasteVector = (id: string, data: UpdateTasteRequest) =>
  api.put<UserTasteVector>(`/api/taste/${id}`, data);

export const uploadYouTube = (id: string, file: File) => {
  const form = new FormData();
  form.append('file', file);
  return api.post<YouTubeImportResult>(`/api/taste/${id}/youtube`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
};

export const fetchCuratedShortlist = () =>
  api.get<{ items: MediaItem[] }>('/api/search/curated-shortlist');
