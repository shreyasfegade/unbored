import type { MediaItem } from "./media";
import type { MoodType, TimeSlot, TimeOfDay, ConfidenceLevel } from "./mood";

export interface ScoreBreakdown {
  genre: number;
  keyword: number;
  mood: number;
  runtime: number;
  rating: number;
  diversity: number;
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
  excluded_ids: string[];
}

export interface WhyNowResult {
  sentence: string;
  source: string;
}

export interface RecommendationResponse {
  primary: ScoredMediaItem;
  alternates: [ScoredMediaItem, ScoredMediaItem];
  why_now: WhyNowResult;
  confidence: ConfidenceLevel;
  request_id: string;
}

export interface RegenerateRequest {
  taste_vector_id: string;
  mood: MoodType;
  time_available: TimeSlot;
  time_of_day: TimeOfDay;
  original_request_id: string;
  excluded_ids: string[];
}
