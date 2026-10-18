-- Free AI tier: usage meters and the reason cache (frontend/api/_lib/store.ts).
--
-- RLS is on with no policies, so the browser's publishable key can't read or
-- write either table; only the Vercel functions, holding the service-role key,
-- can. IPs arrive already salted and hashed.

create table if not exists public.ai_usage (
  bucket text not null,          -- 'free:2026-10-19' (daily) or 'byo:2026-10-19T21:05' (per minute)
  ip_hash text not null,         -- '*' holds the bucket's global total
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (bucket, ip_hash)
);
alter table public.ai_usage enable row level security;

create table if not exists public.ai_reason_cache (
  key text primary key,          -- sha256 of provider, mood, slot, type, shortlist, taste
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.ai_reason_cache enable row level security;

-- Count one use, atomically, unless the caller or the bucket is at its limit.
create or replace function public.ai_take(
  p_bucket text, p_ip_hash text, p_limit integer, p_global_limit integer default null
) returns table (allowed boolean, used integer)
language plpgsql security definer set search_path = public as $$
declare
  v_used integer;
  v_global integer;
begin
  if p_global_limit is not null then
    select u.count into v_global from ai_usage u where u.bucket = p_bucket and u.ip_hash = '*';
    if coalesce(v_global, 0) >= p_global_limit then
      return query select false, coalesce(
        (select u.count from ai_usage u where u.bucket = p_bucket and u.ip_hash = p_ip_hash), 0);
      return;
    end if;
  end if;

  insert into ai_usage as u (bucket, ip_hash, count)
  values (p_bucket, p_ip_hash, 1)
  on conflict (bucket, ip_hash) do update
    set count = u.count + 1, updated_at = now()
    where u.count < p_limit
  returning u.count into v_used;

  if v_used is null then
    return query select false, p_limit;
    return;
  end if;

  if p_global_limit is not null then
    insert into ai_usage as u (bucket, ip_hash, count)
    values (p_bucket, '*', 1)
    on conflict (bucket, ip_hash) do update set count = u.count + 1, updated_at = now();
  end if;

  return query select true, v_used;
end $$;

-- Drop meters older than a few days and reasons older than a month. Called
-- opportunistically by the functions; also safe to schedule.
create or replace function public.ai_prune() returns void
language sql security definer set search_path = public as $$
  delete from ai_usage where updated_at < now() - interval '3 days';
  delete from ai_reason_cache where created_at < now() - interval '30 days';
$$;

revoke all on function public.ai_take(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.ai_prune() from public, anon, authenticated;
grant execute on function public.ai_take(text, text, integer, integer) to service_role;
grant execute on function public.ai_prune() to service_role;
