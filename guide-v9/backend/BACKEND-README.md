# Guest guide v9: backend finishing pack

Prepared 2026-11-25 from the mobile session. Tested against a local Postgres 16 with stand-in v1 functions (results below). Nothing here has touched production.

## Files
- `01_guest_tokens.sql`: phase 1, additive. Stay tokens, `verify_booking_v2`, `verify_admin_pin_v2`, `get_stay_secrets`, `get_public_settings`, failure throttle, weather warm-up cron, daily cleanup. Safe while v7.10.8 is live.
- `02_lockdown_after_cutover.sql`: phase 2. Revokes anon reads of `app_settings` and anon execute on the guest-history RPCs. Run only after v9 is live and the staff app is checked.

## Local test results (stub data)
| Check | Result |
|---|---|
| Date only | found, no name returned |
| Date + initial | token issued |
| Token expiry | check-out + 1 day, 23:59:59 Manila |
| Expired booking | no token |
| Bad token | `{"ok":false}` |
| Good token | Wi-Fi + on-ground contact |
| Staff code wrong / right | no token / token (12 h) |
| 9 wrong attempts | `throttled:true` |
| anon reads guest_sessions | permission denied |

## Laptop order (Claude Code desktop)
1. In Supabase SQL editor: `\df public.verify_booking` and `\df public.verify_admin_pin`. Confirm parameter names `p_checkin_date, p_initial` and `p_code, p_client`.
2. Run `01_guest_tokens.sql`. Then run the advisors. (Phase 1 can also be pasted from a phone browser.)
3. Check: `curl -X POST -H "apikey: <anon>" -H "Content-Type: application/json" -d '{"p_checkin_date":"2030-01-01"}' https://qkgfhsdppslwunarczeq.supabase.co/rest/v1/rpc/verify_booking_v2` returns `{"found":false}`.
4. Rebase guide-v9.bundle (v8/redesign f3bf928) onto main 3a29b8e. Port the preview's r12 changes into the real v9 code: secrets via `get_stay_secrets`, `rpc2` fallback, guest pass without Wi-Fi, lazy media, weather cache, meta tags, typography and copy, and the r13 Auto/Day/Night appearance switch (`applyTheme`, `[data-day]` CSS). Reference copy: v9-preview-r13.html.
5. Set `PREVIEW=false`; remove `WXSNAP` and the preview seed. Test: real booking, wrong date, expired date, staff code.
6. Push v9 to GitHub Pages.
7. Only then run `02_lockdown_after_cutover.sql` (fill in the policy name and the `log_returning_guest_alert` signature first). Curl `app_settings` with the anon key: must return nothing.
8. Change the Wi-Fi password on the router, update `app_settings.wifi_password`. The old one is in git history and in two public pages.
9. POI repos: replace each index.html with a redirect to the guide, archive both, and delete or restrict both Google keys (Nearby-POIS and Dining-Map use different keys). Set a quota and budget alert.
10. KB: update `00-foundation/system-state.md` and add a DECISIONS.md entry.

## Not covered yet
- `get_guide_places()` for the live `pois` (27) and `dining_spots` (16) rows: needs the display columns confirmed on the laptop.
- weather-proxy "serve cache first" edit: the function source was not available here; the cron warm-up covers the cold start meanwhile.
