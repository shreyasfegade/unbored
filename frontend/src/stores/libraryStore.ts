import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MediaItem } from '../types/media';

/**
 * What the user has decided about titles they've been shown: saved for later,
 * already watched, or never show me this again.
 *
 * `seen` and `notInterested` are ids because they only ever feed the request's
 * `excluded_ids`; the watchlist keeps whole items so the library page can render
 * without refetching each one.
 */
interface LibraryState {
  watchlist: MediaItem[];
  seen: string[];
  notInterested: string[];

  addToWatchlist: (item: MediaItem) => void;
  removeFromWatchlist: (id: string) => void;
  isSaved: (id: string) => boolean;
  markSeen: (id: string) => void;
  unmarkSeen: (id: string) => void;
  markNotInterested: (id: string) => void;
  unmarkNotInterested: (id: string) => void;
  clearLibrary: () => void;
}

const without = (list: string[], id: string) => list.filter((x) => x !== id);
const withId = (list: string[], id: string) =>
  list.includes(id) ? list : [...list, id];

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      watchlist: [],
      seen: [],
      notInterested: [],

      addToWatchlist: (item) =>
        set((s) =>
          s.watchlist.some((w) => w.id === item.id)
            ? s
            : { watchlist: [item, ...s.watchlist] },
        ),
      removeFromWatchlist: (id) =>
        set((s) => ({ watchlist: s.watchlist.filter((w) => w.id !== id) })),
      isSaved: (id) => get().watchlist.some((w) => w.id === id),

      // Seen and not-interested are mutually exclusive verdicts on one title.
      markSeen: (id) =>
        set((s) => ({ seen: withId(s.seen, id), notInterested: without(s.notInterested, id) })),
      unmarkSeen: (id) => set((s) => ({ seen: without(s.seen, id) })),
      markNotInterested: (id) =>
        set((s) => ({ notInterested: withId(s.notInterested, id), seen: without(s.seen, id) })),
      unmarkNotInterested: (id) =>
        set((s) => ({ notInterested: without(s.notInterested, id) })),

      clearLibrary: () => set({ watchlist: [], seen: [], notInterested: [] }),
    }),
    { name: 'unbored-library' },
  ),
);

/** Ids the engine should never surface again, for the request's excluded_ids. */
export function suppressedIds(): string[] {
  const { seen, notInterested } = useLibraryStore.getState();
  return [...seen, ...notInterested];
}
