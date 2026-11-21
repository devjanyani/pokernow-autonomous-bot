// ============================================================
// End-to-end check of authorised execution and action scheduling (0.9.1) in the BUILT extension (dist/), in real
// Chromium, against the local stand-in table (sim/bot/fake-table). NOT the live PokerNow site.
//
//   npm run build && npx tsx sim/bot/e2e-exec.ts [--headed] [--seconds 240]
//
// Phases (real time, default timing 4-20 s):
//   A  fresh profile: timing defaults, v3 execution permission off, Settings shows the timing section
//   B  autonomous, confirmation given, table NOT authorised (v2): nothing clicked
//   C  v3 selected, autonomous, table authorised, v3 permission OFF: nothing clicked
//   D  v3 permission switched on through the Settings page (confirmation dialog), 30 s clock on the page: every
//      Hero turn is acted on by the extension after 4-20 s (measured by the table itself), v3 decides heads-up after
//      the flop, v2 decides preflop / multiway labelled as the fallback, no timeouts, no illegal clicks
//   E  emergency stop during a pending action: cancelled at once, nothing clicked
//   F  authorisation revoked during a pending action: cancelled at once, nothing clicked
//   G  5 s clock (shorter than the 4 s minimum plus the 3 s margin): acts before the clock runs out, conflict shown
//   I  timing modes (0.9.2): Random -> Instant chosen in Settings while an action is pending (cancelled, decided
//      again, executed once without waiting); Instant acts within computation + reading time with no timeouts; the
//      Live tab shows the mode; recommend mode with Instant never clicks
//   H  the timing settings persist (changed in Settings, read back after reloading the dashboard)
// Writes reports/e2e-exec-<date>.md.
// ============================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const has = (f: string) => process.argv.includes(`--${f}`);
const argN = (f: string, d: number) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const TABLE = 'pgle2eexectest';
const url = (q: string) => `https://www.pokernow.club/games/${TABLE}?players=3&seed=23&${q}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Turn = { start: number; end: number | null; how: string | null };
type Stats = { hands: number; heroActions: number; autoActions: number; timeouts: number; illegalClicks: number; errors: string[]; heroTurns: Turn[] };
type Sched = {
  policy: { minDelayMs: number; maxDelayMs: number; deadlineMarginMs: number; timingMode: 'instant' | 'random' };
  pending: null | { label: string; decidedBy: string; fallback: string | null; remainingMs: number; targetDelayMs: number; deadlineSource: string; conflict: string | null };
  lastCancel: null | { label: string | null; reason: string; agoMs: number };
  lastExecuted: null | { label: string; reason: string; delayMs: number; computeMs: number; waitedMs: number; conflict: string | null; agoMs: number };
};
type Live = { ts: number; acting: boolean; execution?: { enabled: boolean; reason: string }; schedule?: Sched; strategy?: { selected: string; v3Execution: boolean } };

async function main(): Promise<void> {
  const dist = path.resolve('dist');
  if (!fs.existsSync(path.join(dist, 'manifest.json'))) throw new Error('dist/ not built: run npm run build first');
  const bundle = await build({ entryPoints: [path.resolve('sim/bot/fake-table/app.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent' });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Fake table</title></head><body style="background:#234;color:#fff;font:14px sans-serif"><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/g, '<\\/script')}</script></body></html>`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokerbot-e2e-exec-'));
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: !has('headed'), args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const check = (name: string, ok: boolean, detail = '') => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
  let version = 'unknown';
  const delays: number[] = [];
  try {
    await ctx.route('https://www.pokernow.club/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    let sw = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = sw.url().split('/')[2];
    check('extension loaded', !!extId, sw.url());
    const pageErrors: string[] = [];
    const table = await ctx.newPage();
    table.on('pageerror', (e) => pageErrors.push(e.message));
    const dash = await ctx.newPage();
    dash.on('pageerror', (e) => pageErrors.push(e.message));
    await dash.goto(`chrome-extension://${extId}/dashboard.html`);
    await dash.setViewportSize({ width: 1280, height: 900 });
    const stats = () => table.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __stats: unknown }).__stats))) as Promise<Stats>;
    const live = () => dash.evaluate(async () => (await chrome.storage.session.get('live')).live) as Promise<Live | undefined>;
    const stored = () => dash.evaluate(async () => (await chrome.storage.local.get('settings')).settings) as Promise<Record<string, unknown> | undefined>;
    const setSettings = (patch: Record<string, unknown>) => dash.evaluate(async (p) => { const cur = (await chrome.storage.local.get('settings')).settings ?? {}; await chrome.storage.local.set({ settings: { ...cur, ...p } }); }, patch);
    const openTab = async (t: string) => { await dash.click(`button[data-tab=${t}]`); await sleep(300); };
    const waitPending = async (minRemaining: number, maxMs = 60000) => {
      for (let i = 0; i < maxMs / 100; i++) { const l = await live(); if (l?.schedule?.pending && l.schedule.pending.remainingMs > minRemaining) return l; await sleep(100); }
      return null;
    };

    // ---- A: defaults ----
    await openTab('settings');
    await dash.waitForSelector('#set-timing', { timeout: 10000 });
    const val = async (id: string) => dash.locator(id).inputValue();
    check('Settings has the authorised-play timing section with the defaults: Random, 4 s / 20 s, 3 s margin',
      (await val('#set-minDelayMs')) === '4' && (await val('#set-maxDelayMs')) === '20' && (await val('#set-deadlineMarginMs')) === '3' && (await val('#set-timingMode')) === 'random'
        && (await dash.locator('#set-timingMode option').count()) === 2,
      `min ${await val('#set-minDelayMs')}, max ${await val('#set-maxDelayMs')}, margin ${await val('#set-deadlineMarginMs')}`);
    check('v2 is the default and the v3 execution permission is not offered while v2 is selected', (await val('#set-strategyEngine')) === 'v2' && (await dash.locator('#set-v3ExecutionOptIn').count()) === 0);

    // ---- B: not authorised ----
    await setSettings({ mode: 'autonomous', estop: false, authorizationConfirmed: true, authorizedTables: [] });
    await table.goto(url('auto=3000'));
    await openTab('live');
    let s0 = await stats();
    await sleep(30000);
    let s1 = await stats();
    let l = await live();
    check('autonomous, confirmation given, table not authorised: nothing clicked', s1.heroActions === s0.heroActions && l?.execution?.enabled === false && /not authorised/.test(l?.execution?.reason ?? ''), `${s1.heroActions - s0.heroActions} clicks in ${s1.hands - s0.hands} hands; the table played Hero ${s1.autoActions - s0.autoActions} times; execution: ${l?.execution?.reason}`);

    // ---- C: v3 without its permission ----
    await openTab('settings');
    await dash.selectOption('#set-strategyEngine', 'v3');
    await sleep(800);
    check('choosing v3 does not switch its execution permission on', (await stored())?.v3ExecutionOptIn === false && !(await dash.locator('#set-v3ExecutionOptIn').isChecked()));
    await setSettings({ authorizedTables: [TABLE] });
    await openTab('live');
    s0 = await stats();
    await sleep(30000);
    s1 = await stats();
    l = await live();
    check('v3, autonomous, table authorised, v3 permission off: nothing clicked', s1.heroActions === s0.heroActions && l?.execution?.enabled === false && /recommendation-only unless/.test(l?.execution?.reason ?? ''), `${s1.heroActions - s0.heroActions} clicks in ${s1.hands - s0.hands} hands; execution: ${l?.execution?.reason}`);

    // ---- D: v3 permission on through the Settings page, 30 s clock ----
    await openTab('settings');
    await dash.click('#set-v3ExecutionOptIn');
    await dash.waitForSelector('#confirm-ok', { timeout: 5000 });
    const dialogText = await dash.locator('dialog.confirm').innerText();
    await dash.click('#confirm-ok');
    await sleep(800);
    check('the permission is switched on only through a confirmation that names play money and the organiser', (await stored())?.v3ExecutionOptIn === true && /play-money/.test(dialogText) && /organiser/.test(dialogText));
    await table.goto(url('clock=30'));
    await openTab('live');
    s0 = await stats();
    const seconds = argN('seconds', 240);
    const executed = new Map<string, NonNullable<Sched['lastExecuted']>>();
    let pendingSeen = 0, cardSeen = false;
    for (let i = 0; i < seconds * 4; i++) {
      await sleep(250);
      const x = await live();
      const e = x?.schedule?.lastExecuted;
      if (e && x) executed.set(`${Math.round((x.ts - e.agoMs) / 500)}|${e.label}`, e);
      if (x?.schedule?.pending) pendingSeen++;
      if (!cardSeen && x?.schedule?.pending) cardSeen = /Pending action[\s\S]*in \d+\.\d s/.test(await dash.locator('#schedule').innerText().catch(() => ''));
    }
    s1 = await stats();
    const turns = s1.heroTurns.slice(s0.heroTurns.length).filter((t) => t.end !== null);
    const clicked = turns.filter((t) => t.how?.startsWith('click'));
    for (const t of clicked) delays.push(t.end! - t.start);
    const ex = [...executed.values()];
    check('every Hero turn was acted on by the extension, none timed out', clicked.length >= 8 && s1.timeouts === s0.timeouts && clicked.length === turns.filter((t) => t.how !== 'moved on').length, `${clicked.length} turns acted on, ${s1.timeouts - s0.timeouts} timeouts, ${s1.hands - s0.hands} hands`);
    check('delays measured by the table are within 4-20 s (plus reading lag)', delays.length > 0 && delays.every((d) => d >= 4000 && d <= 21000), `min ${(Math.min(...delays) / 1000).toFixed(1)} s, max ${(Math.max(...delays) / 1000).toFixed(1)} s, mean ${(delays.reduce((a, b) => a + b, 0) / delays.length / 1000).toFixed(1)} s over ${delays.length}`);
    check('delays recorded by the extension are within 4-20 s, computation counted inside them', ex.length > 0 && ex.every((e) => e.delayMs >= 4000 && e.delayMs <= 20100 && Math.abs(e.computeMs + e.waitedMs - e.delayMs) < 5 && !e.conflict), `${ex.length} executions; computation ${Math.min(...ex.map((e) => e.computeMs)).toFixed(0)}-${Math.max(...ex.map((e) => e.computeMs)).toFixed(0)} ms`);
    check('delays are spread over the range (randomised per decision)', delays.length >= 6 && Math.max(...delays) - Math.min(...delays) > 6000);
    const db = await dash.evaluate(`(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('poker-bot'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const all = (s) => new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const ds = (await all('decisions')).filter((d) => d.execution);
      return ds.map((d) => ({ used: d.decision.strategy && d.decision.strategy.used, requested: d.decision.strategy && d.decision.strategy.requested, fallback: d.decision.strategy && d.decision.strategy.fallback, action: d.decision.action, status: d.execution.status, timing: d.execution.timing || null }));
    })()`) as { used: string; requested: string; fallback: string | null; action: string; status: string; timing: unknown }[];
    const byV3 = db.filter((d) => d.requested === 'v3' && d.used === 'v3'), byFallback = db.filter((d) => d.requested === 'v3' && d.used === 'v2');
    check('version 3 executed heads-up postflop decisions; version 2 executed the fallbacks, labelled', byV3.length >= 1 && byFallback.length >= 1 && byFallback.every((d) => !!d.fallback) && ex.some((e) => /v3 -> v2 fallback/.test(e.label)),
      `${byV3.length} by v3 (${[...new Set(byV3.map((d) => d.action))].join(', ')}), ${byFallback.length} by v2 as fallback (${[...new Set(byFallback.map((d) => (d.fallback ?? '').split(':')[0]))].join(', ')})`);
    check('every executed decision is stored with its timing and was accepted by the table', db.length > 0 && db.every((d) => d.timing && d.status === 'accepted'), `${db.length} executed; statuses ${[...new Set(db.map((d) => d.status))].join(', ')}`);
    check('the Live tab showed the pending action and its remaining delay', cardSeen && pendingSeen > 0, `${pendingSeen} samples with a pending action`);
    check('no illegal click reached the table', s1.illegalClicks === 0, s1.errors.slice(0, 2).join(' | '));

    // ---- E: emergency stop while an action is pending ----
    let p = await waitPending(3000);
    let before = await stats();
    await dash.click('#estop');
    await sleep(400);
    l = await live();
    check('emergency stop during a pending action: cancelled at once', !!p && !l?.schedule?.pending && l?.schedule?.lastCancel?.reason === 'emergency stop', `${p?.schedule?.pending?.label} pending with ${((p?.schedule?.pending?.remainingMs ?? 0) / 1000).toFixed(1)} s left; then: ${l?.schedule?.lastCancel?.reason}`);
    await sleep(25000);
    let after = await stats();
    check('emergency stop: nothing clicked afterwards', after.heroActions === before.heroActions, `${after.heroActions - before.heroActions} clicks in 25 s`);
    await setSettings({ estop: false });

    // ---- F: authorisation revoked while an action is pending ----
    p = await waitPending(3000);
    before = await stats();
    await setSettings({ authorizedTables: [] });
    await sleep(400);
    l = await live();
    check('authorisation revoked during a pending action: cancelled at once', !!p && !l?.schedule?.pending && /this table is not authorised/.test(l?.schedule?.lastCancel?.reason ?? ''), l?.schedule?.lastCancel?.reason ?? '');
    await sleep(25000);
    after = await stats();
    check('revoked: nothing clicked afterwards', after.heroActions === before.heroActions, `${after.heroActions - before.heroActions} clicks in 25 s`);
    await setSettings({ authorizedTables: [TABLE] });

    // ---- G: a 5 s clock ----
    await table.goto(url('clock=5'));
    s0 = await stats();
    let conflictShown = false;
    for (let i = 0; i < 45 * 4; i++) {
      await sleep(250);
      const x = await live();
      if (x?.schedule?.pending?.conflict || x?.schedule?.lastExecuted?.conflict) conflictShown ||= /Deadline conflict|deadline conflict/.test(await dash.locator('#schedule').innerText().catch(() => ''));
    }
    s1 = await stats();
    const short = s1.heroTurns.filter((t) => t.end !== null && t.how?.startsWith('click')).map((t) => t.end! - t.start);
    check('5 s clock: acts before the clock runs out (the 4 s minimum is not met), no timeouts', short.length >= 2 && short.every((d) => d < 4000) && s1.timeouts === s0.timeouts, `${short.length} actions after ${short.map((d) => (d / 1000).toFixed(1)).join(', ')} s; ${s1.timeouts - s0.timeouts} timeouts`);
    check('5 s clock: the conflict is shown on the dashboard', conflictShown);

    // ---- I: timing modes ----
    await table.goto(url('clock=30'));
    await openTab('live');
    p = await waitPending(3000);
    before = await stats();
    await openTab('settings');
    await dash.selectOption('#set-timingMode', 'instant');
    const switchedAt = Date.now();
    await sleep(400);
    l = await live();
    const cancelReason = l?.schedule?.lastCancel?.reason ?? '';
    let afterSwitch = await stats();
    for (let i = 0; i < 40 && afterSwitch.heroActions === before.heroActions; i++) { await sleep(100); afterSwitch = await stats(); }
    const switchClickMs = Date.now() - switchedAt;
    check('Random -> Instant chosen in Settings while an action is pending: cancelled with the reason, then executed without waiting',
      !!p && cancelReason === 'timing mode changed to instant' && (await stored())?.timingMode === 'instant' && afterSwitch.heroActions === before.heroActions + 1 && switchClickMs < 4000,
      `pending ${p?.schedule?.pending?.label} with ${((p?.schedule?.pending?.remainingMs ?? 0) / 1000).toFixed(1)} s left; cancelled: ${cancelReason}; clicked ${(switchClickMs / 1000).toFixed(1)} s after the switch`);
    await openTab('live');
    s0 = await stats();
    let instantShown = false;
    for (let i = 0; i < 90 * 4; i++) {
      await sleep(250);
      if (!instantShown) instantShown = /Timing mode\s*Instant/.test(await dash.locator('#schedule').innerText().catch(() => '')) && /timing: Instant/.test(await dash.innerText('body').catch(() => ''));
    }
    s1 = await stats();
    const inst = s1.heroTurns.slice(s0.heroTurns.length).filter((t) => t.end !== null);
    const instClicked = inst.filter((t) => t.how?.startsWith('click')).map((t) => t.end! - t.start);
    l = await live();
    check('Instant: every Hero turn acted on within computation and reading time (under 3.5 s), no timeouts',
      instClicked.length >= 6 && instClicked.every((d) => d < 3500) && s1.timeouts === s0.timeouts && instClicked.length === inst.filter((t) => t.how !== 'moved on').length,
      `${instClicked.length} actions after ${instClicked.map((d) => (d / 1000).toFixed(1)).join(', ')} s; ${s1.timeouts - s0.timeouts} timeouts`);
    check('Instant: the extension recorded no intentional wait', (l?.schedule?.lastExecuted?.waitedMs ?? 99) <= 300 && l?.schedule?.policy.timingMode === 'instant', `last executed: computation ${(l?.schedule?.lastExecuted?.computeMs ?? 0).toFixed(0)} ms, waiting ${(l?.schedule?.lastExecuted?.waitedMs ?? 0).toFixed(0)} ms`);
    check('the Live tab shows the active timing mode and the execution status', instantShown);
    await setSettings({ mode: 'recommend' });
    await sleep(500);
    s0 = await stats();
    await sleep(20000);
    s1 = await stats();
    check('recommend mode with Instant selected: nothing clicked', s1.heroActions === s0.heroActions, `${s1.heroActions - s0.heroActions} clicks in 20 s, ${s1.hands - s0.hands} hands`);

    // ---- H: timing settings persist ----
    await openTab('settings');
    await dash.fill('#set-minDelayMs', '5');
    await dash.locator('#set-minDelayMs').dispatchEvent('change');
    await sleep(600);
    await dash.reload();
    await openTab('settings');
    await dash.waitForSelector('#set-minDelayMs');
    check('timing settings persist (Instant and the 5 s minimum stored and shown after reloading)', (await stored())?.minDelayMs === 5000 && (await val('#set-minDelayMs')) === '5' && (await val('#set-timingMode')) === 'instant');
    check('no uncaught errors in the table page or dashboard', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    version = ctx.browser()?.version() ?? 'unknown';
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  const lines = ['# Authorised execution and action scheduling: end-to-end check (stand-in table)', '',
    `Generated by \`sim/bot/e2e-exec.ts\` on ${new Date().toISOString().slice(0, 10)}. Chromium ${version}, ${has('headed') ? 'headed' : 'headless'}, real time.`,
    'The built `dist/` was loaded as an unpacked extension and pointed at the local stand-in table (PokerNow-shaped markup, simulated seats, an optional action clock shown in whole seconds). **This is not the live PokerNow site and validates nothing about it.**', '',
    '| Check | Result | Detail |', '|---|---|---|', ...checks.map((c) => `| ${c.name} | ${c.ok ? 'pass' : 'FAIL'} | ${c.detail.replace(/\|/g, '/')} |`), '',
    `Delays measured by the table (turn shown to click), 30 s clock: ${delays.map((d) => (d / 1000).toFixed(1)).join(', ')} s.`, ''];
  fs.mkdirSync('reports', { recursive: true });
  const file = `reports/e2e-exec-${new Date().toISOString().slice(0, 10)}.md`;
  fs.writeFileSync(file, lines.join('\n'));
  console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed. Wrote ${file}`);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
