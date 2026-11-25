import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { NOW_MS, TODAY, WIFI, TOK_GUEST, PORT, addDays, defaults, newPage, ready, seed, stay, ls, guestGate } from './helpers.mjs';

/* Round 2: offline at the door, timeouts, revalidation, farewell, double submit, tokens, expiry rules. All Supabase calls are mocked; invented values only. */
const CI = TODAY, CO = addDays(TODAY, 2), DAY = 864e5;
const liveStay = (extra = {}) => stay({ ci: CI, co: CO, token: TOK_GUEST, ...extra });
const cacheOf = (o = {}) => JSON.stringify({ wifi_ssid: WIFI.ssid, wifi_password: WIFI.pass, onground_name: 'Honey', onground_phone: '+639170000000', at: NOW_MS - 7 * 36e5, exp: NOW_MS + 2 * DAY, ...o });
const NEWPASS = 'Changed-mock-PW-5520';
const secretsNew = () => ({ json: { ok: true, kind: 'guest', wifi_ssid: WIFI.ssid, wifi_password: NEWPASS, onground_name: 'Honey', onground_phone: '+639170000000' } });
const clean = async (h) => { await h.context.close(); };
/** Stop the page's clock once a timer under test has started, so the timeouts below are measured on page time, not real time. */
const freeze = async (page) => { const t = await page.evaluate(() => Date.now()); await page.clock.pauseAt(t + 50); };
const SW_URL = `http://127.0.0.1:${PORT}/Welcome-To-Cascades-/index.html?sw=1`;

/* ---------- (a) offline at the door: a real service worker, the network switched off ---------- */
test('R2a service worker: signed in once, then offline + reload still shows the guide and the Wi-Fi', async ({ browser }) => {
  const h = await newPage(browser);
  await h.page.goto(SW_URL, { waitUntil: 'load' });
  await expect.poll(() => h.page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active && r.active.state === 'activated'); }), { timeout: 20000 }).toBe(true);
  await h.page.reload({ waitUntil: 'load' }); // now controlled: this navigation and its images go through the worker
  await expect.poll(() => h.page.evaluate(() => !!navigator.serviceWorker.controller && !!document.querySelector('#gate')), { timeout: 20000 }).toBe(true);
  await guestGate(h.page);
  await h.page.locator('#g-success-btn').click();
  await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
  expect(await ls(h.page, 'cg_secrets')).toContain(WIFI.pass);
  await h.page.waitForTimeout(500); // let the first images settle into the cache
  const caches0 = await h.page.evaluate(async () => { const out = {}; for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search); return out; });
  expect(Object.keys(caches0), 'shell cache is v13').toContain('cascade-shell-v13');
  const shell = caches0['cascade-shell-v13'];
  for (const f of ['/Welcome-To-Cascades-/index.html', '/Welcome-To-Cascades-/img/smartlock.webp', '/Welcome-To-Cascades-/img/logo.png']) expect(shell, f).toContain(f);
  await h.context.setOffline(true);
  await h.page.reload({ waitUntil: 'load' });
  await expect(h.page.locator('#gate')).toBeHidden();
  await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
  await expect(h.page.locator('#wifilock .qrbox svg')).toHaveCount(1);
  expect(await h.page.evaluate(() => !!navigator.serviceWorker.controller), 'served by the worker').toBe(true);
  // the door guide image sits in the Arrive sheet and loads lazily: open the sheet offline, the cached copy must render
  await h.page.evaluate(() => document.querySelector('[data-open="arrive"]').click());
  await expect.poll(() => h.page.evaluate(() => { const i = document.querySelector('#locklock img'); return !!i && i.complete && i.naturalWidth > 0; })).toBe(true);
  // nothing from Supabase (and no secrets response) is ever in any cache
  const all = Object.values(await h.page.evaluate(async () => { const out = {}; for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).map((r) => r.url); return out; })).flat();
  expect(all.filter((u) => /supabase\.co|guide_secrets|rest\/v1\/rpc/.test(u)), 'no Supabase URL cached').toEqual([]);
  await clean(h);
});

/* ---------- (b) the aborts really fire ---------- */
test('R2b no cache: secrets call hangs, after the 15 s abort the "couldn\'t load" card and Try again show', async ({ browser }) => {
  const h = await newPage(browser);
  await seed(h.context, liveStay());
  h.mock.set('guide_secrets_v1', () => 'hang');
  await ready(h.page);
  await expect.poll(() => h.mock.callsOf('guide_secrets_v1').length).toBe(1);
  await expect(h.page.locator('#wifilock')).toContainText('Fetching your Wi-Fi details');
  await freeze(h.page);
  await h.page.clock.runFor('00:13');
  await expect(h.page.locator('#wifilock')).toContainText('Fetching your Wi-Fi details');
  await h.page.clock.runFor('00:04');
  await expect(h.page.locator('#wifilock')).toContainText("couldn't load");
  await expect(h.page.locator('#secretry')).toHaveCount(1); // attached (the Wi-Fi card sits in another chapter of the pager)
  expect(JSON.parse(await ls(h.page, 'ch_v2_token')), 'a timeout never drops the token').toBe(TOK_GUEST);
  await clean(h);
});
test('R2b verify_booking hangs: still checking at 14 s, moves on after the 15 s abort', async ({ browser }) => {
  const h = await newPage(browser);
  h.mock.set('verify_booking', () => 'hang');
  await ready(h.page);
  await h.page.locator('#gdate').fill(TODAY);
  await expect.poll(() => h.mock.callsOf('verify_booking').length).toBe(1);
  await expect(h.page.locator('#gdatechk')).toBeVisible();
  await freeze(h.page);
  await h.page.clock.runFor('00:13');
  await expect(h.page.locator('#gdatechk')).toBeVisible();
  await expect(h.page.locator('#g-initial')).toBeHidden();
  await h.page.clock.runFor('00:04');
  await expect(h.page.locator('#g-initial')).toBeVisible();
  await expect(h.page.locator('#gdatechk')).toBeHidden();
  await clean(h);
});
test('R2b guide_session_v1 hangs: sign-in completes without a token after the 8 s abort (not 15 s)', async ({ browser }) => {
  const h = await newPage(browser);
  h.mock.set('guide_session_v1', () => 'hang');
  await ready(h.page);
  await guestGate(h.page);
  await expect.poll(() => h.mock.callsOf('guide_session_v1').length).toBe(1);
  await freeze(h.page);
  await h.page.clock.runFor('00:06');
  await expect(h.page.locator('#g-success')).toBeHidden();
  await h.page.clock.runFor('00:04'); // 10 s in total: the 8 s abort has fired, the 15 s one would not have
  await expect(h.page.locator('#g-success')).toBeVisible();
  expect(await ls(h.page, 'ch_v2_token')).toBeNull();
  expect(await ls(h.page, 'ch_v2_verified')).toBe('true');
  await clean(h);
});

/* ---------- (c) revalidation of a cache older than 6 h ---------- */
test('R2c cache older than 6 h and a changed password: the shown password updates on its own', async ({ browser }) => {
  const h = await newPage(browser);
  h.mock.set('guide_secrets_v1', secretsNew);
  await seed(h.context, liveStay({ extra: { cg_secrets: cacheOf() } }));
  await ready(h.page);
  await expect(h.page.locator('#wifilock')).toContainText(NEWPASS);
  await expect(h.page.locator('#wifilock [data-copy]')).toHaveAttribute('data-copy', NEWPASS);
  expect(await h.page.content()).not.toContain(WIFI.pass);
  expect(h.mock.callsOf('guide_secrets_v1')).toHaveLength(1);
  const c = JSON.parse(await ls(h.page, 'cg_secrets'));
  expect(c.wifi_password).toBe(NEWPASS);
  const pageNow = await h.page.evaluate(() => Date.now()); // page time (the fixed test clock), not the runner's clock
  expect(pageNow - c.at, 'the cache carries a fresh stamp').toBeLessThan(60000);
  expect(pageNow - c.at).toBeGreaterThanOrEqual(0);
  await clean(h);
});
for (const [label, fail] of [['HTTP 500', () => ({ status: 500, json: null })], ['network abort', () => 'abort'], ['ok:true with no password', () => ({ json: { ok: true } })]]) {
  test(`R2c stale cache, refresh fails (${label}): the old password stays, token and cache kept`, async ({ browser }) => {
    const h = await newPage(browser);
    h.mock.set('guide_secrets_v1', fail);
    await seed(h.context, liveStay({ extra: { cg_secrets: cacheOf() } }));
    await ready(h.page);
    await expect.poll(() => h.mock.callsOf('guide_secrets_v1').length).toBeGreaterThanOrEqual(1);
    await h.page.waitForTimeout(400);
    await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
    expect(JSON.parse(await ls(h.page, 'ch_v2_token'))).toBe(TOK_GUEST);
    expect(JSON.parse(await ls(h.page, 'cg_secrets')).wifi_password).toBe(WIFI.pass);
    await clean(h);
  });
}
test('R2c stale cache, explicit ok:false: token and cache dropped, could-not-load card shown', async ({ browser }) => {
  const h = await newPage(browser);
  h.mock.set('guide_session_v1', () => ({ json: { ok: false, reason: 'no_match' } })); // a forged stay gets no token from the server
  h.mock.set('guide_secrets_v1', () => ({ json: { ok: false } }));
  await seed(h.context, liveStay({ extra: { cg_secrets: cacheOf() } }));
  await ready(h.page);
  await expect(h.page.locator('#wifilock .locked')).toHaveCount(0);
  await expect(h.page.locator('#secretry')).toHaveCount(1); // verified without a token: the could-not-load card, never the confirm card
  expect(await ls(h.page, 'ch_v2_token')).toBeNull();
  expect(await ls(h.page, 'cg_secrets')).toBeNull();
  expect(await h.page.content()).not.toContain(WIFI.pass);
  await clean(h);
});
test('R2c fresh cache (1 h old): no refresh call', async ({ browser }) => {
  const h = await newPage(browser);
  h.mock.set('guide_secrets_v1', secretsNew);
  await seed(h.context, liveStay({ extra: { cg_secrets: cacheOf({ at: NOW_MS - 36e5 }) } }));
  await ready(h.page);
  await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
  await h.page.waitForTimeout(800);
  expect(h.mock.callsOf('guide_secrets_v1')).toHaveLength(0);
  await clean(h);
});
test('R2c page left open: the cache turns 6 h old, coming back to the tab (visibilitychange) refreshes it', async ({ browser }) => {
  const h = await newPage(browser);
  await seed(h.context, liveStay({ extra: { cg_secrets: cacheOf({ at: NOW_MS - 36e5, exp: NOW_MS + 3 * DAY }) } }));
  await ready(h.page);
  await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
  h.mock.set('guide_secrets_v1', secretsNew);
  await h.page.clock.fastForward('06:00:00'); // now 7 h old
  await h.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(h.page.locator('#wifilock')).toContainText(NEWPASS);
  await clean(h);
});
test('R2c one shared in-flight call: several renders while a request is out, one secrets request', async ({ browser }) => {
  const h = await newPage(browser);
  const d = defaults().guide_secrets_v1;
  h.mock.set('guide_secrets_v1', async (b) => { await new Promise((r) => setTimeout(r, 900)); return d(b); });
  await ready(h.page);
  await h.page.locator('#g-admin-link').click();
  await h.page.locator('#gpw').fill('4242');
  await h.page.locator('#g-pw-go').click();
  await h.page.locator('#gids [data-aid="Honey"]').click(); // renders the locks, request one is now out
  // each stage chip re-runs personalise() and so renderLocks() while the request is still out
  await h.page.evaluate(() => { for (const k of ['arr', 'mid', 'out']) document.querySelector(`#stagechips [data-st="${k}"]`).click(); });
  await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
  expect(h.mock.callsOf('guide_secrets_v1')).toHaveLength(1);
  await clean(h);
});
test('R2c a slow secrets answer for a token that was signed out meanwhile is not written back', async ({ browser }) => {
  const h = await newPage(browser);
  const d = defaults().guide_secrets_v1;
  h.mock.set('guide_secrets_v1', async (b) => { await new Promise((r) => setTimeout(r, 700)); return d(b); });
  await seed(h.context, liveStay());
  await ready(h.page);
  await expect.poll(() => h.mock.callsOf('guide_secrets_v1').length).toBe(1);
  await h.page.evaluate(() => document.querySelector('#signout').click());
  await h.page.waitForTimeout(1200);
  expect(await ls(h.page, 'cg_secrets'), 'late answer must not re-create the cache').toBeNull();
  expect(await ls(h.page, 'ch_v2_token')).toBeNull();
  expect(await h.page.content()).not.toContain(WIFI.pass);
  await clean(h);
});

/* ---------- (d) farewell clears token, cache and DOM ---------- */
test('R2d stay expires while the page is open: farewell drops token and secrets, no password stays in the DOM', async ({ browser }) => {
  const at = `${TODAY}T23:58:00+08:00`, t = new Date(at).getTime();
  const h = await newPage(browser, { at });
  await seed(h.context, stay({ ci: addDays(TODAY, -3), co: addDays(TODAY, -1), token: TOK_GUEST, firstMs: t - 1e7, extra: { cg_secrets: cacheOf({ at: t, exp: t + 5 * DAY }) } }));
  await ready(h.page);
  await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
  await expect(h.page.locator('#wifilock [data-copy]')).toHaveCount(1);
  await h.page.clock.fastForward('03:00');
  await expect(h.page.locator('#farewell-page')).toBeVisible();
  expect(await ls(h.page, 'ch_v2_token')).toBeNull();
  expect(await ls(h.page, 'cg_secrets')).toBeNull();
  const html = await h.page.content();
  expect(html).not.toContain(WIFI.pass);
  await expect(h.page.locator('#wifilock [data-copy]')).toHaveCount(0);
  expect(await h.page.evaluate(() => [...document.querySelectorAll('[data-copy]')].map((e) => e.dataset.copy)), 'no data-copy carries the password').not.toContain(WIFI.pass);
  await expect(h.page.locator('#wifilock .locked')).toHaveCount(1);
  await clean(h);
});

/* ---------- (e) double submit on the staff code ---------- */
test('R2e staff code: Enter plus a click sends one request', async ({ browser }) => {
  const h = await newPage(browser);
  const d = defaults().guide_staff_session_v1;
  h.mock.set('guide_staff_session_v1', async (b) => { await new Promise((r) => setTimeout(r, 700)); return d(b); });
  await ready(h.page);
  await h.page.locator('#g-admin-link').click();
  await h.page.locator('#gpw').fill('4242');
  await h.page.locator('#gpw').press('Enter');
  await h.page.locator('#g-pw-go').click();
  await h.page.locator('#g-pw-go').click();
  await h.page.locator('#g-admin').waitFor({ state: 'visible' });
  expect(h.mock.callsOf('guide_staff_session_v1')).toHaveLength(1);
  expect(h.errors).toEqual([]);
  await clean(h);
});
test('R2e staff code: after a failed attempt the next attempt is sent (the guard is released)', async ({ browser }) => {
  const h = await newPage(browser);
  await ready(h.page);
  await h.page.locator('#g-admin-link').click();
  await h.page.locator('#gpw').fill('0000');
  await h.page.locator('#g-pw-go').click();
  await expect(h.page.locator('#gpwerr')).toContainText("didn't match");
  await h.page.locator('#gpw').fill('4242');
  await h.page.locator('#g-pw-go').click();
  await h.page.locator('#g-admin').waitFor({ state: 'visible' });
  expect(h.mock.callsOf('guide_staff_session_v1')).toHaveLength(2);
  await clean(h);
});

/* ---------- (f) re-verify with a prior token ---------- */
for (const [label, session] of [['HTTP 500', () => ({ status: 500, json: null })], ['ok:false', () => ({ json: { ok: false } })], ['hang is covered by R2b', null]]) {
  if (!session) continue;
  test(`R2f re-verify holding an old token, session call fails (${label}): no token and no old secrets after sign-in`, async ({ browser }) => {
    const h = await newPage(browser);
    h.mock.set('guide_session_v1', session);
    await seed(h.context, { ch_v2_token: JSON.stringify('old-token'), cg_secrets: cacheOf({ at: NOW_MS, wifi_password: 'Old-mock-PW-0001' }) });
    await ready(h.page);
    await guestGate(h.page);
    await h.page.locator('#g-success-btn').click();
    await expect(h.page.locator('#gate')).toBeHidden();
    expect(await ls(h.page, 'ch_v2_token')).toBeNull();
    expect(await ls(h.page, 'cg_secrets')).toBeNull();
    await expect(h.page.locator('#wifilock .locked')).toHaveCount(0);
    await expect(h.page.locator('#secretry')).toHaveCount(1);
    expect(await h.page.content()).not.toContain('Old-mock-PW-0001');
    expect(h.mock.callsOf('guide_secrets_v1')).toHaveLength(0);
    await clean(h);
  });
}

/* ---------- (g) staff session failing with 500 must not fall back ---------- */
test('R2g staff call answers 500: no verify_admin_pin fallback, error shown, no token', async ({ browser }) => {
  const h = await newPage(browser);
  h.mock.set('guide_staff_session_v1', () => ({ status: 500, json: null }));
  await ready(h.page);
  await h.page.locator('#g-admin-link').click();
  await h.page.locator('#gpw').fill('4242');
  await h.page.locator('#g-pw-go').click();
  await expect(h.page.locator('#gpwerr')).toContainText('Could not reach the server');
  expect(h.mock.callsOf('verify_admin_pin')).toHaveLength(0);
  expect(h.mock.callsOf('guide_staff_session_v1')).toHaveLength(1);
  await expect(h.page.locator('#g-admin')).toBeHidden();
  expect(await ls(h.page, 'ch_v2_token')).toBeNull();
  await clean(h);
});

/* ---------- (h) 24 h guest pass, 90 s grace ---------- */
test('R2h 90 s grace: an expired stay entered 85 s ago stays open, goes to the farewell once 90 s have passed', async ({ browser }) => {
  const h = await newPage(browser);
  await seed(h.context, stay({ ci: addDays(TODAY, -5), co: addDays(TODAY, -3), token: TOK_GUEST, firstMs: NOW_MS - 85000 }));
  await ready(h.page);
  await expect(h.page.locator('#farewell-page')).toBeHidden();
  await expect(h.page.locator('#gate')).toBeHidden();
  await h.page.clock.fastForward('01:10'); // 85 s + 70 s: past the grace, and the 60 s check has run
  await expect(h.page.locator('#farewell-page')).toBeVisible();
  await clean(h);
});
test('R2h 90 s grace: the same stay entered 95 s ago shows the farewell at once', async ({ browser }) => {
  const h = await newPage(browser);
  await seed(h.context, stay({ ci: addDays(TODAY, -5), co: addDays(TODAY, -3), token: TOK_GUEST, firstMs: NOW_MS - 95000 }));
  await ready(h.page);
  await expect(h.page.locator('#farewell-page')).toBeVisible();
  await clean(h);
});
for (const [label, at, open] of [['23:59 after the pass was set', NOW_MS + DAY - 60000, true], ['24 h 00:30 after the pass was set', NOW_MS + DAY + 30000, false]]) {
  test(`R2h guest pass lasts 24 h: ${label} -> gate ${open ? 'closed' : 'open again'}`, async ({ browser }) => {
    const h = await newPage(browser, { at: new Date(at).toISOString() });
    await seed(h.context, { cg_guest_until: String(NOW_MS + DAY), cg_guest_name: 'Pat' });
    await ready(h.page);
    if (open) await expect(h.page.locator('#gate')).toBeHidden();
    else { await expect(h.page.locator('#gate')).toBeVisible(); await expect(h.page.locator('#g-date')).toBeVisible(); }
    await clean(h);
  });
}
test('R2h taking the guest pass stamps 24 h on this device', async ({ browser }) => {
  const h = await newPage(browser);
  await ready(h.page);
  await h.page.locator('#gdate').fill('2026-01-01');
  await h.page.locator('#g-fail1').waitFor({ state: 'visible' });
  await h.page.locator('#g-retry').click();
  await h.page.locator('#gdate').fill('2026-01-02');
  await h.page.locator('#g-guestonly').waitFor({ state: 'visible' });
  await h.page.locator('#g-guest').click();
  await expect(h.page.locator('#gate')).toBeHidden();
  const until = +(await ls(h.page, 'cg_guest_until'));
  const now = await h.page.evaluate(() => Date.now());
  expect(until - now).toBeGreaterThan(DAY - 10000);
  expect(until - now).toBeLessThanOrEqual(DAY);
  await clean(h);
});
for (const [label, ago, ended] of [['25 h ago', DAY + 3600e3, true], ['23 h ago', DAY - 3600e3, false]]) {
  test(`R2h guest pass first used ${label}: ${ended ? 'access has ended message' : 'pass granted again'}`, async ({ browser }) => {
    const h = await newPage(browser);
    await seed(h.context, { ch_v2_guestUsedTs: String(NOW_MS - ago) });
    await ready(h.page);
    await h.page.locator('#gdate').fill('2026-01-01');
    await h.page.locator('#g-fail1').waitFor({ state: 'visible' });
    await h.page.locator('#g-retry').click();
    await h.page.locator('#gdate').fill('2026-01-02');
    await h.page.locator('#g-guestonly').waitFor({ state: 'visible' });
    await h.page.locator('#g-guest').click();
    if (ended) { await expect(h.page.locator('#g-guestonly .gsub')).toContainText('Guest access on this device has ended'); await expect(h.page.locator('#gate')).toBeVisible(); }
    else await expect(h.page.locator('#gate')).toBeHidden();
    await clean(h);
  });
}

/* ---------- logic fixes without a numbered test above ---------- */
test('R2 staff "exp" stage chip clears ADMIN, the staff token and the cached secrets', async ({ browser }) => {
  const h = await newPage(browser);
  await ready(h.page);
  await h.page.locator('#g-admin-link').click();
  await h.page.locator('#gpw').fill('4242');
  await h.page.locator('#g-pw-go').click();
  await h.page.locator('#gids [data-aid="Honey"]').click();
  await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
  expect(JSON.parse(await ls(h.page, 'ch_v2_token'))).toBe('tok-staff-1');
  expect(await ls(h.page, 'ch_v2_isAdmin'), 'staff flag is set before the exp chip, so the null below is not vacuous').toBe('true');
  await h.page.evaluate(() => document.querySelector('#stagechips [data-st="exp"]').click());
  await expect(h.page.locator('#farewell-page')).toBeVisible();
  expect(await ls(h.page, 'ch_v2_token')).toBeNull();
  expect(await ls(h.page, 'cg_secrets')).toBeNull();
  expect(await ls(h.page, 'ch_v2_isAdmin')).toBeNull();
  expect(await h.page.content()).not.toContain(WIFI.pass);
  await clean(h);
});
test('R2 scene(): after sign-in a later scene() change leaves no stale lazy copy and shows the new picture', async ({ browser }) => {
  // behaviour check of the scene() fix (the internals are block-scoped, so this drives the clock instead of calling scene() directly)
  const h = await newPage(browser, { at: `${TODAY}T12:00:00+08:00` });
  await ready(h.page);
  expect(await h.page.locator('#scene').getAttribute('data-bg'), 'before sign-in the picture waits for the lazy loader').toContain('img/');
  await guestGate(h.page);
  await h.page.locator('#g-success-btn').click();
  await expect(h.page.locator('#gate')).toBeHidden();
  const noon = await h.page.locator('#scene').evaluate((el) => el.style.backgroundImage);
  await h.page.clock.fastForward('07:00:00'); // 19:00, scene() has re-run every 15 minutes
  await expect.poll(() => h.page.locator('#scene').evaluate((el) => el.style.backgroundImage)).not.toBe(noon);
  expect(await h.page.locator('#scene').getAttribute('data-bg')).toBeNull();
  expect(await h.page.locator('#pfront').getAttribute('data-bg')).toBeNull();
  await clean(h);
});

/* ---------- migration from the v7.10.8 page (no ch_v2_token, plaintext ch_wifi_v1) ---------- */
const LEGACY_PW = 'Legacy-mock-PW-0001';
const v7Stay = (name) => stay({ name, ci: TODAY, co: addDays(TODAY, 2), extra: { ch_wifi_v1: LEGACY_PW } }); // mid-stay, check-in today, no token
test('R2 migration: v7.10.8 mid-stay state opens the guide, Wi-Fi arrives by a silent mint, door guide shows, legacy key removed', async ({ browser }) => {
  const h = await newPage(browser);
  await seed(h.context, v7Stay('Maria'));
  await ready(h.page);
  await expect(h.page.locator('#gate')).toBeHidden();
  await expect(h.page.locator('#greet')).toHaveText('Good afternoon, Maria. Welcome home.');
  await expect(h.page.locator('#farewell-page')).toBeHidden();
  await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
  await expect(h.page.locator('#wifilock .locked')).toHaveCount(0);
  expect(h.mock.callsOf('guide_session_v1')).toHaveLength(1);
  expect(await h.page.locator('#wifilock').textContent()).not.toContain(LEGACY_PW);
  await expect(h.page.locator('#locklock img')).toHaveCount(1);
  await expect(h.page.locator('#locklock .locked')).toHaveCount(0);
  expect(await ls(h.page, 'ch_wifi_v1'), 'plaintext legacy key removed at boot').toBeNull();
  expect(await h.page.content()).not.toContain(LEGACY_PW);
  await clean(h);
});
test('R2 migration: v7.10.8 mid-stay state, mint refused: the could-not-load card shows, never the confirm card, door guide shows, legacy key removed', async ({ browser }) => {
  const h = await newPage(browser);
  h.mock.set('guide_session_v1', () => ({ json: { ok: false, reason: 'busy' } }));
  await seed(h.context, v7Stay('Maria'));
  await ready(h.page);
  await expect(h.page.locator('#gate')).toBeHidden();
  await expect(h.page.locator('#secretry')).toHaveCount(1);
  await expect(h.page.locator('#wifilock')).toContainText("We couldn't load your Wi-Fi details");
  await expect(h.page.locator('#wifilock .locked')).toHaveCount(0);
  expect(await h.page.locator('#wifilock').textContent()).not.toContain(LEGACY_PW);
  await expect(h.page.locator('#locklock img')).toHaveCount(1);
  expect(await ls(h.page, 'ch_wifi_v1')).toBeNull();
  await clean(h);
});
test('R2 migration: a stored single-letter name does not show as a bare letter in the greeting', async ({ browser }) => {
  const h = await newPage(browser);
  await seed(h.context, v7Stay('M'));
  await ready(h.page);
  await expect(h.page.locator('#gate')).toBeHidden();
  await expect(h.page.locator('#greet')).toHaveText('Good afternoon. Welcome home.');
  await expect(h.page.locator('#dear')).toHaveText('Dear guest,');
  await clean(h);
});
test('R2 door guide: not verified shows the lock card, not the image', async ({ browser }) => {
  const h = await newPage(browser);
  await ready(h.page);
  await expect(h.page.locator('#locklock .locked')).toHaveCount(1);
  await expect(h.page.locator('#locklock img')).toHaveCount(0);
  await clean(h);
});
test('R2 service worker: ?fbclid= and ?sw= visits share one navigation copy (no query in the key); offline fallback works', async ({ browser }) => {
  const h = await newPage(browser);
  await h.page.goto(SW_URL, { waitUntil: 'load' });
  await expect.poll(() => h.page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active && r.active.state === 'activated'); }), { timeout: 20000 }).toBe(true);
  await h.page.reload({ waitUntil: 'load' });
  await expect.poll(() => h.page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20000 }).toBe(true);
  await h.page.goto(SW_URL.replace('?sw=1', '?fbclid=abc'), { waitUntil: 'load' });
  await h.page.goto(SW_URL.replace('?sw=1', '?fbclid=def'), { waitUntil: 'load' });
  const keys = await h.page.evaluate(async () => (await (await caches.open('cascade-shell-v13')).keys()).map((r) => new URL(r.url)).filter((u) => u.pathname.endsWith('index.html')).map((u) => u.pathname + u.search));
  expect(keys, 'one index.html entry, no query string').toEqual(['/Welcome-To-Cascades-/index.html']);
  await h.context.setOffline(true);
  await h.page.goto(SW_URL.replace('?sw=1', '?fbclid=zzz'), { waitUntil: 'load' });
  await expect(h.page.locator('#gate')).toBeVisible();
  await clean(h);
});

/* ---------- "Back to my guide" on the gate (owner-approved fix 9) ---------- */
for (const theme of ['day', 'night']) {
  test(`R2 gate back link ${theme}: guest-pass visitor opens the gate from the lock card, sees the link, one tap returns to the guide, nothing stored changes`, async ({ browser }) => {
    const h = await newPage(browser);
    await seed(h.context, { 'cg-theme': theme, cg_guest_until: String(NOW_MS + DAY), cg_guest_name: 'Pat' });
    await ready(h.page);
    await expect(h.page.locator('#gate')).toBeHidden();
    const before = await h.page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
    await h.page.evaluate(() => document.querySelector('#wifilock .locked [data-open="verify"]').click()); // the lock card sits in a sheet that is closed here
    await expect(h.page.locator('#gate')).toBeVisible();
    const link = h.page.locator('#g-guide-back');
    await expect(link).toBeVisible();
    await expect(link).toHaveText('← Back to my guide');
    expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
    fs.mkdirSync('out', { recursive: true });
    await h.page.locator('#gate').screenshot({ path: `out/gate-back-link-${theme}.png`, animations: 'disabled' });
    await link.click();
    await expect(h.page.locator('#gate')).toBeHidden();
    await expect(h.page.locator('#wifilock .locked')).toHaveCount(1);
    expect(await h.page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()))).toBe(before);
    await clean(h);
  });
}
test('R2 gate back link: a fresh visitor does not see it', async ({ browser }) => {
  const h = await newPage(browser);
  await ready(h.page);
  await expect(h.page.locator('#gate')).toBeVisible();
  await expect(h.page.locator('#g-guide-back')).toBeAttached();
  await expect(h.page.locator('#g-guide-back')).toBeHidden();
  await clean(h);
});

test('R2 gate back link: a stored name without verification does not show it', async ({ browser }) => {
  const h = await newPage(browser);
  await seed(h.context, v7Stay('Maria'));
  await ready(h.page);
  await h.page.evaluate(() => localStorage.removeItem('ch_v2_verified'));
  await h.page.reload();
  await ready(h.page);
  await expect(h.page.locator('#gate')).toBeVisible();
  await expect(h.page.locator('#g-guide-back')).toBeAttached();
  await expect(h.page.locator('#g-guide-back')).toBeHidden();
  await clean(h);
});
