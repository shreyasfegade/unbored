import type { MoodType } from "../types/mood";

export interface MoodConfig {
  id: MoodType;
  label: string;
  icon: string;
  color: string;
  description: string;
}

export const MOOD_CONFIGS: readonly MoodConfig[] = [
  {
    id: "happy_energetic",
    label: "Happy / Energetic",
    icon: "🔥",
    color: "#F59E0B",
    description: "Upbeat, high-energy, ready for fun",
  },
  {
    id: "tired_low",
    label: "Tired / Low Energy",
    icon: "🌙",
    color: "#6366F1",
    description: "Winding down, comfort viewing",
  },
  {
    id: "anxious",
    label: "Anxious",
    icon: "🫧",
    color: "#06B6D4",
    description: "Need something calming and safe",
  },
  {
    id: "want_to_cry",
    label: "Want to Cry",
    icon: "🥀",
    color: "#EC4899",
    description: "In the mood for emotional depth",
  },
  {
    id: "mindblown_curious",
    label: "Mindblown / Curious",
    icon: "🧠",
    color: "#8B5CF6",
    description: "Ready for complexity and wonder",
  },
  {
    id: "want_to_laugh",
    label: "Want to Laugh",
    icon: "😂",
    color: "#22C55E",
    description: "Just make me laugh",
  },
  {
    id: "thrilled",
    label: "Thrilled",
    icon: "⚡",
    color: "#EF4444",
    description: "Heart pounding, edge of seat",
  },
] as const;

export const MOOD_CONFIG_MAP: ReadonlyMap<MoodType, MoodConfig> = new Map(
  MOOD_CONFIGS.map((m) => [m.id, m])
);
