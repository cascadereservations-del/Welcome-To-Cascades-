import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PORT = 4391;
export const URL_ROOT = `http://127.0.0.1:${PORT}/index.html`;
export const WX = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'weather.json'), 'utf8'));
export const NOW_ISO = '2026-11-25T12:00:00+08:00'; // a fixed Manila noon
export const NOW_MS = new Date(NOW_ISO).getTime();
export const TODAY = '2026-11-25';
export const addDays = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
// invented test values only
export const WIFI = { ssid: 'TestNet-5G', pass: 'Zx9-mock-PW-4471' };
export const TOK_GUEST = 'tok-guest-1';
export const TOK_STAFF = 'tok-staff-1';

const json = (j, status = 200) => ({ status, json: j });
export function defaults() {
  return {
    verify_booking: (b) => {
      if (b.p_checkin_date === addDays(TODAY, -5)) return json({ found: true, expired: true, checkout_date: addDays(TODAY, -3), checkin_date: b.p_checkin_date });
      if (b.p_checkin_date !== TODAY) return json({ found: false });
      if (b.p_initial == null) return json({ found: true });
      if (String(b.p_initial).toUpperCase() !== 'M') return json({ found: true, match: false });
      return json({ found: true, match: true, first_name: 'Maria', full_name: 'Maria Santos', checkin_date: TODAY, checkout_date: addDays(TODAY, 2), nights: 2, checkout_time: '12:00' });
    },
    guide_session_v1: (b) => json({ ok: true, token: TOK_GUEST, thread_id: 't1', channel: 'airbnb', guest_label: 'Maria', checkin_date: b.p_checkin_date, checkout_date: addDays(TODAY, 2) }),
    guide_secrets_v1: (b) => (b.p_token === TOK_GUEST || b.p_token === TOK_STAFF)
      ? json({ ok: true, kind: b.p_token === TOK_STAFF ? 'staff' : 'guest', wifi_ssid: WIFI.ssid, wifi_password: WIFI.pass, onground_name: 'Honey', onground_phone: '+639170000000' })
      : json({ ok: false }),
    guide_staff_session_v1: (b) => (b.p_code === '4242' ? json({ ok: true, users: ['Lloyd', 'Marifel', 'Honey', 'Others'], token: TOK_STAFF }) : json({ ok: false })),
    verify_admin_pin: (b) => (b.p_code === '4242' ? json({ ok: true, users: ['Lloyd', 'Marifel', 'Honey', 'Others'] }) : json({ ok: false })),
    'weather-proxy': () => json(WX),
  };
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS' };

/** Route everything. The local origin passes; Supabase is mocked per function; every other host is answered empty. Nothing leaves the machine. */
export async function installMocks(context) {
  const mock = { h: defaults(), calls: [], external: [], images: [] };
  mock.set = (fn, handler) => { mock.h[fn] = handler; };
  mock.callsOf = (fn) => mock.calls.filter((c) => c.fn === fn);
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === '127.0.0.1' && Number(url.port) === PORT) {
      if (req.resourceType() === 'image') mock.images.push(url.pathname);
      return route.continue();
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const isSb = url.hostname.endsWith('.supabase.co');
    let fn = null;
    if (isSb) {
      if (url.pathname.startsWith('/rest/v1/rpc/') || url.pathname.startsWith('/functions/v1/')) fn = url.pathname.split('/').pop();
    } else mock.external.push(url.href);
    if (!fn) return route.fulfill({ status: isSb ? 404 : 200, headers: { ...CORS, 'content-type': url.hostname === 'fonts.googleapis.com' ? 'text/css' : 'text/plain' }, body: '' });
    let body = null;
    try { body = req.postDataJSON(); } catch { /* no body */ }
    mock.calls.push({ fn, body });
    const handler = mock.h[fn];
    if (!handler) return route.fulfill({ status: 404, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"message":"not found"}' });
    const r = await handler(body || {}, mock);
    if (r === 'abort') return route.abort('failed');
    if (r === 'hang') return; // never answered: the client timeout has to cope
    return route.fulfill({ status: r.status || 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(r.json ?? null) });
  });
  return mock;
}

/** Seed localStorage once per tab (survives reloads, so the app's own writes are kept). */
export async function seed(context, entries) {
  await context.addInitScript((e) => {
    try { if (sessionStorage.getItem('__seeded')) return; sessionStorage.setItem('__seeded', '1'); } catch { return; }
    for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v);
  }, entries);
}

export const stay = ({ name = 'Maria', ci, co, token, firstMs, extra = {} }) => ({
  ch_v2_guestName: JSON.stringify(name),
  ch_v2_checkinDate: JSON.stringify(ci),
  ch_v2_checkoutDate: JSON.stringify(co),
  ch_v2_verified: 'true',
  ch_v2_firstSeenMs: String(firstMs ?? NOW_MS - 1e7),
  ...(token ? { ch_v2_token: JSON.stringify(token) } : {}),
  ...extra,
});

/** A page in Manila time with a fixed starting clock (time still flows). */
export async function newPage(browser, { at = NOW_ISO, width = 390, height = 844, colorScheme = 'light', wx = true } = {}) {
  const context = await browser.newContext({ timezoneId: 'Asia/Manila', locale: 'en-US', viewport: { width, height }, colorScheme });
  const mock = await installMocks(context);
  if (!wx) mock.set('weather-proxy', () => 'abort');
  const page = await context.newPage();
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  if (at) await page.clock.install({ time: new Date(at) });
  return { context, page, mock, errors, consoleErrors };
}

export const ready = async (page) => {
  await page.goto(URL_ROOT, { waitUntil: 'load' });
  await page.waitForFunction(() => !!document.querySelector('#gate') && document.readyState === 'complete');
};
export const ls = (page, k) => page.evaluate((key) => localStorage.getItem(key), k);

/** Drive the real guest gate: date, initial, open. */
export async function guestGate(page, { date = TODAY, initial = 'M' } = {}) {
  await page.locator('#gdate').fill(date);
  await page.locator('#g-initial').waitFor({ state: 'visible' });
  await page.locator('#ginit').fill(initial);
  await page.locator('#g-open').click();
}
