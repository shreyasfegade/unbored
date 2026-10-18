-- Profiles: one row per signed-in user, synced by frontend/src/hooks/useProfileSync.ts.
--
-- Reconstructed from what the app reads and writes; the live table predates
-- this file. `if not exists` keeps it a no-op on the existing project. If the
-- live columns differ, replace this with the output of `supabase db pull`.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  favourite_ids jsonb not null default '[]'::jsonb,
  library jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'profiles_own_row') then
    create policy profiles_own_row on public.profiles
      for all to authenticated
      using (auth.uid() = id)
      with check (auth.uid() = id);
  end if;
end $$;
