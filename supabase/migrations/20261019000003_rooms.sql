-- Watch Together rooms (frontend/src/together/).
--
-- The live room (who's in it, the pick, veto rounds) is Supabase Realtime
-- presence and broadcast on the channel `room:<code>`, so it survives any
-- deploy or restart. This table only makes codes unique and gives them an
-- expiry.
--
-- No direct table access at all (RLS on, no policies): with a select policy,
-- anyone could list every live four-character code and walk into strangers'
-- rooms. Instead two functions open a room and check one code.

create table if not exists public.rooms (
  code text primary key check (code ~ '^[A-HJ-NP-Z2-9]{4}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours'
);
alter table public.rooms enable row level security;

-- Open a room under a fresh, unambiguous code (no 0/O/1/I).
create or replace function public.room_open()
returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
begin
  delete from rooms r where r.expires_at < now() - interval '1 day';
  for attempt in 1..64 loop
    candidate := '';
    for i in 1..4 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    begin
      insert into rooms (code) values (candidate);
      return query select r.code, r.expires_at from rooms r where r.code = candidate;
      return;
    exception when unique_violation then
      -- a live room or one awaiting cleanup has it; try another
    end;
  end loop;
  raise exception 'no free room code';
end $$;

-- When a code's room expires, or null if there's no such live room.
create or replace function public.room_lookup(p_code text)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select r.expires_at from rooms r where r.code = upper(p_code) and r.expires_at > now();
$$;

revoke all on function public.room_open() from public;
revoke all on function public.room_lookup(text) from public;
grant execute on function public.room_open() to anon, authenticated;
grant execute on function public.room_lookup(text) to anon, authenticated;
