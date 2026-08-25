import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The Supabase client, or `null` when the project isn't configured.
 *
 * Accounts are entirely optional: if the two env vars are absent the whole app
 * runs exactly as it did before — guest mode, no sign-in, no sync — and the
 * test suite needs no Supabase. Every consumer must treat `supabase` as possibly
 * null. The publishable key is designed to ship in the browser bundle; row-level
 * security on the `profiles` table is what actually protects the data.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

export const isAuthConfigured = supabase !== null;
