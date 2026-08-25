import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { useSyncStore } from '../stores/syncStore';
import { useTasteStore } from '../stores/tasteStore';
import { useLibraryStore } from '../stores/libraryStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import type { MediaItem } from '../types/media';

/**
 * Local-first sync: the zustand stores stay the source of truth and Supabase is
 * a replica. On sign-in we pull the remote profile and *merge* it (union of
 * favourites and library, so a second device adds to your taste rather than
 * replacing it), then push the merged result. After that, local changes are
 * pushed on a debounce. Every failure is non-blocking — the app carries on
 * against local state and simply shows "not synced".
 *
 * Mounted once (in AppShell). The account screen reads `useSyncStore` for status
 * rather than calling this, so there's only ever one subscriber.
 */

interface RemoteProfile {
  favourite_ids: string[] | null;
  library: {
    watchlist?: MediaItem[];
    seen?: string[];
    not_interested?: string[];
  } | null;
  preferences: Record<string, unknown> | null;
}

function snapshot() {
  const taste = useTasteStore.getState();
  const lib = useLibraryStore.getState();
  const prefs = usePreferencesStore.getState();
  return {
    favourite_ids: taste.favouriteIds,
    library: { watchlist: lib.watchlist, seen: lib.seen, not_interested: lib.notInterested },
    preferences: {
      tuning: prefs.tuning,
      density: prefs.density,
      reduce_motion: prefs.reduceMotion,
      default_media_type: prefs.defaultMediaType,
      default_era: prefs.defaultEra,
    },
  };
}

function mergeRemoteIntoLocal(remote: RemoteProfile) {
  const taste = useTasteStore.getState();
  const lib = useLibraryStore.getState();

  if (Array.isArray(remote.favourite_ids)) {
    taste.addFavouriteIds(remote.favourite_ids.filter((x) => typeof x === 'string'));
  }
  const rl = remote.library;
  if (rl) {
    for (const item of rl.watchlist ?? []) {
      if (item && typeof item.id === 'string') lib.addToWatchlist(item);
    }
    for (const id of rl.seen ?? []) if (typeof id === 'string') lib.markSeen(id);
    for (const id of rl.not_interested ?? []) if (typeof id === 'string') lib.markNotInterested(id);
  }
  // Preferences are intentionally not pulled: the device you're on keeps its own
  // appearance/tuning. Favourites and library are what should follow you.
}

async function push(userId: string) {
  if (!supabase) return;
  const setStatus = useSyncStore.getState().setStatus;
  setStatus('syncing');
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: userId, ...snapshot(), updated_at: new Date().toISOString() });
  if (error) setStatus('error');
  else useSyncStore.getState().markSynced();
}

export function useProfileSync(): void {
  const userId = useAuthStore((s) => s.user?.id);

  // Initial pull + merge + push when a user signs in.
  useEffect(() => {
    if (!supabase || !userId) return;
    let active = true;
    (async () => {
      useSyncStore.getState().setStatus('syncing');
      try {
        const { data, error } = await supabase!
          .from('profiles')
          .select('favourite_ids, library, preferences')
          .eq('id', userId)
          .maybeSingle();
        if (!active) return;
        if (error) throw error;
        if (data) mergeRemoteIntoLocal(data as RemoteProfile);
        await push(userId);
      } catch {
        if (active) useSyncStore.getState().setStatus('error');
      }
    })();
    return () => { active = false; };
  }, [userId]);

  // Debounced push on any local change while signed in.
  useEffect(() => {
    if (!supabase || !userId) return;
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void push(userId); }, 2000);
    };
    const unsubs = [
      useTasteStore.subscribe(schedule),
      useLibraryStore.subscribe(schedule),
      usePreferencesStore.subscribe(schedule),
    ];
    return () => {
      window.clearTimeout(timer);
      unsubs.forEach((u) => u());
    };
  }, [userId]);
}
