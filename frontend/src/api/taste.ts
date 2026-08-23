import api from './client';
import type { MediaItem } from '../types/media';

// The taste vector is no longer a server resource — taste lives in the browser
// and is sent per recommend request. The only taste-adjacent server call left is
// the curated starter grid, which is a pure function of the frozen catalog.
export const fetchCuratedShortlist = () =>
  api.get<{ items: MediaItem[] }>('/api/search/curated-shortlist');
