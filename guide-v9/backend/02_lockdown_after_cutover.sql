-- Cascade guest guide v9: phase 2 lockdown
-- Run ONLY after: v9 is live on GitHub Pages, the staff app has been checked to use
-- the service role or authenticated reads (not anon) for app_settings, and v7.10.8 is retired.

begin;

-- 1. app_settings: no more anon reads (the guide uses get_public_settings / get_stay_secrets)
revoke select on public.app_settings from anon;
-- drop the anon read policy; check its exact name first with:
--   select policyname, roles, cmd from pg_policies where tablename = 'app_settings';
-- drop policy "<anon read policy name>" on public.app_settings;

-- 2. Guest history and returning-guest alerts: no longer callable by anyone with the anon key.
--    Fold both into verify_booking server-side if the guide still needs them.
revoke execute on function public.get_guest_history(text) from anon;
revoke execute on function public.log_returning_guest_alert from anon;  -- add its signature from \df

-- 3. The v1 verifiers: only the v2 wrappers (throttled, token-issuing) stay callable.
revoke execute on function public.verify_booking(date, text) from anon, authenticated, public;
revoke execute on function public.verify_admin_pin(text, text) from anon, authenticated, public;

commit;

-- Verify (must return 401/empty for app_settings, data for get_public_settings):
--   curl -H "apikey: <anon>" ".../rest/v1/app_settings?select=key"
--   curl -X POST -H "apikey: <anon>" ".../rest/v1/rpc/get_public_settings"
-- Then change the Wi-Fi password on the router and update app_settings.wifi_password.
