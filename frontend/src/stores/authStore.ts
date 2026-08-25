import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isAuthConfigured } from '../lib/supabase';

interface AuthState {
  ready: boolean;      // the initial session check has completed
  session: Session | null;
  user: User | null;
  configured: boolean; // whether accounts are available at all

  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>(() => ({
  ready: !isAuthConfigured, // nothing to wait for when accounts are off
  session: null,
  user: null,
  configured: isAuthConfigured,

  signUp: async (email, password) => {
    if (!supabase) return { error: 'Accounts are not available.' };
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  },
  signIn: async (email, password) => {
    if (!supabase) return { error: 'Accounts are not available.' };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  },
  signOut: async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  },
}));

// Wire the store to Supabase's own auth lifecycle once, at module load. A token
// refresh, or a sign-in/out in another tab, flows through here so every tab
// agrees on who is signed in.
if (supabase) {
  supabase.auth.getSession().then(({ data }) => {
    useAuthStore.setState({ ready: true, session: data.session, user: data.session?.user ?? null });
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    useAuthStore.setState({ session, user: session?.user ?? null, ready: true });
  });
}
