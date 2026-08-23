import { create } from "zustand";

export interface Toast {
  id: string;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  addToast: (message: string) => void;
  removeToast: (id: string) => void;
}

let nextId = 0;
// Track each toast's auto-dismiss timer so a manual dismiss can cancel it
// instead of leaving an orphan timer to fire a redundant state update.
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  addToast: (message) => {
    const id = String(++nextId);
    set((s) => ({ toasts: [...s.toasts, { id, message }] }));
    const timer = setTimeout(() => get().removeToast(id), 3000);
    timers.set(id, timer);
  },
  removeToast: (id) => {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
