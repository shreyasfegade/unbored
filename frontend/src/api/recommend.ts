import api from './client';
import type { RecommendationRequest, RecommendationResponse } from '../types/recommendation';

// Stateless: the request carries favourite_ids + excluded_ids. "Try again" is
// just another call with the previous pick added to excluded_ids.
export const getRecommendation = (req: RecommendationRequest, signal?: AbortSignal) =>
  api.post<RecommendationResponse>('/api/recommend', req, { signal });
