// ============================================================
// End-to-end check of the BUILT extension (dist/) in real Chromium.
//
//   npm run build && npx tsx sim/bot/e2e-extension.ts [--headed] [--seconds 40]
//
// Loads dist/ as an unpacked extension, serves the local fake table
// (sim/bot/fake-table/app.ts) at a pokernow.club games URL by request
// interception (no network), then checks three phases:
//   A  recommend mode: a decision is shown, nothing is clicked
//   B  autonomous + table authorised: hands are played, no illegal click
//   C  emergency stop: clicking stops
// and that hands, profiles and decisions reach the extension's IndexedDB and
// the dashboard. Writes reports/e2e-extension-<date>.md.
//
// This validates the extension against fixture markup, NOT the live site.
// ============================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { parseBundle } from '../../src/bot/diag/recorder';
import { replayObservations } from '../../src/bot/diag/replay';

const has = (f: string) => process.argv.includes(`--${f}`);
const argN = (f: string, d: number) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const TABLE = 'pgle2etest';
// --recommend-only: no autonomous phase at all. The stand-in table hides its fold markers and plays Hero's seat
// itself after a pause, so the extension only ever recommends.
const REC_ONLY = process.argv.includes('--recommend-only');
const URL = `https://www.pokernow.club/games/${TABLE}?players=6&seed=11${REC_ONLY ? '&hideFolds=1&auto=2200' : ''}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const dist = path.resolve('dist');
  if (!fs.existsSync(path.join(dist, 'manifest.json'))) throw new Error('dist/ not built: run npm run build first');
  const bundle = await build({ entryPoints: [path.resolve('sim/bot/fake-table/app.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent' });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Fake table</title></head><body style="background:#234;color:#fff;font:14px sans-serif"><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/g, '<\\/script')}</script></body></html>`;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokerbot-e2e-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: !has('headed'),
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const lines: string[] = [];
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const check = (name: string, ok: boolean, detail = '') => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
  try {
    await ctx.route('https://www.pokernow.club/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    let sw = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = sw.url().split('/')[2];
    check('extension loaded, service worker registered', !!extId, sw.url());

    const pageErrors: string[] = [];
    const table = await ctx.newPage();
    table.on('pageerror', (e) => pageErrors.push(e.message));
    await table.goto(URL);
    const dash = await ctx.newPage();
    const dashErrors: string[] = [];
    dash.on('pageerror', (e) => dashErrors.push(e.message));
    dash.on('console', (m) => { if (m.type() === 'error') dashErrors.push(m.text()); });
    await dash.goto(`chrome-extension://${extId}/dashboard.html`);
    const stats = () => table.evaluate(() => (window as unknown as { __stats: { hands: number; heroActions: number; autoActions: number; illegalClicks: number; errors: string[] } }).__stats);
    const live = () => dash.evaluate(async () => (await chrome.storage.session.get('live')).live);
    const setSettings = (patch: Record<string, unknown>) => dash.evaluate(async (p) => {
      const cur = (await chrome.storage.local.get('settings')).settings ?? {};
      await chrome.storage.local.set({ settings: { ...cur, ...p } });
    }, patch);

    // ---- A: recommend ----
    await setSettings({ mode: 'recommend', estop: false, authorizationConfirmed: false, authorizedTables: [], minDelayMs: 0, maxDelayMs: 150 });
    await sleep(7000);
    check('content script attached (panel host present)', await table.evaluate(() => !!document.getElementById('poker-bot-panel-host')));
    await dash.bringToFront();
    type Live = { tableId: string; decision: { label: string } | null; status: string; tracker: { valid: boolean; confidence: number; turnStatus: string; settled: boolean; blockers: string[] }; recommendation: { state: string; reason: string | null }; observation: { heroToAct: boolean }; acting: boolean; hand: unknown };
    let l = await live() as Live | undefined;
    check('live state reaches the dashboard', !!l && l.tableId === TABLE, l ? `table ${l.tableId}` : 'no live state');
    check('recommend mode: hand tracked with full confidence', !!l && !!l.hand && l.tracker.valid && l.tracker.confidence >= 0.7, l ? `confidence ${l.tracker.confidence}` : '');
    check('recommend mode: a decision is shown', !!l?.decision, l?.decision?.label ?? 'none');
    const a = await stats();
    check('recommend mode: nothing clicked', a.heroActions === 0 && !l?.acting, `${a.heroActions} hero actions`);
    const bigShown = await dash.waitForSelector('#tab-live #decision .big', { timeout: 25000 }).then(() => true, () => false);
    check('dashboard renders the decision', bigShown, bigShown ? (await dash.locator('#tab-live #decision .big').first().innerText().catch(() => '')) : 'no recommendation appeared within 25 s');
    const shots = process.argv.indexOf('--shots') >= 0 ? process.argv[process.argv.indexOf('--shots') + 1] : null;
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await dash.setViewportSize({ width: 1280, height: 900 }); await dash.screenshot({ path: path.join(shots, 'dashboard-live-action.png'), fullPage: true }).catch(() => undefined); await table.screenshot({ path: path.join(shots, 'overlay.png') }).catch(() => undefined); }
    check('dashboard live page: status pill, five board slots, players list, timeline',
      (await dash.locator('#status-pill').count()) === 1 && (await dash.locator('#board .pc').count()) === 5 && (await dash.locator('#players .prow').count()) >= 7 && (await dash.locator('#timeline .tlrow').count()) >= 2,
      `pill "${await dash.locator('#status-pill').innerText().catch(() => '?')}", ${await dash.locator('#players .prow').count()} player rows`);
    check('dashboard live page: no horizontal scrolling at 1280 px', await dash.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    check('dashboard live page: the decision area is never empty', (await dash.locator('#decision .big, #decision .msg').first().innerText().catch(() => '')).trim().length > 0);

    let c2 = a;
    if (REC_ONLY) {
      // ---- tracking soak in recommend mode: sample the live state while the table plays ----
      const seconds = argN('seconds', 45);
      let heroTurn = 0, withRec = 0, blocked = 0, disagree = 0, staleShown = 0;
      const reasons = new Set<string>();
      const statuses = new Set<string>();
      for (let i = 0; i < seconds * 4; i++) {
        await sleep(250);
        const s = await live() as Live | undefined;
        if (!s) continue;
        statuses.add(s.status.replace(/\(.*\)/, '').replace(/recommendation: .*/, 'recommendation').trim());
        if (s.tracker.settled && s.tracker.turnStatus === 'disagree') disagree++;
        if (!s.observation.heroToAct && s.decision) staleShown++;
        if (!s.observation.heroToAct) continue;
        heroTurn++;
        if (s.recommendation.state === 'ready' || s.recommendation.state === 'thinking') withRec++;
        else if (s.recommendation.state === 'blocked' && s.tracker.settled) { blocked++; reasons.add(s.recommendation.reason ?? ''); }
      }
      const b = await stats();
      c2 = b;
      check('recommend-only soak: hands were played (the table moved Hero by itself)', b.hands >= 4 && b.autoActions >= 4, `${b.hands} hands, ${b.autoActions} table-driven hero actions in ${seconds}s`);
      check('recommend-only soak: the extension clicked nothing', b.heroActions === 0 && b.illegalClicks === 0, `${b.heroActions} clicks`);
      check('recommend-only soak: Hero turns had a recommendation, none was blocked', heroTurn >= 8 && blocked === 0 && withRec >= 0.9 * heroTurn, `${heroTurn} samples on Hero's turn: ${withRec} with a recommendation, ${heroTurn - withRec - blocked} while the table settled, ${blocked} blocked${reasons.size ? ` (${[...reasons].join(' / ')})` : ''}`);
      check('recommend-only soak: observed and predicted actor never disagreed on a settled table', disagree === 0, `${disagree} samples`);
      check('recommend-only soak: no recommendation shown outside Hero\'s turn', staleShown === 0, `${staleShown} samples`);
      check('recommend-only soak: explicit status for every situation', [...statuses].every((s) => s.length > 0), [...statuses].slice(0, 9).join(' ; '));

      if (shots) {
        await dash.waitForSelector('#tab-live #decision .msg', { timeout: 15000 }).catch(() => undefined);
        await dash.screenshot({ path: path.join(shots, 'dashboard-live-waiting.png'), fullPage: true }).catch(() => undefined);
      }
      await dash.click('button[data-tab=diag]');
      await dash.waitForSelector('#bundle-export', { timeout: 5000 });
      if (shots) await dash.screenshot({ path: path.join(shots, 'dashboard-diagnostics.png'), fullPage: true }).catch(() => undefined);
      check('dashboard: diagnostics are in collapsible sections', (await dash.locator('#tab-diag details.sec').count()) >= 6 && (await dash.locator('#tab-diag details.sec:not([open])').count()) >= 2, `${await dash.locator('#tab-diag details.sec').count()} sections`);
      check('dashboard: diagnostics tab shows the six state checks and the turn card', (await dash.locator('#tab-diag dt', { hasText: 'Decision readiness' }).count()) > 0 && (await dash.locator('#tab-diag dt', { hasText: 'Observed actor (table)' }).count()) > 0);
      check('dashboard: action timeline is drawn', (await dash.locator('#tab-diag h2', { hasText: 'Preflop' }).count()) > 0);
      const dl = dash.waitForEvent('download', { timeout: 15000 });
      await dash.click('#bundle-export');
      const file = path.join(os.tmpdir(), `pokerbot-bundle-${Date.now()}.json`);
      await (await dl).saveAs(file);
      const bundle = parseBundle(JSON.parse(fs.readFileSync(file, 'utf8')));
      const frames = bundle.hands.flatMap((x) => x.frames);
      check('debug bundle exported from the dashboard', bundle.hands.length >= 3 && frames.length > 30, `${bundle.hands.length} hands, ${frames.length} frames, extension ${bundle.build.extensionVersion}, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
      const full = bundle.hands.filter((x) => x.startsAtHandStart);
      const rep = replayObservations(full.flatMap((x) => x.frames));
      const deduced = rep.hands.reduce((n, x) => n + x.deduced, 0);
      const diverged = rep.hands.filter((x) => x.firstDivergence);
      check('debug bundle replays offline with no divergence', rep.hands.length >= 2 && diverged.length === 0, `${rep.hands.length} hands replayed, ${diverged.length} with a divergence${diverged[0] ? `: ${diverged[0].firstDivergence!.message}` : ''}`);
      check('hidden folds were deduced and marked as such', deduced > 0, `${deduced} deduced actions in ${rep.hands.length} hands`);
      check('replay: Hero turns usable', rep.framesHeroTurnUsable > 0 && rep.framesHeroTurnBlocked === 0, `${rep.framesHeroTurnUsable} usable, ${rep.framesHeroTurnBlocked} blocked of ${rep.framesWithHeroTurnShown} frames`);
      const keep = process.argv.indexOf('--keep-bundle');
      if (keep >= 0 && process.argv[keep + 1]) fs.copyFileSync(file, process.argv[keep + 1]);
      fs.rmSync(file, { force: true });
    } else {

    // ---- B: autonomous ----
    await setSettings({ mode: 'autonomous', authorizationConfirmed: true, authorizedTables: [TABLE] });
    const seconds = argN('seconds', 40);
    await sleep(seconds * 1000);
    const b = await stats();
    check('autonomous: hands were played to completion', b.hands >= 3, `${b.hands} hands, ${b.heroActions} hero actions in ${seconds}s`);
    check('autonomous: no illegal click reached the table', b.illegalClicks === 0, b.errors.slice(0, 3).join(' | '));
    l = await live() as typeof l;
    check('autonomous: state still valid', !!l && l.tracker.valid, l ? `confidence ${l.tracker.confidence}` : '');

    // ---- C: emergency stop ----
    await setSettings({ estop: true });
    await sleep(1500);
    const c1 = await stats();
    await sleep(7000);
    c2 = await stats();
    check('emergency stop: no further clicks', c2.heroActions === c1.heroActions, `${c1.heroActions} -> ${c2.heroActions}`);
    }

    // ---- storage and dashboard ----
    // Passed as a string: the TypeScript runner would otherwise inject helpers that do not exist in the page.
    const stored = await dash.evaluate(`(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('poker-bot'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const all = (s) => new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const hands = await all('hands'), profiles = await all('profiles'), decisions = await all('decisions'), diags = await all('diagnostics');
      const statuses = {};
      for (const d of decisions) { const k = d.execution ? d.execution.status : 'shown-only'; statuses[k] = (statuses[k] || 0) + 1; }
      return {
        hands: hands.length, valid: hands.filter((x) => x.valid).length, profiles: profiles.length, maxProfileHands: Math.max(0, ...profiles.map((p) => p.hands)),
        ids: profiles.map((p) => p.playerId).slice(0, 2), decisions: decisions.length, statuses,
        errors: diags.filter((d) => d.level === 'error').map((d) => d.message).slice(0, 5),
        warns: diags.filter((d) => d.level === 'warn').map((d) => d.message).slice(0, 8),
      };
    })()`) as { hands: number; valid: number; profiles: number; maxProfileHands: number; ids: string[]; decisions: number; statuses: Record<string, number>; errors: string[]; warns: string[] };
    check('hands stored in the extension database', stored.hands >= 3, `${stored.hands} stored, ${stored.valid} valid`);
    check('most stored hands reconstructed cleanly', stored.valid >= Math.floor(0.8 * stored.hands), `${stored.valid}/${stored.hands}`);
    check('opponent profiles stored', stored.profiles === 6 && stored.maxProfileHands >= 3, `${stored.profiles} profiles, up to ${stored.maxProfileHands} hands; ids like ${stored.ids.join(', ')}`);
    if (REC_ONLY) check('decisions stored as shown-only', (stored.statuses['shown-only'] ?? 0) >= 4 && Object.keys(stored.statuses).length === 1, JSON.stringify(stored.statuses));
    else {
      check('decisions stored with execution results', (stored.statuses.accepted ?? 0) >= 3, JSON.stringify(stored.statuses));
      check('executed decisions match table clicks', (stored.statuses.accepted ?? 0) + (stored.statuses.unverified ?? 0) === c2.heroActions, `${JSON.stringify(stored.statuses)} vs ${c2.heroActions} clicks`);
    }
    check('no engine or storage errors logged', stored.errors.length === 0, stored.errors.join(' | '));
    await dash.click('button[data-tab=opponents]');
    await dash.waitForSelector('#tab-opponents table tr.click', { timeout: 5000 });
    check('dashboard: opponents tab lists profiles', (await dash.locator('#tab-opponents table tr.click').count()) === 6);
    await dash.click('button[data-tab=hands]');
    await dash.waitForSelector('#tab-hands table tr.click', { timeout: 5000 });
    await dash.locator('#tab-hands table tr.click').first().click();
    await dash.waitForSelector('#tab-hands ol li', { timeout: 5000 });
    check('dashboard: hand review shows the action', (await dash.locator('#tab-hands ol li').count()) > 3);
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await popup.waitForSelector('#state');
    if (!REC_ONLY) check('popup renders and shows the emergency stop state', /Emergency stop is ON/.test(await popup.locator('#state').innerText()));
    else check('popup renders', (await popup.locator('#state').innerText()).length > 0);
    check('no uncaught errors in the table page or dashboard', pageErrors.length === 0 && dashErrors.length === 0, [...pageErrors, ...dashErrors].slice(0, 3).join(' | '));

    const version = ctx.browser()?.version() ?? 'unknown';
    lines.push(`# Extension end-to-end check (fixture table${REC_ONLY ? ', recommend-only, fold markers hidden' : ''})`, '',
      `Generated by \`sim/bot/e2e-extension.ts\` on ${new Date().toISOString().slice(0, 10)}. Chromium ${version}, ${has('headed') ? 'headed' : 'headless'}.`,
      'The built `dist/` was loaded as an unpacked extension and pointed at a local stand-in table that renders PokerNow-shaped markup. **This is not the live site.**', '',
      '| Check | Result | Detail |', '|---|---|---|', ...checks.map((c) => `| ${c.name} | ${c.ok ? 'pass' : 'FAIL'} | ${c.detail.replace(/\|/g, '/')} |`), '',
      `Warnings logged by the extension during the run: ${stored.warns.length ? stored.warns.map((w) => `\`${w}\``).join('; ') : 'none'}.`);
    fs.mkdirSync('reports', { recursive: true });
    const file = `reports/e2e-extension-${REC_ONLY ? 'recommend-only-' : ''}${new Date().toISOString().slice(0, 10)}.md`;
    fs.writeFileSync(file, lines.join('\n') + '\n');
    console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed. Wrote ${file}`);
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
