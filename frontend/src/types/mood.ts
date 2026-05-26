export type MoodType =
  | "happy_energetic"
  | "tired_low"
  | "anxious"
  | "want_to_cry"
  | "mindblown_curious"
  | "want_to_laugh"
  | "thrilled";

export const MOOD_DISPLAY_LABELS: Record<MoodType, string> = {
  happy_energetic: "Happy & Energetic",
  tired_low: "Tired / Low Energy",
  anxious: "Anxious",
  want_to_cry: "Want to Cry",
  mindblown_curious: "Mindblown / Curious",
  want_to_laugh: "Want to Laugh",
  thrilled: "Thrilled",
};

export const MOOD_EMOJIS: Record<MoodType, string> = {
  happy_energetic: "🌟",
  tired_low: "🌙",
  anxious: "🫧",
  want_to_cry: "🥀",
  mindblown_curious: "🔮",
  want_to_laugh: "😂",
  thrilled: "⚡",
};

export type TimeSlot = "short" | "medium" | "long";

export const TIME_SLOT_DISPLAY_LABELS: Record<TimeSlot, string> = {
  short: "≤ 30 min",
  medium: "30–90 min",
  long: "90+ min",
};

export const TIME_SLOT_MAX_MINUTES: Record<TimeSlot, number> = {
  short: 30,
  medium: 90,
  long: Infinity,
};

export const TIME_SLOT_MIN_MINUTES: Record<TimeSlot, number> = {
  short: 0,
  medium: 31,
  long: 91,
};

export type TimeOfDay = "morning" | "afternoon" | "evening" | "late_night";

export function detectTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "late_night";
}

export type ConfidenceLevel = "high" | "strong" | "moderate";

export const CONFIDENCE_DISPLAY: Record<ConfidenceLevel, string> = {
  high: "High confidence pick.",
  strong: "Unusually strong match tonight.",
  moderate: "Best fit right now.",
};
