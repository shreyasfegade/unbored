import type { MediaItem } from "../types/media";

/** One catalog title as the data pack ships it: the display fields plus what
 *  the build precomputed for the engine (scripts/build_web_pack.py). */
export interface Card extends MediaItem {
  popularity_norm: number;
  /** Tone axes [energy, darkness, warmth, intensity, humor], each 0..1. */
  tone: number[];
  /** Bayesian quality prior, 0..1. */
  quality: number;
}

export interface PackManifest {
  version: number;
  generated_at: string | null;
  count: number;
  dims: number;
  files: { cards: string; engine: string; shelves: string };
  bytes?: Record<string, { raw: number; gzip: number }>;
}

export interface CardsDoc {
  attribution: string | null;
  items: Card[];
}

export interface ShelfDoc {
  key: string;
  title: string;
  ids: string[];
}

export interface ShelvesDoc {
  shelves: ShelfDoc[];
  shortlist: string[];
  mood_targets: Record<string, number[]>;
}
