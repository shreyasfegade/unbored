/** What an import changes, worked out before anything is saved. */
import type { MediaItem } from "../types/media";
import type { Matched } from "./match";

export const LOVED_AT = 8; // 4 of 5 stars, or 8 of 10
export const DISLIKED_AT = 4; // 2 of 5 stars, or 4 of 10
/** Favourites an import may add. Picks read the latest 100, so a long rating
 *  history shouldn't push out everything the person chose by hand. */
export const MAX_IMPORTED_FAVOURITES = 60;

export interface ImportPlan<T extends MediaItem = MediaItem> {
  favourites: T[];
  notInterested: T[];
  /** Watched, liked or not: never suggested again. Excludes `notInterested`. */
  seen: T[];
}

export function planImport<T extends MediaItem>(matched: Matched<T>[]): ImportPlan<T> {
  const loved = matched
    .filter((m) => m.row.rating10 !== null && m.row.rating10 >= LOVED_AT)
    // Highest first, so the cap keeps the strongest signals.
    .sort((a, b) => (b.row.rating10 ?? 0) - (a.row.rating10 ?? 0))
    .slice(0, MAX_IMPORTED_FAVOURITES);
  const disliked = matched.filter((m) => m.row.rating10 !== null && m.row.rating10 <= DISLIKED_AT);
  const dislikedIds = new Set(disliked.map((m) => m.item.id));
  return {
    // Stored lowest-first so the best-loved land at the end, which is the part
    // of the list a pick reads first when it trims to its limit.
    favourites: loved.reverse().map((m) => m.item),
    notInterested: disliked.map((m) => m.item),
    seen: matched.filter((m) => !dislikedIds.has(m.item.id)).map((m) => m.item),
  };
}
