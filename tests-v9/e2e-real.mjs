// End-to-end run of the release candidate against the REAL Supabase project (no mocks).
// Usage: node e2e-real.mjs   (serve.mjs must be running on 4391)
// Cases come from env so no booking detail is committed: E2E_NOW=date:initial E2E_SOON=date:initial
// E2E_EARLY=date:initial E2E_EXPIRED=date E2E_NODATE=date
// Secrets are never printed and are masked in every screenshot.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out', 'e2e-real');
fs.mkdirSync(out, { recursive: true });
const URL_ROOT = 'http://127.0.0.1:4391/Welcome-To-Cascades-/index.html?sw=1'; // the Pages path, with the real service worker
const pair = (v) => { const [date, initial] = String(v || '').split(':'); return { date, initial }; };
const C = { now: pair(process.env.E2E_NOW), soon: pair(process.env.E2E_SOON), early: pair(process.env.E2E_EARLY), expired: process.env.E2E_EXPIRED, nodate: process.env.E2E_NODATE };
const SECRET_KEYS = /password|phone|token|code|name|label/i;
const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail || ''}`); };

async function open(browser) {
  const context = await browser.newContext({ timezoneId: 'Asia/Manila', locale: 'en-US', viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const calls = [], errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('response', async (r) => {
    const u = new URL(r.url());
    if (!u.hostname.endsWith('.supabase.co')) return;
    const fn = u.pathname.split('/').pop();
    let shape = '';
    try {
      const j = await r.json();
      if (j && typeof j === 'object' && !Array.isArray(j)) shape = Object.entries(j).map(([k, v]) => (SECRET_KEYS.test(k) ? `${k}=<${v == null ? 'null' : 'set'}>` : `${k}=${typeof v === 'object' ? '{..}' : v}`)).join(' ');
      else shape = Array.isArray(j) ? `array(${j.length})` : String(j);
    } catch { shape = '(no json)'; }
    calls.push({ fn, status: r.status(), shape });
  });
  await page.goto(URL_ROOT, { waitUntil: 'load' });
  await page.waitForFunction(() => !!document.querySelector('#gate') && document.readyState === 'complete');
  return { context, page, calls, errors };
}
const mask = (page) => [page.locator('#wifilock'), page.locator('#locklock')];
const shot = (page, name) => page.screenshot({ path: path.join(out, name + '.png'), mask: mask(page), maskColor: '#444' });
const visibleStep = (page) => page.evaluate(() => [...document.querySelectorAll('#gate .gstep')].filter((e) => !e.hidden).map((e) => e.id).join(','));
const gateHidden = (page) => page.evaluate(() => document.querySelector('#gate').hidden);
const wifiState = (page) => page.evaluate(() => { const e = document.querySelector('#wifilock'); if (!e) return 'absent'; const t = e.textContent.trim(); return `len=${t.length} retry=${!!document.querySelector('#secretry')}`; });
const lsHas = (page, k) => page.evaluate((key) => localStorage.getItem(key) != null, k);
const fmt = (calls) => calls.map((c) => `${c.fn}[${c.status}] ${c.shape}`).join(' | ');

async function gate(page, { date, initial }) {
  await page.locator('#gdate').fill(date);
  await page.waitForFunction(() => { const s = [...document.querySelectorAll('#gate .gstep')].filter((e) => !e.hidden).map((e) => e.id); return s.length && !s.includes('g-checking') && !s.includes('g-date'); }, null, { timeout: 20000 }).catch(() => {});
  if (initial && await page.locator('#g-initial').isVisible()) {
    await page.locator('#ginit').fill(initial);
    await page.locator('#g-open').click();
    await page.waitForFunction(() => { const s = [...document.querySelectorAll('#gate .gstep')].filter((e) => !e.hidden).map((e) => e.id); return s.length && !s.includes('g-checking') && !s.includes('g-initial'); }, null, { timeout: 20000 }).catch(() => {});
  }
}

const browser = await chromium.launch();
try {
  // 1 real booking, in house now
  if (C.now.date) {
    const h = await open(browser);
    await gate(h.page, C.now);
    const step = await visibleStep(h.page);
    await shot(h.page, '1-now-gate-success');
    if (step.includes('g-success')) await h.page.locator('#g-success-btn').click();
    await h.page.waitForFunction(() => document.querySelector('#gate').hidden, null, { timeout: 10000 }).catch(() => {});
    await h.page.waitForFunction(() => localStorage.getItem('cg_secrets') != null, null, { timeout: 15000 }).catch(() => {});
    const tok = await lsHas(h.page, 'ch_v2_token'), sec = await lsHas(h.page, 'cg_secrets');
    await shot(h.page, '1-now-home');
    rec('1 real booking (in house): gate, token, secrets', step.includes('g-success') && (await gateHidden(h.page)) && tok && sec && !h.errors.length, `step=${step} token=${tok} secrets=${sec} wifi:${await wifiState(h.page)} errors=${h.errors.length} :: ${fmt(h.calls)}`);

    // 5 offline at the door: reload with no network
    await h.page.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active && r.active.state === 'activated'); }, null, { timeout: 20000 }).catch(() => {});
    await h.page.reload({ waitUntil: 'load' }); // now controlled by the worker
    await h.page.waitForTimeout(2500);
    const swReady = await h.page.evaluate(() => (navigator.serviceWorker.controller ? 'controlling' : 'not controlling'));
    await h.context.setOffline(true);
    let loaded = true;
    await h.page.reload({ waitUntil: 'load', timeout: 15000 }).catch(() => { loaded = false; });
    const has = loaded && await h.page.evaluate(() => !!document.querySelector('#gate'));
    const off = has ? { gate: await gateHidden(h.page), sec: await lsHas(h.page, 'cg_secrets'), wifi: await wifiState(h.page) } : {};
    if (has) await shot(h.page, '5-offline-reload');
    rec('5 offline reload keeps the guide and the cached secrets', !!has && off.gate && off.sec, `sw=${swReady} loaded=${loaded} gateHidden=${off.gate} secrets=${off.sec} wifi:${off.wifi}`);
    await h.context.setOffline(false);
    await h.context.close();
  }
  // 1b real booking 1 to 3 days ahead
  if (C.soon.date) {
    const h = await open(browser);
    await gate(h.page, C.soon);
    const step = await visibleStep(h.page);
    if (step.includes('g-success')) await h.page.locator('#g-success-btn').click();
    await h.page.waitForTimeout(4000);
    await shot(h.page, '1b-soon-home');
    const m = h.calls.find((c) => c.fn === 'guide_session_v1');
    rec('1b real booking within 3 days: token minted', step.includes('g-success') && !!m && /ok=true/.test(m.shape), `step=${step} wifi:${await wifiState(h.page)} :: ${fmt(h.calls)}`);
    await h.context.close();
  }
  // 1c real booking more than 3 days ahead: guide opens, secrets wait
  if (C.early.date) {
    const h = await open(browser);
    await gate(h.page, C.early);
    const step = await visibleStep(h.page);
    if (step.includes('g-success')) await h.page.locator('#g-success-btn').click();
    await h.page.waitForTimeout(4000);
    await shot(h.page, '1c-early-home');
    const m = h.calls.find((c) => c.fn === 'guide_session_v1');
    const sec = await lsHas(h.page, 'cg_secrets');
    rec('1c real booking over 3 days ahead: no token yet, no secrets', step.includes('g-success') && !!m && /too_early/.test(m.shape) && !sec, `step=${step} secrets=${sec} wifi:${await wifiState(h.page)} :: ${fmt(h.calls)}`);
    await h.context.close();
  }
  // 2 wrong date
  if (C.nodate) {
    const h = await open(browser);
    await gate(h.page, { date: C.nodate });
    const step = await visibleStep(h.page);
    await shot(h.page, '2-wrong-date');
    rec('2 wrong date: refused, no session call', /g-fail1|g-guestonly/.test(step) && !h.calls.some((c) => c.fn === 'guide_session_v1'), `step=${step} :: ${fmt(h.calls)}`);
    await h.context.close();
  }
  // 2b right date, wrong initial
  if (C.now.date) {
    const h = await open(browser);
    await gate(h.page, { date: C.now.date, initial: 'Q' });
    const step = await visibleStep(h.page);
    await shot(h.page, '2b-wrong-initial');
    rec('2b wrong initial: refused, no name leaked, no session call', /g-fail1|g-guestonly/.test(step) && !h.calls.some((c) => c.fn === 'guide_session_v1') && !h.calls.some((c) => /first_name=<set>/.test(c.shape)), `step=${step} :: ${fmt(h.calls)}`);
    await h.context.close();
  }
  // 3 expired booking
  if (C.expired) {
    const h = await open(browser);
    await gate(h.page, { date: C.expired });
    await h.page.waitForFunction(() => !document.querySelector('#farewell-page').hidden, null, { timeout: 15000 }).catch(() => {});
    const step = (await h.page.evaluate(() => !document.querySelector('#farewell-page').hidden)) ? 'farewell-page' : await visibleStep(h.page);
    await shot(h.page, '3-expired');
    rec('3 expired booking: farewell step, no name, no session call', step === 'farewell-page' && !h.calls.some((c) => c.fn === 'guide_session_v1') && !h.calls.some((c) => /name=<set>/.test(c.shape)), `step=${step} :: ${fmt(h.calls)}`);
    await h.context.close();
  }
  // 4 staff: one wrong code through the real form (the right code is never known to this script)
  {
    const h = await open(browser);
    await h.page.locator('#g-admin-link').click();
    await h.page.locator('#g-adminpw input').first().fill('e2e-wrong-code-1');
    await h.page.locator('#g-pw-go').click();
    await h.page.waitForTimeout(4000);
    const step = await visibleStep(h.page);
    await shot(h.page, '4-staff-wrong-code');
    const m = h.calls.find((c) => c.fn === 'guide_staff_session_v1');
    rec('4 staff wrong code: refused by the new function (no 404 fallback)', step.includes('g-adminpw') && !!m && m.status === 200 && /ok=false/.test(m.shape) && !h.calls.some((c) => c.fn === 'verify_admin_pin'), `step=${step} :: ${fmt(h.calls)}`);
    await h.context.close();
  }
} finally { await browser.close(); }
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad} of ${results.length} passed`);
process.exit(bad ? 1 : 0);
