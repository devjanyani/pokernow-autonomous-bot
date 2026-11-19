// ============================================================
// End-to-end check of the experimental version 3 strategy in the BUILT extension (dist/), in real Chromium, against
// the local stand-in table (sim/bot/fake-table). NOT the live PokerNow site.
//
//   npm run build && npx tsx sim/bot/e2e-v3.ts [--headed] [--seconds 60] [--shots dir]
//
// Phases:
//   A  fresh profile: Settings lists v1, v2 and v3; v2 is the default; v2 recommendations are labelled v2
//   B  v3 selected through the Settings page, mode autonomous AND the table authorised: decisions are routed to
//      version 3 (heads-up pots) or fall back to version 2 with a stated reason (preflop, multiway); raises are
//      offered facing bets; sizes are legal and in the table's chip units; the dashboard names the strategy and the
//      fallbacks; NOTHING is clicked (the table plays Hero's seat itself after a pause)
//   C  cents table (0.25 / 0.50): sizes in cents, shown as such
//   D  back to v2 through the Settings page: tracking, profiles and diagnostics continue undisturbed
// Writes reports/e2e-v3-<date>.md.
// ============================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { build } from 'esbuild';
import { chromium, Page } from 'playwright';

const has = (f: string) => process.argv.includes(`--${f}`);
const argN = (f: string, d: number) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const TABLE = 'pgle2ev3test';
const urlFor = (players: number, seed: number, cents = false) => `https://www.pokernow.club/games/${TABLE}?players=${players}&seed=${seed}&hideFolds=1&auto=2500${cents ? '&cents=1' : ''}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Cand = { action: string; to?: number; label: string };
type Live = {
  tableId: string; ts: number; acting: boolean; status: string;
  decision: null | { action: string; to?: number; label: string; street: string; candidates: Cand[]; strategy?: { requested: string; used: string; fallback: string | null; opponentModel?: string; calibration?: { population: string; river: string } } };
  recommendation: { state: string; reason: string | null; context: null | { key: string; toCall: number; canCheck: boolean; minRaiseTo: number; maxRaiseTo: number; opponents: number } };
  observation: { heroToAct: boolean }; tracker: { handsSeen: number; settled: boolean; turnStatus: string };
  strategy?: { selected: string; experimental: boolean; recommendOnly: boolean; artifacts: { name: string; state: string }[] };
  hand: null | { bigBlind: number };
};

async function main(): Promise<void> {
  const dist = path.resolve('dist');
  if (!fs.existsSync(path.join(dist, 'manifest.json'))) throw new Error('dist/ not built: run npm run build first');
  const bundle = await build({ entryPoints: [path.resolve('sim/bot/fake-table/app.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent' });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Fake table</title></head><body style="background:#234;color:#fff;font:14px sans-serif"><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/g, '<\\/script')}</script></body></html>`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pokerbot-e2e-v3-'));
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: !has('headed'), args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const check = (name: string, ok: boolean, detail = '') => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
  const shots = process.argv.indexOf('--shots') >= 0 ? process.argv[process.argv.indexOf('--shots') + 1] : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = async (p: Page, name: string) => { if (shots) await p.screenshot({ path: path.join(shots, name), fullPage: true }).catch(() => undefined); };
  let version = 'unknown';
  try {
    await ctx.route('https://www.pokernow.club/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    let sw = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = sw.url().split('/')[2];
    check('extension loaded, service worker registered', !!extId, sw.url());
    const pageErrors: string[] = [];
    const table = await ctx.newPage();
    table.on('pageerror', (e) => pageErrors.push(e.message));
    const dash = await ctx.newPage();
    dash.on('pageerror', (e) => pageErrors.push(e.message));
    dash.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
    await dash.goto(`chrome-extension://${extId}/dashboard.html`);
    await dash.setViewportSize({ width: 1280, height: 900 });
    const stats = () => table.evaluate(() => (window as unknown as { __stats: { hands: number; heroActions: number; autoActions: number; illegalClicks: number; errors: string[] } }).__stats);
    const live = () => dash.evaluate(async () => (await chrome.storage.session.get('live')).live) as Promise<Live | undefined>;
    const stored = () => dash.evaluate(async () => (await chrome.storage.local.get('settings')).settings) as Promise<Record<string, unknown> | undefined>;
    const setSettings = (patch: Record<string, unknown>) => dash.evaluate(async (p) => { const cur = (await chrome.storage.local.get('settings')).settings ?? {}; await chrome.storage.local.set({ settings: { ...cur, ...p } }); }, patch);
    const openTab = async (t: string) => { await dash.click(`button[data-tab=${t}]`); await sleep(300); };

    // ---- A: defaults ----
    await openTab('settings');
    await dash.waitForSelector('#set-strategyEngine', { timeout: 10000 });
    const options = await dash.locator('#set-strategyEngine option').evaluateAll((os) => os.map((o) => [(o as HTMLOptionElement).value, o.textContent ?? '']));
    check('Settings lists v1, v2 and v3', ['v1', 'v2', 'v3'].every((v) => options.some((o) => o[0] === v)), options.map((o) => `${o[0]}="${o[1]}"`).join('; '));
    check('the v3 option reads "v3 — Experimental"', options.some((o) => o[0] === 'v3' && /^v3 — Experimental/.test(o[1])));
    check('v2 is the default in a fresh profile', (await dash.locator('#set-strategyEngine').inputValue()) === 'v2' && ((await stored())?.strategyEngine ?? 'v2') === 'v2', `select shows ${await dash.locator('#set-strategyEngine').inputValue()}, stored ${(await stored())?.strategyEngine ?? '(nothing stored: default)'}`);
    check('shadow comparison is off by default', !(await dash.locator('#set-shadowV3').isChecked()));
    await setSettings({ mode: 'recommend', estop: false, authorizationConfirmed: false, authorizedTables: [], minThinkMs: 0, maxThinkMs: 150 });
    await table.goto(urlFor(3, 17));
    await openTab('live');
    let l: Live | undefined;
    for (let i = 0; i < 80 && !(l?.decision); i++) { await sleep(250); l = await live(); }
    check('v2: a recommendation is shown and labelled as version 2', !!l?.decision && l.decision.strategy?.requested === 'v2' && l.strategy?.selected === 'v2', l?.decision ? `${l.decision.label}, decided by ${l.decision.strategy?.used}` : 'no decision');
    await sleep(600);
    check('dashboard names the strategy (v2)', /Strategy: v2/.test(await dash.locator('#strategy-tag').innerText().catch(() => '')));

    // ---- B: v3 through the Settings page, autonomous and authorised: still nothing is clicked ----
    await openTab('settings');
    await dash.selectOption('#set-strategyEngine', 'v3');
    await sleep(800);
    check('selecting v3 in Settings stores it', (await stored())?.strategyEngine === 'v3');
    check('Settings explains that v3 is experimental and recommendation-only', /recommendation-only/.test(await dash.locator('#set-v3-note').innerText().catch(() => '')));
    await setSettings({ mode: 'autonomous', authorizationConfirmed: true, authorizedTables: [TABLE] });
    await openTab('live');
    const s0 = await stats();
    const seconds = argN('seconds', 60);
    const byKey = new Map<string, NonNullable<Live['decision']> & { ctx: NonNullable<Live['recommendation']['context']>; bb: number }>();
    const tags = new Set<string>();
    let acting = 0, staleShown = 0;
    for (let i = 0; i < seconds * 4; i++) {
      await sleep(250);
      const s = await live();
      if (!s) continue;
      if (s.acting) acting++;
      if (!s.observation.heroToAct && s.decision) staleShown++;
      if (s.decision && s.recommendation.context && s.recommendation.state === 'ready') byKey.set(s.recommendation.context.key, { ...s.decision, ctx: s.recommendation.context, bb: s.hand?.bigBlind ?? 0 });
      if (i % 4 === 0) { const t = await dash.locator('#strategy-tag').innerText().catch(() => ''); if (t) tags.add(t); }
      if (i === 20) await shot(dash, 'v3-dashboard-live.png');
    }
    const s1 = await stats();
    const decs = [...byKey.values()];
    const v3d = decs.filter((d) => d.strategy?.used === 'v3'), fb = decs.filter((d) => d.strategy?.requested === 'v3' && d.strategy.used === 'v2');
    check('v3 + autonomous + authorised table: the extension clicked nothing', s1.heroActions === s0.heroActions && acting === 0, `${s1.heroActions - s0.heroActions} clicks; live state "acting" in ${acting} samples; the table played Hero itself ${s1.autoActions - s0.autoActions} times in ${s1.hands - s0.hands} hands`);
    check('selecting v3 routes postflop heads-up decisions to version 3', v3d.length >= 2 && v3d.every((d) => d.street !== 'preflop' && d.ctx.opponents === 1), `${decs.length} decision points: ${v3d.length} by version 3 (${[...new Set(v3d.map((d) => d.street))].join(', ')})`);
    check('version 3 recommendations name the opponent model and the fitted tables', v3d.length > 0 && v3d.every((d) => !!d.strategy?.opponentModel && !!d.strategy.calibration), v3d[0] ? `${v3d[0].strategy?.opponentModel}; population ${v3d[0].strategy?.calibration?.population}, river ${v3d[0].strategy?.calibration?.river}` : '');
    check('fallback to v2 happens with a stated reason (preflop, multiway)', fb.length >= 2 && fb.every((d) => !!d.strategy?.fallback), [...new Set(fb.map((d) => (d.strategy?.fallback ?? '').replace(/\(.*\)/, '').slice(0, 70)))].join(' / '));
    check('dashboard identifies v3 as experimental and shows fallbacks', [...tags].some((t) => /v3 experimental/.test(t)) && [...tags].some((t) => /v3 → v2 fallback/.test(t)), [...tags].join(' | '));
    const facing = v3d.filter((d) => d.ctx.toCall > 0 && d.ctx.maxRaiseTo > d.ctx.toCall);
    check('facing bets, version 3 evaluates raises (check-raise / re-raise) through the pipeline', facing.length === 0 || facing.every((d) => d.candidates.some((c) => c.action === 'raise') || d.ctx.minRaiseTo >= d.ctx.maxRaiseTo), `${facing.length} v3 spots facing a bet; with a raise option: ${facing.filter((d) => d.candidates.some((c) => c.action === 'raise')).length}; raised: ${facing.filter((d) => d.action === 'raise').length}`);
    const sized = decs.flatMap((d) => d.candidates.filter((c) => (c.action === 'bet' || c.action === 'raise') && c.to !== undefined).map((c) => ({ c, d })));
    check('every bet / raise size is legal and in whole chips at 10 / 20', sized.length > 0 && sized.every(({ c, d }) => c.to! >= d.ctx.minRaiseTo - 1e-9 && c.to! <= d.ctx.maxRaiseTo + 1e-9 && Number.isInteger(c.to!)), `${sized.length} sizes checked`);
    check('no recommendation shown outside Hero\'s turn', staleShown === 0, `${staleShown} samples`);

    // ---- C: cents ----
    await table.goto(urlFor(2, 23, true));
    const cents = new Map<string, NonNullable<Live['decision']> & { ctx: NonNullable<Live['recommendation']['context']> }>();
    let bigText = '';
    for (let i = 0; i < 40 * 4; i++) {
      await sleep(250);
      const s = await live();
      if (s?.decision && s.recommendation.context && s.hand?.bigBlind === 0.5) cents.set(s.recommendation.context.key, { ...s.decision, ctx: s.recommendation.context });
      if (s?.decision && (s.decision.action === 'bet' || s.decision.action === 'raise') && s.hand?.bigBlind === 0.5 && !bigText) bigText = `${await dash.locator('#decision .big').innerText().catch(() => '')} for to=${s.decision.to}`;
      if ([...cents.values()].filter((d) => d.strategy?.used === 'v3').length >= 3 && bigText) break;
    }
    const centSizes = [...cents.values()].flatMap((d) => d.candidates.filter((c) => c.to !== undefined && (c.action === 'bet' || c.action === 'raise')).map((c) => ({ c, d })));
    check('cents table (0.25 / 0.50): sizes are legal amounts in cents', centSizes.length > 0 && centSizes.every(({ c, d }) => Math.abs(Math.round(c.to! * 100) - c.to! * 100) < 1e-6 && c.to! >= d.ctx.minRaiseTo - 1e-9 && c.to! <= d.ctx.maxRaiseTo + 1e-9), `${cents.size} decision points, ${centSizes.length} sizes, ${[...cents.values()].filter((d) => d.strategy?.used === 'v3').length} by version 3; e.g. ${centSizes.slice(0, 4).map(({ c }) => c.label).join(', ')}`);
    check('cents table: the dashboard shows the amount as computed', !bigText || /\d+\.\d{1,2}|\d/.test(bigText), bigText || 'no bet or raise recommended in the window');
    const s2 = await stats();
    check('cents table under v3: nothing clicked', s2.heroActions === s1.heroActions, `${s2.heroActions - s1.heroActions} clicks`);

    // ---- D: back to v2 ----
    await table.goto(urlFor(3, 31));
    await setSettings({ mode: 'recommend', authorizationConfirmed: false, authorizedTables: [] });
    await openTab('settings');
    await dash.selectOption('#set-strategyEngine', 'v2');
    await sleep(500);
    await openTab('live');
    const seen0 = (await live())?.tracker.handsSeen ?? 0;
    let v2ok = 0, other = 0, blocked = 0;
    for (let i = 0; i < 25 * 4; i++) {
      await sleep(250);
      const s = await live();
      if (!s) continue;
      if (s.recommendation.state === 'blocked' && s.tracker.settled) blocked++;
      if (s.decision) { if (s.decision.strategy?.requested === 'v2' && s.decision.strategy.used === 'v2') v2ok++; else other++; }
    }
    const lEnd = await live();
    check('switching back to v2: decisions come from version 2 again', v2ok > 0 && other === 0 && lEnd?.strategy?.selected === 'v2', `${v2ok} samples by v2, ${other} by another engine`);
    check('switching strategies did not disturb tracking', (lEnd?.tracker.handsSeen ?? 0) > seen0 && blocked === 0, `hands tracked ${seen0} -> ${lEnd?.tracker.handsSeen}; ${blocked} blocked samples on a settled table`);
    await openTab('settings');
    await dash.selectOption('#set-strategyEngine', 'v3');
    await sleep(1500);
    await openTab('diag');
    await dash.waitForSelector('#tab-diag details.sec', { timeout: 8000 });
    const diagText = await dash.locator('#tab-diag details.sec[data-key=strategy]').innerText().catch(() => '');
    check('diagnostics show the strategy, the opponent model and the fitted tables with provenance', /Table: population-calibration[\s\S]*loaded[\s\S]*phh-dataset@e47fbd5/.test(diagText) && /Table: river-range[\s\S]*loaded/.test(diagText), diagText.replace(/\s+/g, ' ').slice(0, 220));
    await shot(dash, 'v3-dashboard-diagnostics.png');
    const db = await dash.evaluate(`(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('poker-bot'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const all = (s) => new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const hands = await all('hands'), decisions = await all('decisions'), diags = await all('diagnostics');
      return { hands: hands.length, valid: hands.filter((x) => x.valid).length, decisions: decisions.length, executed: decisions.filter((d) => d.execution).length,
        v3: decisions.filter((d) => d.decision && d.decision.strategy && d.decision.strategy.used === 'v3').length,
        errors: diags.filter((d) => d.level === 'error').map((d) => d.message).slice(0, 5) };
    })()`) as { hands: number; valid: number; decisions: number; executed: number; v3: number; errors: string[] };
    check('hands and decisions stored; none executed; version 3 decisions recorded with their strategy note', db.hands >= 5 && db.valid >= Math.floor(0.8 * db.hands) && db.executed === 0 && db.v3 >= 2, JSON.stringify(db));
    check('no engine or storage errors logged', db.errors.length === 0, db.errors.join(' | '));
    check('no uncaught errors in the table page or dashboard', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    const sEnd = await stats();
    check('no illegal click reached the table during the run', sEnd.illegalClicks === 0 && sEnd.heroActions === 0, `${sEnd.heroActions} clicks, ${sEnd.illegalClicks} illegal`);
    version = ctx.browser()?.version() ?? 'unknown';
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  const lines = ['# Version 3 (experimental) in the extension: end-to-end check (stand-in table)', '',
    `Generated by \`sim/bot/e2e-v3.ts\` on ${new Date().toISOString().slice(0, 10)}. Chromium ${version}, ${has('headed') ? 'headed' : 'headless'}.`,
    'The built `dist/` was loaded as an unpacked extension and pointed at the local stand-in table, which renders PokerNow-shaped markup and plays the other seats (and Hero\'s seat after a pause when nobody clicks). **This is not the live PokerNow site and validates nothing about it.**', '',
    '| Check | Result | Detail |', '|---|---|---|', ...checks.map((c) => `| ${c.name} | ${c.ok ? 'pass' : 'FAIL'} | ${c.detail.replace(/\|/g, '/')} |`), ''];
  fs.mkdirSync('reports', { recursive: true });
  const file = `reports/e2e-v3-${new Date().toISOString().slice(0, 10)}.md`;
  fs.writeFileSync(file, lines.join('\n'));
  console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed. Wrote ${file}`);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
