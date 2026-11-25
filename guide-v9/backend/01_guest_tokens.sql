-- Cascade guest guide v9: stay tokens, secrets RPC, public settings, weather warm-up
-- Phase 1. Additive only: nothing the live guide v7.10.8 or the staff app uses is changed or revoked.
-- Run BEFORE: \df public.verify_booking  and  \df public.verify_admin_pin
--   and confirm the parameter names below (p_checkin_date, p_initial, p_code, p_client) match.

begin;

-- 1. Tokens (no anon access at all)
create table if not exists public.guest_sessions (
  token       uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('guest','staff')),
  label       text,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
alter table public.guest_sessions enable row level security;
revoke all on public.guest_sessions from anon, authenticated;

-- 2. Failure throttle for guest verification (8 misses per 15 min per client IP)
create table if not exists public.verify_attempts (
  ip         text not null,
  at         timestamptz not null default now()
);
create index if not exists verify_attempts_ip_at on public.verify_attempts (ip, at);
alter table public.verify_attempts enable row level security;
revoke all on public.verify_attempts from anon, authenticated;

create or replace function public._client_ip() returns text
language sql stable as $$
  select coalesce(split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1), 'unknown')
$$;

-- 3. verify_booking_v2: wraps v1, adds throttle and a stay token on a full, live match
create or replace function public.verify_booking_v2(p_checkin_date date, p_initial text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d    jsonb;
  v_ip text := public._client_ip();
  co   date;
  tok  uuid;
begin
  if (select count(*) from verify_attempts where ip = v_ip and at > now() - interval '15 minutes') >= 8 then
    return jsonb_build_object('found', false, 'throttled', true);
  end if;

  d := public.verify_booking(p_checkin_date => p_checkin_date, p_initial => p_initial);

  if coalesce((d->>'found')::boolean, false) = false then
    if p_initial is not null then insert into verify_attempts(ip) values (v_ip); end if;  -- date-only misses do not count
    return d;
  end if;

  if p_initial is null then
    return d - 'full_name' - 'first_name';  -- a date alone never reveals who is staying
  end if;

  if coalesce((d->>'expired')::boolean, false) = false then
    co := nullif(d->>'checkout_date', '')::date;
    insert into guest_sessions(kind, label, expires_at)
    values ('guest', left(coalesce(d->>'full_name', ''), 1),
            coalesce(((co + 1)::text || ' 23:59:59')::timestamp at time zone 'Asia/Manila', now() + interval '7 days'))
    returning token into tok;
    d := d || jsonb_build_object('token', tok);
  end if;
  return d;
end $$;

-- 4. verify_admin_pin_v2: wraps v1, issues a 12 h staff token
create or replace function public.verify_admin_pin_v2(p_code text, p_client text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb; tok uuid;
begin
  d := public.verify_admin_pin(p_code => p_code, p_client => p_client);
  if coalesce((d->>'ok')::boolean, false) then
    insert into guest_sessions(kind, label, expires_at) values ('staff', 'pin', now() + interval '12 hours')
    returning token into tok;
    d := d || jsonb_build_object('token', tok);
  end if;
  return d;
end $$;

-- 5. Secrets, only for a live token
create or replace function public.get_stay_secrets(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from guest_sessions where token = p_token and expires_at > now()) then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object(
    'ok', true,
    'wifi_ssid',      (select value #>> '{}' from app_settings where key = 'wifi_ssid'),
    'wifi_password',  (select value #>> '{}' from app_settings where key = 'wifi_password'),
    'onground_name',  (select value #>> '{}' from app_settings where key = 'onground_name'),
    'onground_phone', (select value #>> '{}' from app_settings where key = 'onground_phone'));
end $$;

-- 6. Whitelisted public settings (replaces anon SELECT on app_settings in phase 2)
create or replace function public.get_public_settings()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from app_settings
  where key in ('wifi_ssid','house_times','min_nights','max_nights','review_airbnb_url',
                'review_facebook_url','review_google_url','property_lat','property_lng','concierge_mode')
$$;

revoke all on function public.verify_booking_v2(date, text), public.verify_admin_pin_v2(text, text),
  public.get_stay_secrets(uuid), public.get_public_settings(), public._client_ip() from public;
grant execute on function public.verify_booking_v2(date, text), public.verify_admin_pin_v2(text, text),
  public.get_stay_secrets(uuid), public.get_public_settings() to anon, authenticated;

commit;

-- 7. Keep weather-proxy warm so guests never meet the 22 s cold path (needs pg_cron + pg_net)
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('weather-proxy-warm', '*/10 * * * *', $$
  select net.http_get(
    url := 'https://qkgfhsdppslwunarczeq.supabase.co/functions/v1/weather-proxy',
    headers := '{"apikey":"sb_publishable_JFuRYZ9csmQULcMRmHXDSg_Abo9UeCj"}'::jsonb)
$$);

-- 8. Housekeeping: drop expired tokens and old attempts daily
select cron.schedule('guest-sessions-cleanup', '17 3 * * *', $$
  delete from public.guest_sessions where expires_at < now() - interval '1 day';
  delete from public.verify_attempts where at < now() - interval '1 day';
$$);
