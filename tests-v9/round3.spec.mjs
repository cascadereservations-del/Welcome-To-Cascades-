import { test, expect } from '@playwright/test';
import { TODAY, WIFI, NOW_MS, TOK_GUEST, addDays, defaults, newPage, ready, seed, stay, ls, guestGate } from './helpers.mjs';

/* Round 3: the silent token mint (guide_session_v1), its stored limits, the could-not-load card, extended stay, staff without a token. Mocked backend, invented values. */
const DAY = 864e5, MIN = 6e4;
const clean = async (h) => { await h.context.close(); };
const v7Stay = (name = 'Maria', o = {}) => stay({ name, ci: TODAY, co: addDays(TODAY, 2), ...o }); // mid-stay, no token (a v7.10.8 guest)
const mints = (h) => h.mock.callsOf('guide_session_v1');
const refuse = (reason) => () => ({ json: { ok: false, reason } });
/** Move the page clock, then wake the page the way a phone does (tab visible again). */
const wake = async (page, ms) => { await page.clock.fastForward(ms); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); };
const tryAgain = (page) => page.locator('#secretry').dispatchEvent('click'); // the card sits in another chapter of the pager

test('R3 v7.10.8 mid-stay, no token: one silent mint, Wi-Fi shows with no second verification, initial taken from the stored name', async ({ browser }) => {
  const h = await newPage(browser);
  await seed(h.context, v7Stay('Maria'));
  await ready(h.page);
  await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
  await expect(h.page.locator('#wifilock [role=img]')).toHaveAttribute('aria-label', 'QR code to join ' + WIFI.ssid);
  await expect(h.page.locator('#gate')).toBeHidden();
  expect(mints(h)).toHaveLength(1);
  expect(mints(h)[0].body).toMatchObject({ p_checkin_date: TODAY, p_initial: 'M' });
  expect(await ls(h.page, 'ch_v2_token')).toContain(TOK_GUEST);
  await h.page.reload();
  await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
  expect(mints(h), 'a token is stored: no further mint').toHaveLength(1);
  await clean(h);
});

test('R3 stored name missing or a placeholder: no mint, and the could-not-load card shows', async ({ browser }) => {
  for (const name of ['', 'Guest', 'Reserved']) {
    const h = await newPage(browser);
    await seed(h.context, v7Stay(name));
    await ready(h.page);
    await expect(h.page.locator('#secretry')).toHaveCount(1);
    await expect(h.page.locator('#wifilock .locked')).toHaveCount(0);
    expect(mints(h), `name "${name}"`).toHaveLength(0);
    await clean(h);
  }
});

test('R3 no_name: verified guest sees the could-not-load card, not the confirm card; 3 reloads and Try again stay at one call inside 6 h', async ({ browser }) => {
  const h = await newPage(browser);
  const base = defaults().verify_booking;
  h.mock.set('verify_booking', (b) => { const r = base(b); if (r.json && r.json.first_name) r.json.first_name = 'Reserved'; return r; }); // a placeholder booking name
  h.mock.set('guide_session_v1', refuse('no_name'));
  await ready(h.page);
  await guestGate(h.page);
  await h.page.locator('#g-askname').waitFor({ state: 'visible' });
  await h.page.locator('#gname').fill('Maria');
  await h.page.locator('#g-success-btn').click();
  await expect(h.page.locator('#secretry')).toHaveCount(1);
  await expect(h.page.locator('#wifilock')).toContainText("We couldn't load your Wi-Fi details");
  await expect(h.page.locator('#wifilock .locked')).toHaveCount(0);
  expect(mints(h), 'the sign-in call').toHaveLength(1);
  expect(JSON.parse(await ls(h.page, 'cg_mint')).reason).toBe('no_name');
  expect(await ls(h.page, 'cg_initial')).toBe('M');
  for (let i = 0; i < 3; i++) {
    await h.page.reload();
    await expect(h.page.locator('#secretry')).toHaveCount(1);
    await expect(h.page.locator('#wifilock .locked')).toHaveCount(0);
  }
  await tryAgain(h.page);
  await h.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await h.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await h.page.waitForTimeout(400);
  expect(mints(h), 'still one call').toHaveLength(1);
  await expect(h.page.locator('#secretry')).toHaveCount(1);
  await wake(h.page, 5 * 36e5 + 59 * MIN);
  await h.page.waitForTimeout(300);
  expect(mints(h), 'just under 6 h').toHaveLength(1);
  h.mock.set('guide_session_v1', defaults().guide_session_v1);
  await wake(h.page, 2 * MIN);
  await expect.poll(() => mints(h).length).toBe(2); // past 6 h
  await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
  await clean(h);
});

test('R3 too_early: one call at check-in minus 7 days, none on reload; two days before check-in one more call stores the token', async ({ browser }) => {
  const h = await newPage(browser);
  let early = true;
  h.mock.set('guide_session_v1', (b) => (early ? { json: { ok: false, reason: 'too_early' } } : defaults().guide_session_v1(b)));
  await seed(h.context, v7Stay('Maria', { ci: addDays(TODAY, 7), co: addDays(TODAY, 9) }));
  await ready(h.page);
  await expect(h.page.locator('#secretry')).toHaveCount(1);
  expect(mints(h)).toHaveLength(1);
  await h.page.reload(); await h.page.reload();
  await expect(h.page.locator('#secretry')).toHaveCount(1);
  await wake(h.page, 2 * DAY); // 5 days ahead: still outside the 3-day window
  await h.page.waitForTimeout(300);
  expect(mints(h), 'no call while check-in is more than 3 days away').toHaveLength(1);
  await tryAgain(h.page); await h.page.waitForTimeout(300);
  expect(mints(h), 'Try again obeys the same limit').toHaveLength(1);
  early = false;
  await wake(h.page, 3 * DAY); // 2 days before check-in
  await expect.poll(() => mints(h).length).toBe(2);
  await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
  expect(await ls(h.page, 'ch_v2_token')).toContain(TOK_GUEST);
  await clean(h);
});

test('R3 too_early inside the 3-day window: at most one call an hour', async ({ browser }) => {
  const h = await newPage(browser);
  h.mock.set('guide_session_v1', refuse('too_early'));
  await seed(h.context, v7Stay('Maria', { ci: addDays(TODAY, 2), co: addDays(TODAY, 4) }));
  await ready(h.page);
  await expect.poll(() => mints(h).length).toBe(1);
  await wake(h.page, 59 * MIN); await h.page.waitForTimeout(300);
  expect(mints(h)).toHaveLength(1);
  await wake(h.page, 2 * MIN);
  await expect.poll(() => mints(h).length).toBe(2);
  await clean(h);
});

for (const mode of ['abort', 'hang']) {
  test(`R3 network ${mode === 'hang' ? 'timeout (8 s)' : 'error'}: no retry within 60 s, one retry after`, async ({ browser }) => {
    const h = await newPage(browser);
    let fail = true;
    h.mock.set('guide_session_v1', (b) => (fail ? mode : defaults().guide_session_v1(b)));
    await seed(h.context, v7Stay('Maria'));
    await ready(h.page);
    await expect.poll(() => mints(h).length).toBe(1);
    if (mode === 'hang') await h.page.clock.fastForward(8500); // the 8 s timeout fires on page time
    await expect.poll(async () => (JSON.parse((await ls(h.page, 'cg_mint')) || 'null') || {}).reason).toBe('network');
    await expect(h.page.locator('#secretry')).toHaveCount(1);
    await wake(h.page, 30 * 1000); await h.page.waitForTimeout(300);
    await tryAgain(h.page); await h.page.waitForTimeout(300);
    expect(mints(h), 'inside 60 s').toHaveLength(1);
    fail = false;
    await wake(h.page, 31 * 1000);
    await expect.poll(() => mints(h).length).toBe(2);
    await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
    await clean(h);
  });
}

test('R3 throttled / busy: wait 15 min', async ({ browser }) => {
  const h = await newPage(browser);
  h.mock.set('guide_session_v1', refuse('throttled'));
  await seed(h.context, v7Stay('Maria'));
  await ready(h.page);
  await expect.poll(() => mints(h).length).toBe(1);
  await wake(h.page, 14 * MIN); await h.page.waitForTimeout(300);
  expect(mints(h)).toHaveLength(1);
  await wake(h.page, 2 * MIN);
  await expect.poll(() => mints(h).length).toBe(2);
  await clean(h);
});

test('R3 cap: at most 6 silent calls per device per 24 h, then again after 24 h', async ({ browser }) => {
  const h = await newPage(browser);
  h.mock.set('guide_session_v1', refuse('busy'));
  await seed(h.context, v7Stay('Maria', { co: addDays(TODAY, 4) }));
  await ready(h.page);
  await expect.poll(() => mints(h).length).toBe(1);
  for (let n = 2; n <= 6; n++) { await wake(h.page, 16 * MIN); await expect.poll(() => mints(h).length).toBe(n); }
  await wake(h.page, 16 * MIN); await h.page.waitForTimeout(300);
  await tryAgain(h.page); await h.page.waitForTimeout(300);
  await h.page.reload(); await h.page.waitForTimeout(300);
  expect(mints(h), 'cap reached').toHaveLength(6);
  await wake(h.page, 24 * 36e5);
  await expect.poll(() => mints(h).length).toBe(7); // the log has aged out
  await clean(h);
});

test('R3 never mints: unverified visitor, guest pass, expired guest (farewell), staff', async ({ browser }) => {
  const poke = async (h) => { await h.page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); }); await h.page.waitForTimeout(400); };
  { // unverified: confirm card stays
    const h = await newPage(browser);
    await ready(h.page); await poke(h);
    await expect(h.page.locator('#wifilock .locked')).toHaveCount(1);
    expect(mints(h)).toHaveLength(0);
    await clean(h);
  }
  { // 24 h guest pass
    const h = await newPage(browser);
    await seed(h.context, { cg_guest_until: String(NOW_MS + DAY), cg_guest_name: 'Pat' });
    await ready(h.page); await poke(h);
    await expect(h.page.locator('#wifilock .locked')).toHaveCount(1);
    expect(mints(h)).toHaveLength(0);
    await clean(h);
  }
  { // expired stay: the farewell page
    const h = await newPage(browser);
    await seed(h.context, stay({ name: 'Maria', ci: addDays(TODAY, -7), co: addDays(TODAY, -5), firstMs: NOW_MS - 10 * DAY, extra: { cg_initial: 'M' } }));
    await ready(h.page); await poke(h);
    await expect(h.page.locator('#farewell-page')).toBeVisible();
    expect(mints(h)).toHaveLength(0);
    await clean(h);
  }
  { // staff, no token
    const h = await newPage(browser);
    await seed(h.context, v7Stay('Lloyd', { extra: { ch_v2_isAdmin: 'true' } }));
    await ready(h.page); await poke(h);
    expect(mints(h)).toHaveLength(0);
    await clean(h);
  }
});

test('R3 m1: an extended stay lifts the farewell without a reload, and the Wi-Fi follows', async ({ browser }) => {
  const h = await newPage(browser);
  h.mock.set('verify_booking', (b) => ({ json: { found: true, match: true, checkin_date: b.p_checkin_date, checkout_date: addDays(TODAY, 2), nights: 5, checkout_time: '12:00' } }));
  await seed(h.context, stay({ name: 'Maria', ci: addDays(TODAY, -3), co: addDays(TODAY, -2), firstMs: NOW_MS - 10 * DAY }));
  let navs = 0; h.page.on('framenavigated', (f) => { if (f === h.page.mainFrame()) navs++; });
  await ready(h.page);
  await expect(h.page.locator('#farewell-page')).toBeHidden();
  await expect(h.page.locator('#gate')).toBeHidden();
  expect(await h.page.evaluate(() => document.documentElement.classList.contains('expired'))).toBe(false);
  expect(await h.page.evaluate(() => document.querySelector('.dock').inert)).toBe(false);
  expect(navs, 'no reload').toBe(1);
  expect(h.mock.callsOf('verify_booking').length, 'one reconcile, no loop').toBe(1);
  await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
  await clean(h);
});

test('R3 m1: a booking that is really over keeps the farewell after the reconcile', async ({ browser }) => {
  const h = await newPage(browser);
  h.mock.set('verify_booking', (b) => ({ json: { found: true, match: true, checkin_date: b.p_checkin_date, checkout_date: addDays(TODAY, -2), nights: 1 } }));
  await seed(h.context, stay({ name: 'Maria', ci: addDays(TODAY, -3), co: addDays(TODAY, -2), firstMs: NOW_MS - 10 * DAY }));
  await ready(h.page);
  await expect(h.page.locator('#farewell-page')).toBeVisible();
  await expect.poll(() => h.mock.callsOf('verify_booking').length).toBe(1);
  await h.page.waitForTimeout(300);
  await expect(h.page.locator('#farewell-page')).toBeVisible();
  expect(mints(h)).toHaveLength(0);
  await clean(h);
});

test('R3 m2: staff without a token see the could-not-load card; Try again re-opens the code step and the code is never stored', async ({ browser }) => {
  const h = await newPage(browser);
  await seed(h.context, v7Stay('Lloyd', { extra: { ch_v2_isAdmin: 'true' } }));
  await ready(h.page);
  await expect(h.page.locator('#secretry')).toHaveCount(1);
  await expect(h.page.locator('#wifilock')).toContainText("We couldn't load your Wi-Fi details");
  await expect(h.page.locator('#wifilock .locked')).toHaveCount(0);
  await tryAgain(h.page);
  await expect(h.page.locator('#gate')).toBeVisible();
  await expect(h.page.locator('#g-adminpw')).toBeVisible();
  await h.page.locator('#gpw').fill('4242');
  await h.page.locator('#g-pw-go').click();
  await expect(h.page.locator('#g-admin')).toBeVisible();
  const all = await h.page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(all).not.toContain('4242');
  expect(mints(h)).toHaveLength(0);
  await clean(h);
});

test('R3 the first load has no console error and the font stylesheet is requested with CORS', async ({ browser }) => {
  const h = await newPage(browser);
  await ready(h.page);
  expect(await h.page.locator('link[href*="fonts.googleapis.com/css2"]').getAttribute('crossorigin')).not.toBeNull();
  expect(await h.page.title()).toBe('Cascade Guest Guide v9.1');
  expect(h.errors).toEqual([]);
  expect(h.consoleErrors).toEqual([]);
  await clean(h);
});
