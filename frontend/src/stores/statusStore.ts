import { create } from 'zustand';
import { getStatus, type AppStatus } from '../api/status';

interface StatusState {
  status: AppStatus | null;
  loaded: boolean;
  fetch: () => Promise<void>;
}

export const useStatusStore = create<StatusState>()((set, get) => ({
  status: null,
  loaded: false,
  fetch: async () => {
    if (get().loaded) return;
    try {
      const status = await getStatus();
      set({ status, loaded: true });
    } catch {
      // Backend not reachable yet — stay silent; UI degrades gracefully.
    }
  },
}));
