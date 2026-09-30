begin;

-- No player IDs, names, IP addresses, device models or visit timestamps.
create table public.yukinaka_devices (
  device_id uuid primary key
);
alter table public.yukinaka_devices enable row level security;
revoke all on public.yukinaka_devices from public, anon, authenticated;
grant select, insert on public.yukinaka_devices to service_role;

-- A single shared counter limits admin guesses across Edge Function instances.
-- These are operational counters, not per-device access records.
create table public.yukinaka_admin_limit (
  id integer primary key check (id = 1),
  window_start timestamptz not null,
  attempts integer not null
);
insert into public.yukinaka_admin_limit values (1, now(), 0);
alter table public.yukinaka_admin_limit enable row level security;
revoke all on public.yukinaka_admin_limit from public, anon, authenticated;
grant select, update on public.yukinaka_admin_limit to service_role;

create function public.yukinaka_allow_admin_attempt()
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare allowed boolean;
begin
  update public.yukinaka_admin_limit
  set attempts = case when window_start <= now() - interval '1 minute' then 1 else attempts + 1 end,
      window_start = case when window_start <= now() - interval '1 minute' then now() else window_start end
  where id = 1 and (window_start <= now() - interval '1 minute' or attempts < 30)
  returning true into allowed;
  return coalesce(allowed, false);
end;
$$;
revoke all on function public.yukinaka_allow_admin_attempt() from public, anon, authenticated;
grant execute on function public.yukinaka_allow_admin_attempt() to service_role;

commit;
