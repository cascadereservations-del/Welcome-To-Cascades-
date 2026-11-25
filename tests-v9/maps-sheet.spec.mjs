import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { TODAY, TOK_GUEST, addDays, newPage, ready, seed, stay } from './helpers.mjs';

/* Lane M2: the two live map apps open lazily inside the Nearby and Dining sheets. Both map URLs are answered by a local stub (or left hanging), so no test touches the network. */
const NEARBY = 'https://cascadereservations-del.github.io/Nearby-POIS/';
const DINING = 'https://cascadereservations-del.github.io/Cascade-Dining-Map-/';
const OUT = 'out/maps-sheet';
fs.mkdirSync(OUT, { recursive: true });
const clean = async (h) => { await h.context.close(); };
const STUB = `<!doctype html><meta charset="utf-8"><title>stub</title><body style="margin:0;font:600 16px sans-serif"><div id="m" style="height:100vh;display:grid;place-items:center;text-align:center"></div><script>const n=/theme=night/.test(location.search);document.body.style.background=n?'#1d2a33':'#dfe9ee';document.body.style.color=n?'#cfe3ee':'#27414f';m.innerHTML='Stub of the live map app<br><small>test fixture, '+(n?'night':'day')+'</small>'</script>`;

/** Answer both map hosts locally (or never answer) and record every request. Registered after newPage, so it wins over the generic route. */
async function stubMaps(h, { hang = false } = {}) {
  h.reqs = [];
  h.held = [];
  h.release = async () => { for (const r of h.held.splice(0)) await r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: STUB }); };
  await h.context.route('https://cascadereservations-del.github.io/**', async (route) => {
    h.reqs.push(route.request().url());
    if (hang) { h.held.push(route); return; }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: STUB });
  });
}
async function boot(browser, { theme = 'day', hang = false, width = 390, height = 844, onLineFalse = false } = {}) {
  const h = await newPage(browser, { width, height });
  await stubMaps(h, { hang });
  await seed(h.context, { 'cg-theme': theme, ...stay({ ci: TODAY, co: addDays(TODAY, 2), token: TOK_GUEST }) });
  if (onLineFalse) await h.context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false }));
  await ready(h.page);
  await expect(h.page.locator('#gate')).toBeHidden();
  return h;
}
const openSheet = async (page, name) => { await page.evaluate((n) => document.querySelector(`[data-open="${n}"]`).click(), name); await expect(page.locator(`#sh-${name}.on`)).toHaveCount(1); };
const closeSheet = async (page) => { await page.evaluate(() => document.querySelector('.sheet.on [data-close]').click()); await expect(page.locator('.sheet.on')).toHaveCount(0); };
/** Chapter 4 (Cascade Table) in the pager, so the Dining map button can be used as a guest would. */
async function toDining(page) {
  const i = await page.evaluate(() => [...document.querySelectorAll('.ch')].findIndex((c) => c.id === 'table'));
  await page.locator(`#dots .dot[data-ch="${i}"]`).click();
  await page.waitForFunction((k) => { const b = document.querySelector('#book'); return Math.abs(b.scrollLeft - k * b.clientWidth) < 2; }, i);
  await page.locator('.dmapbar .btn').scrollIntoViewIfNeeded();
}
const loaded = (page, id) => expect(page.locator(`#${id} .mstat`)).toBeHidden();

test('M2a no request to either map app before a sheet is opened, and no iframe in the page', async ({ browser }) => {
  const h = await boot(browser);
  await h.page.waitForLoadState('networkidle');
  await h.page.waitForTimeout(800);
  expect(h.reqs, 'no map request at page load').toEqual([]);
  expect(await h.page.locator('iframe').count(), 'no iframe exists before a tap').toBe(0);
  await toDining(h.page);
  expect(h.reqs, 'visiting the dining chapter requests nothing either').toEqual([]);
  await clean(h);
});

for (const theme of ['day', 'night']) {
  test(`M2b online, ${theme}: opening Nearby loads exactly one iframe with embed=1 and theme=${theme === 'day' ? 'day' : 'night'}; reopen does not reload`, async ({ browser }) => {
    const h = await boot(browser, { theme });
    await openSheet(h.page, 'nearby');
    await expect(h.page.locator('#nt-live')).toHaveAttribute('aria-selected', 'true');
    await expect(h.page.locator('#np-live iframe')).toHaveCount(1);
    await expect.poll(() => h.reqs.length).toBe(1);
    expect(h.reqs[0]).toBe(`${NEARBY}?embed=1&fit=1&theme=${theme === 'day' ? 'day' : 'night'}`);
    const f = h.page.locator('#np-live iframe');
    await expect(f).toHaveAttribute('title', 'Live map of nearby places');
    expect(await f.getAttribute('loading'), 'no lazy loading: the frame is created on open and must load while the sheet is shown').toBeNull();
    await expect(f).toHaveAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms');
    expect(await f.getAttribute('sandbox')).not.toMatch(/allow-same-origin|allow-top-navigation/);
    await expect(f).toHaveAttribute('allow', 'clipboard-write');
    await expect(f).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    expect(await f.getAttribute('allow'), 'no geolocation permission is delegated').not.toMatch(/geolocation/);
    await loaded(h.page, 'np-live');
    await h.page.waitForTimeout(500);
    await h.page.screenshot({ path: `${OUT}/nearby-live-${theme}-390x844.png`, animations: 'disabled' });
    await closeSheet(h.page);
    await openSheet(h.page, 'nearby');
    await expect(h.page.locator('#np-live iframe')).toHaveCount(1);
    await h.page.waitForTimeout(400);
    expect(h.reqs, 'closing and reopening keeps the iframe, no second request').toHaveLength(1);
    await clean(h);
  });
}

test('M2c Offline map tab shows today\'s drawn map, chips and list and never requests the iframe; online switching does not reload it', async ({ browser }) => {
  const h = await boot(browser, { onLineFalse: true }); // the browser reports offline, the local server still answers
  await openSheet(h.page, 'nearby');
  await expect(h.page.locator('#nt-off')).toHaveAttribute('aria-selected', 'true');
  await h.page.locator('#nt-off').click();
  await expect(h.page.locator('#np-off')).toBeVisible();
  await expect(h.page.locator('#np-live')).toBeHidden();
  await expect(h.page.locator('#pmap .pin').first()).toBeVisible();
  expect(await h.page.locator('#pmap .pin').count()).toBeGreaterThan(5);
  await expect(h.page.locator('#pfilter button').first()).toBeVisible();
  expect(await h.page.locator('#plist > *').count(), 'the list is there').toBeGreaterThan(0);
  await h.page.screenshot({ path: `${OUT}/nearby-offline-day-390x844.png`, animations: 'disabled' });
  await h.page.waitForTimeout(500);
  expect(h.reqs, 'Offline map never touches the live map app').toEqual([]);
  expect(await h.page.locator('iframe').count()).toBe(0);
  await clean(h);

  const o = await boot(browser); // online: the default is Live, so one request; switching tabs back and forth adds none
  await openSheet(o.page, 'nearby');
  await expect.poll(() => o.reqs.length).toBe(1);
  await loaded(o.page, 'np-live');
  await o.page.locator('#nt-off').click();
  await expect(o.page.locator('#pmap .pin').first()).toBeVisible();
  await o.page.locator('#nt-live').click();
  await expect(o.page.locator('#np-live iframe')).toHaveCount(1);
  await o.page.locator('#nt-off').click();
  await o.page.waitForTimeout(400);
  expect(o.reqs).toHaveLength(1);
  await clean(o);
});

test('M2d context offline: Offline map is the default, nothing is requested, and choosing Live shows the connection message with a way back', async ({ browser }) => {
  const h = await boot(browser);
  await h.context.setOffline(true);
  await expect.poll(() => h.page.evaluate(() => navigator.onLine)).toBe(false);
  await openSheet(h.page, 'nearby');
  await expect(h.page.locator('#nt-off')).toHaveAttribute('aria-selected', 'true');
  await expect(h.page.locator('#nt-live')).toHaveAttribute('aria-selected', 'false');
  await expect(h.page.locator('#pmap .pin').first()).toBeVisible();
  await h.page.locator('#nt-live').click();
  await expect(h.page.locator('#np-live .mstat')).toContainText('The live map needs a connection.');
  await h.page.screenshot({ path: `${OUT}/nearby-connection-message-390x844.png`, animations: 'disabled' });
  await h.page.getByRole('button', { name: 'Show offline map' }).click();
  await expect(h.page.locator('#nt-off')).toHaveAttribute('aria-selected', 'true');
  await expect(h.page.locator('#np-off')).toBeVisible();
  expect(h.reqs, 'nothing was requested while offline').toEqual([]);
  expect(await h.page.locator('iframe').count()).toBe(0);
  await clean(h);
});

test('M2e Dining map button opens #sh-dmap and requests the dining app once; reopen does not request again', async ({ browser }) => {
  const h = await boot(browser);
  await toDining(h.page);
  const btn = h.page.locator('.dmapbar .btn');
  await expect(btn).toContainText('Dining map');
  expect(await btn.locator('svg').count(), 'it carries a line icon from the set').toBe(1);
  expect(h.reqs).toEqual([]);
  await btn.click();
  await expect(h.page.locator('#sh-dmap.on')).toHaveCount(1);
  await expect(h.page.locator('#sh-dmap h2')).toHaveText('Dining map');
  await expect.poll(() => h.reqs.length).toBe(1);
  expect(h.reqs[0]).toBe(`${DINING}?embed=1&fit=1&theme=day`);
  await expect(h.page.locator('#dp-live iframe')).toHaveAttribute('title', 'Live map of dining places');
  await loaded(h.page, 'dp-live');
  await h.page.waitForTimeout(500);
  await h.page.screenshot({ path: `${OUT}/dining-sheet-day-390x844.png`, animations: 'disabled' });
  await h.page.locator('#sh-dmap .x').click();
  await expect(h.page.locator('.sheet.on')).toHaveCount(0);
  await btn.click();
  await expect(h.page.locator('#sh-dmap.on')).toHaveCount(1);
  await h.page.waitForTimeout(400);
  expect(h.reqs, 'reopen keeps the iframe').toHaveLength(1);
  expect(await h.page.locator('#dp-live iframe').count()).toBe(1);
  expect(h.reqs.some((u) => u.startsWith(NEARBY)), 'the nearby app was never requested').toBe(false);
  await clean(h);
});

test('M2f an app that never loads: the quiet loading line, then after 12 s the connection message and a way out (Offline map / Close)', async ({ browser }) => {
  const h = await boot(browser, { hang: true });
  await openSheet(h.page, 'nearby');
  await expect(h.page.locator('#np-live .mstat')).toContainText('Loading the live map…');
  await h.page.clock.runFor(11000);
  await expect(h.page.locator('#np-live .mstat')).toContainText('Loading the live map…');
  await h.page.clock.runFor(1500);
  await expect(h.page.locator('#np-live .mstat')).toContainText('The live map needs a connection.');
  expect(h.reqs, 'one request was made and left hanging').toHaveLength(1);
  await h.page.getByRole('button', { name: 'Show offline map' }).click();
  await expect(h.page.locator('#nt-off')).toHaveAttribute('aria-selected', 'true');
  await expect(h.page.locator('#pmap .pin').first()).toBeVisible();
  await closeSheet(h.page);
  await toDining(h.page);
  await h.page.locator('.dmapbar .btn').click();
  await expect(h.page.locator('#dp-live .mstat')).toContainText('Loading the live map…');
  await h.page.clock.runFor(12500);
  await expect(h.page.locator('#dp-live .mstat')).toContainText('The live map needs a connection.');
  await expect(h.page.getByRole('button', { name: 'Show offline map' })).toBeHidden();
  await h.page.locator('#dp-live .mstat').getByRole('button', { name: 'Close' }).click();
  await expect(h.page.locator('.sheet.on')).toHaveCount(0);
  await clean(h);
});

test('M2i after the 12 s timeout the frame is kept under the connection message; a late load clears the message; the offline event removes the frame', async ({ browser }) => {
  const h = await boot(browser, { hang: true });
  await openSheet(h.page, 'nearby');
  await expect.poll(() => h.reqs.length).toBe(1);
  await h.page.clock.runFor(12500);
  await expect(h.page.locator('#np-live .mstat')).toContainText('The live map needs a connection.');
  await expect(h.page.locator('#np-live iframe'), 'the load in progress is not deleted').toHaveCount(1);
  await closeSheet(h.page);
  await openSheet(h.page, 'nearby');
  await expect(h.page.locator('#np-live iframe')).toHaveCount(1);
  expect(h.reqs, 'reopening while slow does not start a second request').toHaveLength(1);
  await h.release();
  await loaded(h.page, 'np-live'); // the late load hides the message
  await expect(h.page.locator('#np-live iframe')).toHaveCount(1);
  await clean(h);

  const o = await boot(browser, { hang: true });
  await openSheet(o.page, 'nearby');
  await o.page.clock.runFor(12500);
  await expect(o.page.locator('#np-live iframe')).toHaveCount(1);
  await o.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(o.page.locator('#np-live iframe'), 'the browser offline event removes the frame').toHaveCount(0);
  await expect(o.page.locator('#np-live .mstat')).toContainText('The live map needs a connection.');
  await clean(o);
});

test('M2j tab memory: offline at first open does not stick once the connection returns; a tab picked by hand does', async ({ browser }) => {
  const h = await boot(browser);
  await h.context.setOffline(true);
  await expect.poll(() => h.page.evaluate(() => navigator.onLine)).toBe(false);
  await openSheet(h.page, 'nearby');
  await expect(h.page.locator('#nt-off')).toHaveAttribute('aria-selected', 'true');
  await closeSheet(h.page);
  await h.context.setOffline(false);
  await expect.poll(() => h.page.evaluate(() => navigator.onLine)).toBe(true);
  await openSheet(h.page, 'nearby');
  await expect(h.page.locator('#nt-live')).toHaveAttribute('aria-selected', 'true');
  await expect(h.page.locator('#np-live iframe')).toHaveCount(1);
  await h.page.locator('#nt-off').click(); // chosen by hand: it is remembered
  await closeSheet(h.page);
  await openSheet(h.page, 'nearby');
  await expect(h.page.locator('#nt-off')).toHaveAttribute('aria-selected', 'true');
  await clean(h);
});

test('M2k a theme change after a map loaded: the hidden frame is not reloaded, the next open loads it with the new theme', async ({ browser }) => {
  const h = await boot(browser, { theme: 'day' });
  await openSheet(h.page, 'nearby');
  await loaded(h.page, 'np-live');
  await closeSheet(h.page);
  await h.page.evaluate(() => document.querySelector('#theme [data-t="night"]').click());
  await expect(h.page.locator('html')).not.toHaveAttribute('data-day', /.*/);
  await h.page.waitForTimeout(400);
  expect(h.reqs, 'a hidden sheet is not reloaded at once').toHaveLength(1);
  await openSheet(h.page, 'nearby');
  await expect.poll(() => h.reqs.length).toBe(2);
  expect(h.reqs[1]).toBe(`${NEARBY}?embed=1&fit=1&theme=night`);
  await expect(h.page.locator('#np-live iframe')).toHaveCount(1);
  await expect(h.page.locator('#np-live iframe')).toHaveAttribute('src', `${NEARBY}?embed=1&fit=1&theme=night`);
  await loaded(h.page, 'np-live');
  await clean(h);
});

test('M2g switch and buttons are at least 44 px and keyboard operable; the sheet holds focus and returns it', async ({ browser }) => {
  const h = await boot(browser);
  const box = async (sel) => (await h.page.locator(sel).boundingBox());
  const ob = h.page.locator('[data-open="nearby"]').filter({ visible: true }).first();
  await ob.focus();
  await h.page.keyboard.press('Enter');
  await expect(h.page.locator('#sh-nearby.on')).toHaveCount(1);
  await expect(h.page.locator('#sh-nearby .x')).toBeFocused();
  for (const s of ['#nt-live', '#nt-off']) { const b = await box(s); expect(b.height, s + ' height').toBeGreaterThanOrEqual(44); expect(b.width, s + ' width').toBeGreaterThanOrEqual(44); }
  expect(await h.page.locator('.mseg').getAttribute('role')).toBe('tablist');
  await h.page.keyboard.press('Tab');
  await expect(h.page.locator('#nt-live')).toBeFocused();
  await h.page.keyboard.press('ArrowRight');
  await expect(h.page.locator('#nt-off')).toBeFocused();
  await expect(h.page.locator('#nt-off')).toHaveAttribute('aria-selected', 'true');
  await expect(h.page.locator('#np-off')).toBeVisible();
  await h.page.keyboard.press('ArrowLeft');
  await expect(h.page.locator('#nt-live')).toBeFocused();
  await expect(h.page.locator('#nt-live')).toHaveAttribute('aria-selected', 'true');
  await h.page.keyboard.press('End');
  await expect(h.page.locator('#nt-off')).toHaveAttribute('aria-selected', 'true');
  await h.page.keyboard.press('Home');
  await expect(h.page.locator('#nt-live')).toHaveAttribute('aria-selected', 'true');
  for (let i = 0; i < 1; i++) { // the next stop after the switch is the frame inside the sheet, never the page behind (inert)
    await h.page.keyboard.press('Tab');
    expect(await h.page.evaluate(() => !!document.activeElement.closest('#sh-nearby')), 'focus stays inside the sheet, press ' + i).toBe(true);
  }
  await h.page.keyboard.press('Shift+Tab'); // back out of the frame (keys inside it belong to the map app)
  await expect(h.page.locator('#nt-live')).toBeFocused();
  await h.page.keyboard.press('Escape');
  await expect(h.page.locator('.sheet.on')).toHaveCount(0);
  await expect(ob, 'focus returns to the opener').toBeFocused();
  // the dining side
  await toDining(h.page);
  const db = await box('.dmapbar .btn');
  expect(db.height).toBeGreaterThanOrEqual(44);
  expect(db.width).toBeGreaterThanOrEqual(44);
  const dbtn = h.page.locator('.dmapbar .btn');
  await dbtn.focus();
  await h.page.keyboard.press('Enter');
  await expect(h.page.locator('#sh-dmap.on')).toHaveCount(1);
  await expect(h.page.locator('#sh-dmap .x')).toBeFocused();
  await h.page.keyboard.press('Escape');
  await expect(dbtn).toBeFocused();
  await clean(h);
});

test('M2h no horizontal overflow at 360x640 (both sheets, both tabs) and the live frame fills the sheet; desktop shot at 1280x800', async ({ browser }) => {
  const h = await boot(browser, { width: 360, height: 640 });
  const fit = async (id) => h.page.evaluate((sid) => {
    const s = document.querySelector(sid), r = s.getBoundingClientRect(), f = s.querySelector('iframe'), fr = f && f.getBoundingClientRect();
    return { page: document.documentElement.scrollWidth <= 360, sheetW: s.scrollWidth <= s.clientWidth, sheetH: s.scrollHeight <= s.clientHeight + 1, frame: f ? fr.width > 250 && fr.height > 200 && fr.left >= r.left - 1 && fr.right <= r.right + 1 && fr.bottom <= r.bottom : null, h: Math.round(r.height) };
  }, id);
  await openSheet(h.page, 'nearby');
  await expect(h.page.locator('#np-live iframe')).toHaveCount(1);
  await loaded(h.page, 'np-live');
  expect(await fit('#sh-nearby'), 'nearby live').toMatchObject({ page: true, sheetW: true, sheetH: true, frame: true });
  await h.page.locator('#nt-off').click();
  const off = await fit('#sh-nearby');
  expect(off.page && off.sheetW, 'nearby offline: no horizontal overflow').toBe(true);
  await closeSheet(h.page);
  await toDining(h.page);
  await h.page.locator('.dmapbar .btn').click();
  await expect(h.page.locator('#dp-live iframe')).toHaveCount(1);
  await loaded(h.page, 'dp-live');
  expect(await fit('#sh-dmap'), 'dining').toMatchObject({ page: true, sheetW: true, sheetH: true, frame: true });
  await clean(h);

  const d = await boot(browser, { width: 1280, height: 800 });
  await openSheet(d.page, 'nearby');
  await expect(d.page.locator('#np-live iframe')).toHaveCount(1);
  await loaded(d.page, 'np-live');
  await d.page.waitForTimeout(500);
  await d.page.screenshot({ path: `${OUT}/nearby-live-day-1280x800.png`, animations: 'disabled' });
  expect(await d.page.evaluate(() => document.documentElement.scrollWidth <= 1280)).toBe(true);
  await clean(d);
});

test('M2l the map app reports its height: the frame fits it and the sheet becomes the only scroller; a bad or foreign message is ignored', async ({ browser }) => {
  const h = await boot(browser);
  const FIT = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:1234px"><script>if(/[?&]fit=1/.test(location.search))parent.postMessage({type:'CASCADE_MAP_HEIGHT',h:1234},'*')</script>`;
  await h.context.route(NEARBY + '**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIT }));
  await openSheet(h.page, 'nearby');
  expect(await h.page.locator('#np-live iframe').getAttribute('src')).toMatch(/[?&]fit=1(&|$)/);
  await expect(h.page.locator('#np-live')).toHaveClass(/fit/);
  const m = await h.page.evaluate(() => { const p = document.querySelector('#np-live'), s = document.querySelector('#sh-nearby'); return { h: p.offsetHeight, scroll: s.scrollHeight > s.clientHeight + 200, oy: getComputedStyle(s).overflowY }; });
  expect(m.h, 'pane takes the reported height').toBe(1234);
  expect(m.scroll, 'the sheet itself scrolls').toBe(true);
  expect(m.oy).toBe('auto');
  await h.page.evaluate(() => { window.postMessage({ type: 'CASCADE_MAP_HEIGHT', h: 3000 }, '*'); const f = document.querySelector('#np-live iframe'); f.contentWindow.postMessage('x', '*'); });
  await h.page.waitForTimeout(200);
  expect(await h.page.evaluate(() => document.querySelector('#np-live').offsetHeight), 'a message from another window changes nothing').toBe(1234);
  await clean(h);
});

test('M2m the Restaurants nearby tile opens the Dining map sheet, not a Google link', async ({ browser }) => {
  const h = await boot(browser);
  const tile = h.page.locator('.go4 .g4', { hasText: 'Restaurants nearby' });
  expect(await tile.evaluate((e) => e.tagName + ':' + e.dataset.open)).toBe('BUTTON:dmap');
  await tile.scrollIntoViewIfNeeded();
  await tile.click();
  await expect(h.page.locator('#sh-dmap.on')).toHaveCount(1);
  await expect(h.page.locator('#dp-live iframe')).toHaveCount(1);
  expect(await h.page.locator('.go4 a[href*="maps/search/restaurants"]').count()).toBe(0);
  await clean(h);
});

test('M2n a height report counts as loaded: the loading cover goes away even while the frame load event is still pending', async ({ browser }) => {
  const h = await boot(browser);
  const SLOW = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:900px"><img src="${NEARBY}hang.png"><script>parent.postMessage({type:'CASCADE_MAP_HEIGHT',h:900},'*')</script>`;
  await h.context.route(NEARBY + '**', (route) => { if (/hang\.png/.test(route.request().url())) return; return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SLOW }); });
  await openSheet(h.page, 'nearby');
  await expect(h.page.locator('#np-live')).toHaveClass(/fit/);
  await expect(h.page.locator('#np-live .mstat')).toBeHidden();
  await clean(h);
});
