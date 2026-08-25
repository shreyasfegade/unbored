import { useTasteStore } from '../stores/tasteStore';
import { useLibraryStore } from '../stores/libraryStore';
import { usePreferencesStore } from '../stores/preferencesStore';

// A portable snapshot of everything that makes a profile: taste, library and
// preferences. This is the offline, no-account way to move a profile between
// devices (and a plain backup). Kept deliberately simple and versioned.
interface ProfileSnapshot {
  version: 1;
  exported_at: string;
  favourite_ids: string[];
  library: {
    watchlist: unknown[];
    seen: string[];
    not_interested: string[];
  };
  preferences: {
    tuning: unknown;
    density: string;
    reduce_motion: boolean;
    default_media_type: string;
    default_era: string;
  };
}

export function buildProfileSnapshot(): ProfileSnapshot {
  const taste = useTasteStore.getState();
  const lib = useLibraryStore.getState();
  const prefs = usePreferencesStore.getState();
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    favourite_ids: taste.favouriteIds,
    library: {
      watchlist: lib.watchlist,
      seen: lib.seen,
      not_interested: lib.notInterested,
    },
    preferences: {
      tuning: prefs.tuning,
      density: prefs.density,
      reduce_motion: prefs.reduceMotion,
      default_media_type: prefs.defaultMediaType,
      default_era: prefs.defaultEra,
    },
  };
}

/** Trigger a download of the current profile as JSON. */
export function downloadProfile(): void {
  const blob = new Blob([JSON.stringify(buildProfileSnapshot(), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `unbored-profile-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Apply a snapshot, merging favourites/library so an import adds rather than
 *  wipes. Returns how many favourites were added. Throws on a malformed file. */
export function applyProfileSnapshot(raw: string): number {
  const data = JSON.parse(raw) as Partial<ProfileSnapshot>;
  if (!data || typeof data !== 'object' || !Array.isArray(data.favourite_ids)) {
    throw new Error('That doesn’t look like an Unbored profile file.');
  }

  const taste = useTasteStore.getState();
  const before = taste.favouriteIds.length;
  taste.addFavouriteIds(data.favourite_ids.filter((x): x is string => typeof x === 'string'));

  const lib = useLibraryStore.getState();
  const libData = data.library;
  if (libData) {
    for (const item of (libData.watchlist as { id?: string }[]) ?? []) {
      // addToWatchlist ignores anything already present and bad shapes are cheap.
      if (item && typeof item === 'object' && typeof item.id === 'string') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lib.addToWatchlist(item as any);
      }
    }
    for (const id of (libData.seen as string[]) ?? []) if (typeof id === 'string') lib.markSeen(id);
    for (const id of (libData.not_interested as string[]) ?? []) {
      if (typeof id === 'string') lib.markNotInterested(id);
    }
  }

  const prefs = data.preferences;
  if (prefs && typeof prefs === 'object') {
    const store = usePreferencesStore.getState();
    if (prefs.density === 'compact' || prefs.density === 'comfortable') store.setDensity(prefs.density);
    if (typeof prefs.reduce_motion === 'boolean') store.setReduceMotion(prefs.reduce_motion);
  }

  return useTasteStore.getState().favouriteIds.length - before;
}
