export interface RecommendationHistoryEntry {
  media_id: string;
  timestamp: string;
  was_regenerated: boolean;
}

export interface UserTasteVector {
  id: string;
  genres: Record<string, number>;
  keywords: Record<string, number>;
  pacing_preference: "fast" | "slow" | "mixed";
  emotional_intensity: number;
  darkness_preference: number;
  humor_affinity: number;
  animation_affinity: number;
  runtime_preference: "short" | "medium" | "long";
  watched_ids: string[];
  favourites: string[];
  onboarding_completed: boolean;
  enrichment_sources: string[];
  recommendation_history: RecommendationHistoryEntry[];
  created_at: string;
  updated_at: string;
}

export interface CreateTasteRequest {
  favourite_ids: string[];
}

export interface UpdateTasteRequest {
  add_favourites?: string[];
  add_watched_ids?: string[];
  genre_overrides?: Record<string, number>;
  keyword_overrides?: Record<string, number>;
  pacing_preference?: "fast" | "slow" | "mixed";
  emotional_intensity?: number;
  darkness_preference?: number;
  humor_affinity?: number;
  animation_affinity?: number;
  runtime_preference?: "short" | "medium" | "long";
  enrichment_source?: string;
}
