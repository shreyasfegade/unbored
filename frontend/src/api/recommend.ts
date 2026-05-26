import api from './client';
import type { RecommendationRequest, RecommendationResponse, RegenerateRequest } from '../types/recommendation';

export const getRecommendation = (req: RecommendationRequest) =>
  api.post<RecommendationResponse>('/api/recommend', req);

export const regenerateRecommendation = (req: RegenerateRequest) =>
  api.post<RecommendationResponse>('/api/recommend/regenerate', req);
