import { create } from 'zustand';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  setStatus: (status: SyncStatus) => void;
  markSynced: () => void;
}

// Tiny shared store so the account screen can show sync state without owning the
// sync effect (which is mounted once, in AppShell).
export const useSyncStore = create<SyncState>((set) => ({
  status: 'idle',
  lastSyncedAt: null,
  setStatus: (status) => set({ status }),
  markSynced: () => set({ status: 'synced', lastSyncedAt: Date.now() }),
}));
