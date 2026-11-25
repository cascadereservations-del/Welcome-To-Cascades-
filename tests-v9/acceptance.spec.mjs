import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { NOW_ISO, NOW_MS, TODAY, WX, WIFI, TOK_GUEST, TOK_STAFF, URL_ROOT, addDays, newPage, ready, seed, stay, ls, guestGate } from './helpers.mjs';

const CI = TODAY, CO = addDays(TODAY, 2);
const liveStay = (extra = {}) => stay({ ci: CI, co: CO, token: TOK_GUEST, ...extra });
const clean = async (h) => { await h.context.close(); };

/* ---------- C1: no page or console errors, day and night, four widths ---------- */
for (const theme of ['day', 'night']) {
  for (const width of [320, 390, 820, 1280]) {
    for (const state of ['gate', 'signed-in']) {
      test(`C1 no errors ${theme} ${width}px ${state}`, async ({ browser }) => {
        const h = await newPage(browser, { width, height: 800 });
        const entries = { 'cg-theme': theme, ...(state === 'signed-in' ? liveStay() : {}) };
        await seed(h.context, entries);
        await ready(h.page);
        await h.page.waitForTimeout(1200);
        if (state === 'signed-in') {
          await h.page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); } });
          await h.page.waitForTimeout(500);
          await expect(h.page.locator('#gate')).toBeHidden();
        } else await expect(h.page.locator('#gate')).toBeVisible();
        expect(await h.page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme === 'day' ? 'light' : 'dark');
        expect(h.errors, 'page errors').toEqual([]);
        expect(h.consoleErrors, 'console errors').toEqual([]);
        expect(h.mock.external.filter((u) => !/fonts\.(googleapis|gstatic)\.com/.test(u)), 'no unexpected external hosts requested').toEqual([]);
        await clean(h);
      });
    }
  }
}

/* ---------- C2: at most 6 image requests before sign-in ---------- */
test('C2 image requests before sign-in <= 6', async ({ browser }) => {
  const h = await newPage(browser);
  await ready(h.page);
  await h.page.waitForTimeout(2500);
  fs.mkdirSync('out', { recursive: true });
  fs.writeFileSync('out/c2-images.json', JSON.stringify(h.mock.images, null, 1));
  expect(h.mock.images.length, h.mock.images.join(', ')).toBeLessThanOrEqual(6);
  await clean(h);
});

/* ---------- C3: guest pass and tampering reveal no secrets ---------- */
test('C3a guest pass (wrong date path) shows the lock card', async ({ browser }) => {
  const h = await newPage(browser);
  await ready(h.page);
  for (let i = 0; i < 2; i++) {
    await h.page.locator('#gdate').fill(i === 0 ? '2026-01-01' : '2026-01-02');
    if (i === 0) { await h.page.locator('#g-fail1').waitFor({ state: 'visible' }); await h.page.locator('#g-retry').click(); }
  }
  await h.page.locator('#g-guestonly').waitFor({ state: 'visible' });
  await h.page.locator('#g-guest').click();
  await expect(h.page.locator('#gate')).toBeHidden();
  await expect(h.page.locator('#wifilock .locked')).toHaveCount(1);
  await expect(h.page.locator('#locklock .locked')).toHaveCount(1);
  expect(await h.page.content()).not.toContain(WIFI.pass);
  expect(h.mock.callsOf('guide_secrets_v1')).toHaveLength(0);
  await clean(h);
});

test('C3b localStorage tampering (names, verified flag, fake token) reveals no secrets when guide_secrets_v1 answers ok:false', async ({ browser }) => {
  const h = await newPage(browser);
  h.mock.set('guide_secrets_v1', () => ({ json: { ok: false } }));
  // an attacker sets the identity keys and a made-up token; no cached secrets
  await seed(h.context, stay({ ci: CI, co: CO, token: 'forged-token' }));
  await ready(h.page);
  await expect(h.page.locator('#gate')).toBeHidden();
  await expect(h.page.locator('#wifilock .locked')).toHaveCount(1);
  expect(h.mock.callsOf('guide_secrets_v1')[0].body.p_token).toBe('forged-token');
  expect(await h.page.content()).not.toContain(WIFI.pass);
  expect(await ls(h.page, 'ch_v2_token'), 'token dropped on explicit ok:false').toBeNull();
  expect(await ls(h.page, 'cg_secrets')).toBeNull();
  await clean(h);
});

test('C3c tampering with no token at all shows the lock card, no secrets call', async ({ browser }) => {
  const h = await newPage(browser);
  await seed(h.context, stay({ ci: CI, co: CO }));
  await ready(h.page);
  await expect(h.page.locator('#wifilock .locked')).toHaveCount(1);
  expect(h.mock.callsOf('guide_secrets_v1')).toHaveLength(0);
  expect(await h.page.evaluate(() => document.body.innerText)).not.toContain(WIFI.pass);
  await clean(h);
});

/* ---------- C4: verified guest, Wi-Fi from the RPC, client-side SVG QR ---------- */
test('C4 verified guest sees Wi-Fi from the RPC and an SVG QR; source has neither', async ({ browser }) => {
  const h = await newPage(browser);
  await ready(h.page);
  await guestGate(h.page);
  await h.page.locator('#g-success').waitFor({ state: 'visible' });
  await h.page.locator('#g-success-btn').click();
  await expect(h.page.locator('#gate')).toBeHidden();
  await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
  const svg = h.page.locator('#wifilock .qrbox svg');
  await expect(svg).toHaveCount(1);
  expect((await svg.innerHTML()).length, 'QR svg carries real module data').toBeGreaterThan(500);
  expect(await h.page.locator('#wifilock img').count(), 'QR is not an image').toBe(0);
  const call = h.mock.callsOf('guide_session_v1')[0].body;
  expect(call.p_checkin_date).toBe(TODAY);
  expect(call.p_initial).toBe('M');
  expect(call.p_client).toMatch(/^[0-9a-f]{32}$/);
  expect(await ls(h.page, 'cg_dev')).toBe(call.p_client);
  expect(JSON.parse(await ls(h.page, 'ch_v2_token'))).toBe(TOK_GUEST);
  expect(h.mock.callsOf('guide_secrets_v1')[0].body.p_token).toBe(TOK_GUEST);
  const src = fs.readFileSync(new URL('../guide-v9/index.html', import.meta.url), 'utf8');
  expect(src).not.toContain(WIFI.pass);
  expect(src).not.toContain(WIFI.ssid);
  expect(src).not.toMatch(/WIFI:T:WPA;S:[^$`]/);
  expect(src).not.toMatch(/<img[^>]+(qr|data:image\/png)/i);
  const served = await (await fetch(URL_ROOT)).text();
  expect(served).toBe(src);
  await clean(h);
});

/* ---------- C5: expired stay -> farewell page ---------- */
const farewellState = (page) => page.evaluate(() => ({
  fw: !document.querySelector('#farewell-page').hidden,
  book: getComputedStyle(document.querySelector('#book')).display,
  dock: getComputedStyle(document.querySelector('.dock')).display,
}));
test('C5a expired stay shows the farewell page; Verify here returns to the date step', async ({ browser }) => {
  const h = await newPage(browser);
  await seed(h.context, stay({ ci: addDays(TODAY, -6), co: addDays(TODAY, -3), token: TOK_GUEST }));
  await ready(h.page);
  await expect(h.page.locator('#farewell-page')).toBeVisible();
  expect(await farewellState(h.page)).toEqual({ fw: true, book: 'none', dock: 'none' });
  await h.page.locator('#fw-reverify').click();
  await expect(h.page.locator('#g-date')).toBeVisible();
  await expect(h.page.locator('#farewell-page')).toBeHidden();
  expect(await ls(h.page, 'ch_v2_token'), 'token cleared on re-verify').toBeNull();
  await clean(h);
});
test('C5b expiry boundary: open at checkout+1 23:30, farewell at checkout+2 00:30 (Manila)', async ({ browser }) => {
  const co = addDays(TODAY, -1); // expiry = checkout + 1 day 23:59:59 = TODAY 23:59:59
  for (const [at, expectFw] of [[`${TODAY}T23:30:00+08:00`, false], [`${addDays(TODAY, 1)}T00:30:00+08:00`, true]]) {
    const h = await newPage(browser, { at });
    await seed(h.context, stay({ ci: addDays(TODAY, -3), co, token: TOK_GUEST, firstMs: new Date(at).getTime() - 1e7 }));
    await ready(h.page);
    expect((await farewellState(h.page)).fw, at).toBe(expectFw);
    await clean(h);
  }
});
test('C5c expiry is rechecked every 60 s while the page stays open', async ({ browser }) => {
  const at = `${TODAY}T23:58:00+08:00`;
  const h = await newPage(browser, { at });
  await seed(h.context, stay({ ci: addDays(TODAY, -3), co: addDays(TODAY, -1), token: TOK_GUEST, firstMs: new Date(at).getTime() - 1e7 }));
  await ready(h.page);
  expect((await farewellState(h.page)).fw).toBe(false);
  await h.page.clock.fastForward('03:00');
  await expect(h.page.locator('#farewell-page')).toBeVisible();
  await clean(h);
});

/* ---------- C6: theme by time of day ---------- */
const themeOf = (page) => page.evaluate(() => document.documentElement.dataset.theme);
const wxSun = { ...WX, current: { ...WX.current, sunrise: '5:40 AM', sunset: '5:40 PM' } }; // day = 06:10 to 17:10
for (const [mode, cases] of [
  ['auto, weather gives sunrise 5:40 AM / sunset 5:40 PM (day 06:10 to 17:10)', [['06:10', 'light'], ['12:00', 'light'], ['17:00', 'light'], ['17:10', 'dark'], ['21:00', 'dark']], wxSun],
  ['auto, no weather at all: defaults (day 06:30 to 17:00)', [['06:10', 'dark'], ['06:30', 'light'], ['12:00', 'light'], ['17:00', 'dark'], ['21:00', 'dark']], null],
]) {
  test(`C6 ${mode}`, async ({ browser }) => {
    for (const [hhmm, want] of cases) {
      const h = await newPage(browser, { at: `${TODAY}T${hhmm}:00+08:00`, wx: mode.includes('weather gives') });
      if (mode.includes('weather gives')) h.mock.set('weather-proxy', () => ({ json: wxSun }));
      await ready(h.page);
      await h.page.waitForTimeout(400);
      expect(await themeOf(h.page), `${hhmm}`).toBe(want);
      await clean(h);
    }
  });
}
test('C6 forced Day and Night ignore the clock; Auto returns to the clock', async ({ browser }) => {
  const h = await newPage(browser, { at: `${TODAY}T21:00:00+08:00`, wx: false });
  await ready(h.page);
  expect(await themeOf(h.page)).toBe('dark');
  const click = (t) => h.page.evaluate((x) => document.querySelector(`#theme [data-t=${x}]`).click(), t);
  await click('day'); expect(await themeOf(h.page)).toBe('light');
  await click('night'); expect(await themeOf(h.page)).toBe('dark');
  await click('auto'); expect(await themeOf(h.page)).toBe('dark');
  await h.page.clock.fastForward('15:00:00'); // 12:00 next day
  await click('auto'); expect(await themeOf(h.page)).toBe('light');
  await click('night'); expect(await themeOf(h.page)).toBe('dark');
  await clean(h);
});

/* ---------- C7: contrast, both themes. Method: the element is screenshotted with its text made transparent, so the backdrop is the real rendered colour (glass, gradient, photo included); text colour (alpha-composited) is compared with the MEAN backdrop colour of the text box. The worst sampled pixel is logged to out/c7-contrast.txt but is not asserted (photo highlights). ---------- */
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (fg, a, bg) => fg.map((v, i) => Math.round(v * a + bg[i] * (1 - a)));
const SAMPLES = { 'body (card)': '.card p:not(.muted):not(.label)', 'body (poster letter)': '#welcome .letter p:not(.dear)', secondary: '.muted', label: '.label' };
for (const theme of ['day', 'night']) {
  for (const [kind, sel] of Object.entries(SAMPLES)) {
    test(`C7 contrast ${kind} text ${theme} >= 4.5`, async ({ browser }) => {
      const h = await newPage(browser, { width: 390, height: 844 });
      await seed(h.context, { 'cg-theme': theme, ...liveStay() });
      await ready(h.page);
      await h.page.waitForTimeout(800);
      const loc = h.page.locator(sel).filter({ visible: true }).first();
      await loc.scrollIntoViewIfNeeded();
      await h.page.waitForTimeout(500);
      const col = await loc.evaluate((el) => { const m = getComputedStyle(el).color.match(/[\d.]+/g).map(Number); return { rgb: m.slice(0, 3), a: m[3] ?? 1, text: el.textContent.trim().slice(0, 40) }; });
      await h.page.addStyleTag({ content: `${sel}, ${sel} *{color:transparent !important;text-shadow:none !important;-webkit-text-fill-color:transparent !important}` });
      const shot = PNG.sync.read(await loc.screenshot({ animations: 'disabled' }));
      let worst = 99, mean = [0, 0, 0], n = 0;
      for (let y = 0; y < shot.height; y += 2) for (let x = 0; x < shot.width; x += 3) {
        const i = (y * shot.width + x) * 4, bg = [shot.data[i], shot.data[i + 1], shot.data[i + 2]];
        worst = Math.min(worst, ratio(over(col.rgb, col.a, bg), bg)); mean = mean.map((v, k) => v + bg[k]); n++;
      }
      mean = mean.map((v) => Math.round(v / n));
      fs.mkdirSync('out', { recursive: true });
      fs.appendFileSync('out/c7-contrast.txt', `${theme} ${kind} "${col.text}" text=${col.rgb} a=${col.a} meanBg=${mean} worst=${worst.toFixed(2)} mean=${ratio(over(col.rgb, col.a, mean), mean).toFixed(2)}\n`);
      const meanRatio = ratio(over(col.rgb, col.a, mean), mean);
      if (kind === 'body (poster letter)') test.info().annotations.push({ type: 'finding', description: 'light letter text over the poster photo; measured on the approved design, fix needs a visual change' });
      expect(meanRatio, `${theme} ${kind} contrast vs mean backdrop`).toBeGreaterThanOrEqual(4.5);
      await clean(h);
    });
  }
}

/* ---------- C8: farewell photo slot vs the pickFwPhoto table (hand-written expectations) ---------- */
const wxCur = (o) => ({ temp: 30, description: 'Clear', cloud_cover: 20, code: 0, ...o });
const FW = { morning: ['bedroom', 'center 40%'], midday: ['exterior', '62% 70%'], golden: ['lamp', 'center 42%'], night: ['lamp', 'center 42%'], cosy: ['exterior', '62% 70%'] };
// default sun (no sunrise/sunset in cache): rise 06:00, set 17:30; night before 05:30 and from 17:55; golden from 16:00; morning until 10:30
const FW_CASES = [
  ['05:00', 11, wxCur({}), 'night'], ['05:45', 11, wxCur({}), 'morning'], ['10:29', 11, wxCur({}), 'morning'], ['10:30', 11, wxCur({}), 'midday'],
  ['12:00', 11, wxCur({}), 'midday'], ['15:59', 11, wxCur({}), 'midday'], ['16:00', 11, wxCur({}), 'golden'], ['17:54', 11, wxCur({}), 'golden'], ['17:55', 11, wxCur({}), 'night'],
  ['12:00', 11, wxCur({ code: 61, description: 'Rain', cloud_cover: 90 }), 'cosy'], ['08:00', 11, wxCur({ code: 45, description: 'Fog' }), 'cosy'],
  ['04:00', 11, wxCur({ code: 61, description: 'Rain' }), 'night'], ['20:00', 11, wxCur({ code: 61, description: 'Rain' }), 'night'],
  ['14:00', 11, null, 'cosy'], ['11:00', 11, null, 'midday'], ['14:00', 12, null, 'midday'], ['14:00', 5, null, 'midday'], ['09:00', 11, null, 'morning'],
];
for (const [hhmm, month, cur, slot] of FW_CASES) {
  test(`C8 farewell photo ${hhmm} month ${month} ${cur ? cur.description + ' code ' + cur.code : 'no weather'} -> ${slot}`, async ({ browser }) => {
    const day = month === 11 ? '2026-11-25' : month === 12 ? '2026-12-10' : '2026-05-12';
    const at = `${day}T${hhmm}:00+08:00`;
    const h = await newPage(browser, { at, wx: false });
    const t = new Date(at).getTime();
    await seed(h.context, stay({ ci: addDays(day, -8), co: addDays(day, -5), firstMs: t - 1e7, extra: cur ? { cg_wx: JSON.stringify({ t: t - 60000, d: { ...WX, current: cur } }) } : {} }));
    await ready(h.page);
    await expect(h.page.locator('#farewell-page')).toBeVisible();
    expect(await h.page.locator('#farewell-page').getAttribute('data-slot')).toBe(slot);
    const [img, pos] = FW[slot];
    await expect.poll(() => h.page.evaluate(() => { const on = document.querySelector('.fw-ph>img.on'); return on ? on.getAttribute('src') + '|' + on.style.objectPosition : ''; })).toBe(`img/${img}.webp|${pos}`);
    await clean(h);
  });
}

/* ---------- C9: offline at the door ---------- */
for (const [label, fail] of [['network abort', () => 'abort'], ['HTTP 404', () => ({ status: 404, json: null })], ['HTTP 500', () => ({ status: 500, json: null })]]) {
  test(`C9 secrets cached, then every RPC fails (${label}) -> Wi-Fi still shown`, async ({ browser }) => {
    const h = await newPage(browser);
    await ready(h.page);
    await guestGate(h.page);
    await h.page.locator('#g-success-btn').click();
    await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
    expect(await ls(h.page, 'cg_secrets')).toContain(WIFI.pass);
    for (const fn of ['verify_booking', 'guide_session_v1', 'guide_secrets_v1', 'guide_staff_session_v1', 'verify_admin_pin', 'weather-proxy']) h.mock.set(fn, fail);
    await h.page.reload();
    await expect(h.page.locator('#gate')).toBeHidden();
    await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
    await expect(h.page.locator('#wifilock .qrbox svg')).toHaveCount(1);
    await clean(h);
  });
}
test('C9 token kept and cached Wi-Fi kept when secrets RPC hangs (client timeout)', async ({ browser }) => {
  const h = await newPage(browser);
  await seed(h.context, liveStay({ extra: { cg_secrets: JSON.stringify({ wifi_ssid: WIFI.ssid, wifi_password: WIFI.pass, exp: NOW_MS + 864e5 }) } }));
  h.mock.set('guide_secrets_v1', () => 'hang');
  await ready(h.page);
  await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
  await h.page.clock.fastForward('00:20');
  expect(JSON.parse(await ls(h.page, 'ch_v2_token'))).toBe(TOK_GUEST);
  await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
  await clean(h);
});
test('C9 token present, no cache, secrets RPC times out: token kept, no crash', async ({ browser }) => {
  const h = await newPage(browser);
  await seed(h.context, liveStay());
  h.mock.set('guide_secrets_v1', () => 'hang');
  await ready(h.page);
  await h.page.waitForTimeout(300);
  await h.page.clock.fastForward('00:20');
  await h.page.waitForTimeout(300);
  expect(JSON.parse(await ls(h.page, 'ch_v2_token'))).toBe(TOK_GUEST);
  expect(h.errors).toEqual([]);
  await clean(h);
});

/* ---------- C10: backend absent (404) ---------- */
test('C10 guide_session_v1 and guide_secrets_v1 answer 404 -> signed in, lock card, no error shown', async ({ browser }) => {
  const h = await newPage(browser);
  h.mock.set('guide_session_v1', () => ({ status: 404, json: { message: 'not found' } }));
  h.mock.set('guide_secrets_v1', () => ({ status: 404, json: { message: 'not found' } }));
  await ready(h.page);
  await guestGate(h.page);
  await h.page.locator('#g-success').waitFor({ state: 'visible' });
  await h.page.locator('#g-success-btn').click();
  await expect(h.page.locator('#gate')).toBeHidden();
  await expect(h.page.locator('#wifilock .locked')).toHaveCount(1);
  await expect(h.page.locator('#locklock .locked')).toHaveCount(1);
  expect(await ls(h.page, 'ch_v2_token')).toBeNull();
  expect(await ls(h.page, 'ch_v2_verified')).toBe('true');
  const txt = await h.page.evaluate(() => document.body.innerText);
  expect(txt).not.toMatch(/couldn't load|could not reach|something went wrong|error/i);
  expect(h.errors).toEqual([]);
  await clean(h);
});
test('C10b token held but secrets 404 (backend rolled back): cached none -> error card is the only path, signed in stays', async ({ browser }) => {
  const h = await newPage(browser);
  await seed(h.context, liveStay());
  h.mock.set('guide_secrets_v1', () => ({ status: 404, json: null }));
  await ready(h.page);
  await expect(h.page.locator('#gate')).toBeHidden();
  await expect(h.page.locator('#wifilock')).toContainText("couldn't load");
  expect(JSON.parse(await ls(h.page, 'ch_v2_token'))).toBe(TOK_GUEST);
  await clean(h);
});

/* ---------- C11: staff ---------- */
test('C11a staff code: identity picker, token, secrets show', async ({ browser }) => {
  const h = await newPage(browser);
  await ready(h.page);
  await h.page.locator('#g-admin-link').click();
  await h.page.locator('#gpw').fill('4242');
  await h.page.locator('#g-pw-go').click();
  await h.page.locator('#g-admin').waitFor({ state: 'visible' });
  const names = await h.page.locator('#gids [data-aid]').allInnerTexts();
  expect(names).toEqual(['Lloyd', 'Marifel', 'Honey']);
  const b = h.mock.callsOf('guide_staff_session_v1')[0].body;
  expect(b.p_code).toBe('4242');
  expect(b.p_client).toMatch(/^[0-9a-f]{32}$/);
  expect(JSON.parse(await ls(h.page, 'ch_v2_token'))).toBe(TOK_STAFF);
  await h.page.locator('#gids [data-aid="Honey"]').click();
  await expect(h.page.locator('#gate')).toBeHidden();
  await expect(h.page.locator('#wifilock')).toContainText(WIFI.pass);
  expect(h.mock.callsOf('guide_secrets_v1')[0].body.p_token).toBe(TOK_STAFF);
  await clean(h);
});
test('C11b staff: wrong code is refused, throttled message shown', async ({ browser }) => {
  const h = await newPage(browser);
  await ready(h.page);
  await h.page.locator('#g-admin-link').click();
  await h.page.locator('#gpw').fill('0000');
  await h.page.locator('#g-pw-go').click();
  await expect(h.page.locator('#gpwerr')).toContainText("didn't match");
  h.mock.set('guide_staff_session_v1', () => ({ json: { ok: false, throttled: true } }));
  await h.page.locator('#g-pw-go').click();
  await expect(h.page.locator('#gpwerr')).toContainText('Too many attempts');
  await clean(h);
});
test('C11c staff: guide_staff_session_v1 404 falls back to verify_admin_pin, no token, lock card', async ({ browser }) => {
  const h = await newPage(browser);
  h.mock.set('guide_staff_session_v1', () => ({ status: 404, json: null }));
  await ready(h.page);
  await h.page.locator('#g-admin-link').click();
  await h.page.locator('#gpw').fill('4242');
  await h.page.locator('#g-pw-go').click();
  await h.page.locator('#g-admin').waitFor({ state: 'visible' });
  expect(h.mock.callsOf('verify_admin_pin')).toHaveLength(1);
  await h.page.locator('#gids [data-aid="Lloyd"]').click();
  await expect(h.page.locator('#gate')).toBeHidden();
  expect(await ls(h.page, 'ch_v2_token')).toBeNull();
  await expect(h.page.locator('#wifilock .locked')).toHaveCount(1);
  await clean(h);
});
