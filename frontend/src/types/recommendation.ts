import type { MediaItem } from "./media";
import type { MoodType, TimeSlot, TimeOfDay, ConfidenceLevel } from "./mood";

export type MediaTypeChoice = "movie" | "tv" | "anime" | "surprise";

export interface ScoreBreakdown {
  relevance: number;
  mood: number;
  runtime: number;
  quality: number;
}

export interface ScoredMediaItem {
  media: MediaItem;
  score: number;
  score_breakdown: ScoreBreakdown;
}

export interface RecommendationRequest {
  taste_vector_id: string;
  mood: MoodType;
  time_available: TimeSlot;
  time_of_day: TimeOfDay;
  media_type: MediaTypeChoice;
  excluded_ids: string[];
}

export interface RecommendationResponse {
  primary: ScoredMediaItem;
  alternates: [ScoredMediaItem, ScoredMediaItem];
  rationale: string;
  picked_by: "ai" | "engine";
  provider: string | null;
  confidence: ConfidenceLevel;
  request_id: string;
}

export interface RegenerateRequest {
  taste_vector_id: string;
  mood: MoodType;
  time_available: TimeSlot;
  time_of_day: TimeOfDay;
  media_type: MediaTypeChoice;
  original_request_id: string;
  excluded_ids: string[];
}
