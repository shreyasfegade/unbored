import type { MediaItem } from "./media";
import type { MoodType, TimeSlot, TimeOfDay, ConfidenceLevel } from "./mood";

export type MediaTypeChoice = "movie" | "tv" | "anime" | "surprise";
export type EraPreference = "modern" | "any" | "classic";
// "limited": today's shared free AI picks are used up (or the provider rate-
// limited a key), so the engine picked.
export type AIStatus = "off" | "used" | "timeout" | "error" | "limited";
export type AITier = "free" | "byo";

export interface ScoreBreakdown {
  relevance: number;
  mood: number;
  runtime: number;
  quality: number;
  recency: number;
}

export interface ScoredMediaItem {
  media: MediaItem;
  score: number;
  score_breakdown: ScoreBreakdown;
  // Per-item AI reason, so a hand-swapped alternate can show its own line.
  rationale?: string | null;
}

export interface TuningWeights {
  adventurous: number; // familiar ↔ adventurous
  obscurity: number;   // crowd-pleasers ↔ hidden gems
  acclaim: number;     // anything ↔ acclaimed
  freshness: number;   // timeless ↔ fresh
}

export interface RecommendationRequest {
  // The taste itself, sent per request — the API is stateless.
  favourite_ids: string[];
  mood: MoodType;
  time_available: TimeSlot;
  time_of_day: TimeOfDay;
  media_type: MediaTypeChoice;
  era?: EraPreference;
  excluded_ids: string[];
  tuning?: TuningWeights | null;
}

export interface RecommendationResponse {
  primary: ScoredMediaItem;
  // 0–2 alternates; the server no longer pads by cloning the primary.
  alternates: ScoredMediaItem[];
  rationale: string;
  picked_by: "ai" | "engine";
  provider: string | null;
  ai_status: AIStatus;
  /** Which AI made the call: the shared free tier or the visitor's own key. */
  ai_tier?: AITier | null;
  media_type_applied: boolean;
  confidence: ConfidenceLevel;
  request_id: string;
}

