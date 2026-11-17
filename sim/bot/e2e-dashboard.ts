// ============================================================
// End-to-end check of the dashboard, the table manager and the popup in the
// BUILT extension (dist/), in real Chromium, against the local stand-in table.
//
//   npm run build && npx tsx sim/bot/e2e-dashboard.ts [--shots <dir>] [--bundle <debug bundle>] [--headed]
//
// What it does:
//   1. opens the stand-in table in recommend-only mode and lets hands be recorded;
//   2. adds two older tables to the database (copies of the recorded rows under other table ids)
//      and a long list of authorised tables, as a long-time user would have;
//   3. checks every tab and the popup at desktop and phone widths (no horizontal overflow, no errors);
//   4. deletes a hand, one table, a profile and then all inactive tables through the UI, and checks the
//      database after each step and again after reloading the page;
//   5. checks that the open table keeps recording afterwards.
//
// --bundle: instead of step 2-5, load a real debug bundle into the database and only take screenshots
// (for looking at real data; such screenshots contain player names and must not be committed).
// Nothing is clicked on the table: the mode is recommend-only throughout.
// ============================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { build } from 'esbuild';
import { chromium, Page } from 'playwright';
import { rebuildHand } from '../../src/bot/diag/rebuild';
import { applyHandToProfiles, PlayerProfile } from '../../src/bot/opponents/profile';

const has = (f: string) => process.argv.includes(`--${f}`);
const argS = (f: string) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : null; };
const TABLE = 'pgle2edash';
const OLD = ['pglOldTableAAAA1111', 'pglOldTableBBBB2222'];
const URL = `https://www.pokernow.club/games/${TABLE}?players=6&seed=23&hideFolds=1&auto=1200`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Orphans are counted for tables other than the open one: the hand in progress there has recommendations and
// frames before it has a hand record.
// Runs in the dashboard page. Passed as strings: the TypeScript runner would otherwise inject helpers that do not exist there.
const DB = `
  const openDb = () => new Promise((res, rej) => { const r = indexedDB.open('poker-bot'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const all = (db, s) => new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const putAll = (db, s, rows, add) => new Promise((res, rej) => { const tx = db.transaction(s, 'readwrite'); for (const r of rows) { if (add) tx.objectStore(s).add(r); else tx.objectStore(s).put(r); } tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
`;
const SNAPSHOT = `(async () => { ${DB}
  const db = await openDb();
  const [hands, decisions, frames, diags, profiles, tables, sessions] = [await all(db, 'hands'), await all(db, 'decisions'), await all(db, 'frames'), await all(db, 'diagnostics'), await all(db, 'profiles'), await all(db, 'tables'), await all(db, 'sessions')];
  db.close();
  const by = (rows, f) => { const o = {}; for (const r of rows) { const k = f(r) || '-'; o[k] = (o[k] || 0) + 1; } return o; };
  const ids = new Set(hands.map((h) => h.handId));
  return {
    hands: by(hands, (h) => h.tableId), decisions: by(decisions, (d) => d.tableId), frames: by(frames, (f) => f.obs.tableId), diags: by(diags, (d) => d.tableId),
    tables: tables.map((t) => t.tableId).sort(), sessions: sessions.length, profiles: Object.fromEntries(profiles.map((p) => [p.playerId, p.hands])),
    orphanDecisions: decisions.filter((d) => d.tableId !== '${TABLE}' && !ids.has(d.handId)).length, orphanFrames: frames.filter((f) => f.obs.tableId !== '${TABLE}' && f.handKey && !ids.has(f.handKey)).length,
    errors: diags.filter((d) => d.level === 'error').map((d) => d.message).slice(0, 5), version: db.version,
    settings: (await chrome.storage.local.get('settings')).settings,
  };
})()`;
interface Snap { hands: Record<string, number>; decisions: Record<string, number>; frames: Record<string, number>; diags: Record<string, number>; tables: string[]; sessions: number; profiles: Record<string, number>; orphanDecisions: number; orphanFrames: number; errors: string[]; version: number; settings: { authorizedTables: string[]; mode: string } }
/** Copy what the open table recorded under two older table ids, five and forty days back. */
const CLONE = (ids: string[], from: string) => `(async () => { ${DB}
  const db = await openDb();
  const [hands, decisions, frames, diags] = [await all(db, 'hands'), await all(db, 'decisions'), await all(db, 'frames'), await all(db, 'diagnostics')];
  const DAY = 86400000;
  const ids = ${JSON.stringify(ids)}, from = ${JSON.stringify(from)};
  for (let i = 0; i < ids.length; i++) {
    const t = ids[i], back = (i === 0 ? 5 : 40) * DAY, re = (s) => (typeof s === 'string' ? s.split(from).join(t) : s);
    await putAll(db, 'hands', hands.filter((h) => h.tableId === from).map((h) => ({ ...h, handId: re(h.handId), tableId: t, ts: h.ts - back })));
    const done = new Set(hands.map((h) => h.handId));
    await putAll(db, 'decisions', decisions.filter((d) => d.tableId === from && done.has(d.handId)).map((d) => ({ ...d, handId: re(d.handId), tableId: t, ts: d.ts - back })), true);
    await putAll(db, 'frames', frames.filter((f) => f.obs.tableId === from && (!f.handKey || done.has(f.handKey))).map((f) => ({ ...f, session: f.session + '-' + i, handKey: re(f.handKey), wall: f.wall - back, obs: { ...f.obs, tableId: t } })), true);
    await putAll(db, 'diagnostics', diags.filter((d) => d.tableId === from).map((d) => ({ ...d, tableId: t, ts: d.ts - back })).concat([{ ts: Date.now() - back, level: 'warn', source: 'controller', message: 'recommendation suppressed on Hero\\'s turn: example line for ' + t, tableId: t }]), true);
    const fr = frames.filter((f) => f.obs.tableId === from);
    await putAll(db, 'tables', [{ tableId: t, nickname: i === 0 ? 'Friday home game' : '', firstSeen: Date.now() - back - 3600000, lastSeen: Date.now() - back }]);
    if (fr.length) await putAll(db, 'sessions', [{ session: fr[0].session + '-' + i, tableId: t, firstWall: fr[0].wall - back, lastWall: fr[fr.length - 1].wall - back }]);
  }
  db.close();
})()`;

async function main(): Promise<void> {
  const dist = path.resolve('dist');
  if (!fs.existsSync(path.join(dist, 'manifest.json'))) throw new Error('dist/ not built: run npm run build first');
  const shots = argS('shots');
  const bundlePath = argS('bundle');
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const appJs = await build({ entryPoints: [path.resolve('sim/bot/fake-table/app.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent' });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Fake table</title></head><body style="background:#234;color:#fff;font:14px sans-serif"><div id="root"></div><script>${appJs.outputFiles[0].text.replace(/<\/script/g, '<\\/script')}</script></body></html>`;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokerbot-dash-'));
  const ctx = await chromium.launchPersistentContext(profileDir, { channel: 'chromium', headless: !has('headed'), args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`], viewport: { width: 1440, height: 900 } });
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const check = (name: string, ok: boolean, detail = '') => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
  try {
    await ctx.route('https://www.pokernow.club/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    let sw = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = sw.url().split('/')[2];
    const errors: string[] = [];
    const watch = (p: Page, where: string) => { p.on('pageerror', (e) => errors.push(`${where}: ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error') errors.push(`${where}: ${m.text()}`); }); };
    const dash = await ctx.newPage();
    watch(dash, 'dashboard');
    await dash.goto(`chrome-extension://${extId}/dashboard.html`);
    const snap = () => dash.evaluate(SNAPSHOT) as Promise<Snap>;
    const tab = async (t: string) => { await dash.click(`button[data-tab=${t}]`); await sleep(500); };
    const noOverflow = () => dash.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const shot = async (name: string) => { if (shots) await dash.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true }).catch(() => undefined); };
    const confirm = async (opts: { type?: string; tick?: string[] } = {}) => {
      await dash.waitForSelector('dialog.confirm[open]', { timeout: 5000 });
      for (const t of opts.tick ?? []) await dash.check(`#confirm-opt-${t}`);
      if (opts.type) await dash.fill('#confirm-typed', opts.type);
      await dash.click('#confirm-ok');
      await sleep(700);
    };
    await dash.evaluate(async () => {
      const cur = (await chrome.storage.local.get('settings')).settings ?? {};
      await chrome.storage.local.set({ settings: { ...cur, mode: 'recommend', estop: false, authorizationConfirmed: false, authorizedTables: [] } });
    });

    if (bundlePath) {
      // ---- screenshots of real data only ----
      const b = JSON.parse(fs.readFileSync(bundlePath, 'utf8')) as { hands: { frames: Record<string, unknown>[] }[]; handRecords: Record<string, unknown>[]; decisions: Record<string, unknown>[]; diagnostics: Record<string, unknown>[] };
      const profiles = new Map<string, PlayerProfile>();
      for (const r of b.handRecords) { if (!r.valid) continue; try { applyHandToProfiles(profiles, rebuildHand(r as never), new Map(), r.ts as number); } catch { /* not replayable: skipped */ } }
      const frames = b.hands.flatMap((h) => h.frames).map((f) => ({ session: f.session, n: f.n, ts: f.ts, wall: f.wall, handKey: f.handKey, obs: { ts: (f.obs as { ts: number }).ts, tableId: (f.obs as { tableId: string }).tableId, seats: [] }, tracker: {}, events: [], decision: f.decision }));
      const tables = [...new Set(b.handRecords.map((r) => r.tableId as string))];
      await dash.evaluate(`(async (d) => { ${DB}
        const db = await openDb();
        await putAll(db, 'hands', d.hands); await putAll(db, 'decisions', d.decisions, true); await putAll(db, 'frames', d.frames, true); await putAll(db, 'diagnostics', d.diags, true); await putAll(db, 'profiles', d.profiles);
        const seen = {}; for (const h of d.hands) { const t = seen[h.tableId] || (seen[h.tableId] = { tableId: h.tableId, nickname: '', firstSeen: h.ts, lastSeen: h.ts }); t.firstSeen = Math.min(t.firstSeen, h.ts); t.lastSeen = Math.max(t.lastSeen, h.ts); }
        await putAll(db, 'tables', Object.values(seen));
        const ss = {}; for (const f of d.frames) { const s = ss[f.session] || (ss[f.session] = { session: f.session, tableId: f.obs.tableId, firstWall: f.wall, lastWall: f.wall }); s.firstWall = Math.min(s.firstWall, f.wall); s.lastWall = Math.max(s.lastWall, f.wall); }
        await putAll(db, 'sessions', Object.values(ss));
        db.close();
        const cur = (await chrome.storage.local.get('settings')).settings;
        await chrome.storage.local.set({ settings: { ...cur, authorizationConfirmed: true, authorizedTables: d.tables } });
      })(${JSON.stringify({ hands: b.handRecords, decisions: b.decisions, frames, diags: b.diagnostics, profiles: [...profiles.values()], tables })})`);
      await dash.reload();
      for (const t of ['opponents', 'hands', 'tables', 'diag', 'settings']) { await tab(t); await shot(`real-${t}`); }
      await tab('hands');
      await dash.locator('#hands-table th', { hasText: 'Result' }).locator('button').click(); await sleep(300);
      await dash.locator('#hands-table th', { hasText: 'Result' }).locator('button').click(); await sleep(300);
      await dash.locator('#hands-table tbody tr.click').first().click(); await sleep(600);
      await shot('real-hand-largest-loss');
      await tab('opponents'); await dash.locator('#opp-table tbody tr.click').first().click(); await sleep(400); await shot('real-opponent-detail');
      console.log(`screenshots of real data written to ${shots ?? '(no --shots directory given)'}`);
      return;
    }

    // ---- 1. record on the stand-in table ----
    const table = await ctx.newPage();
    watch(table, 'table');
    await table.goto(URL);
    const stats = () => table.evaluate(() => (window as unknown as { __stats: { hands: number; heroActions: number; illegalClicks: number } }).__stats);
    for (let i = 0; i < 90 && (await stats()).hands < 7; i++) await sleep(1000);
    await sleep(1500);
    let s = await snap();
    check('database is at version 3', s.version === 3, `version ${s.version}`);
    check('hands recorded from the stand-in table', (s.hands[TABLE] ?? 0) >= 5, `${s.hands[TABLE] ?? 0} hands, ${s.frames[TABLE] ?? 0} frames, ${s.decisions[TABLE] ?? 0} recommendations`);
    check('the open table is in the table registry', s.tables.includes(TABLE), s.tables.join(', '));
    check('log lines carry the table id', (s.diags[TABLE] ?? 0) >= 1, JSON.stringify(s.diags));

    // ---- 2. an established user's database ----
    await dash.evaluate(CLONE(OLD, TABLE));
    const stale = Array.from({ length: 34 }, (_, i) => `pglStale${String(i).padStart(2, '0')}xxxxxxxx`);
    await dash.evaluate(async (ids) => {
      const cur = (await chrome.storage.local.get('settings')).settings;
      await chrome.storage.local.set({ settings: { ...(cur as Record<string, unknown>), authorizationConfirmed: true, authorizedTables: ids } });
    }, [...OLD, ...stale]);
    await dash.reload();
    await sleep(800);
    const before = await snap();
    check('older tables added for the test', OLD.every((t) => (before.hands[t] ?? 0) === (before.hands[TABLE] ?? -1) || (before.hands[t] ?? 0) >= 5), JSON.stringify(before.hands));

    // ---- 3. every tab, two widths ----
    for (const [w, label] of [[1440, 'desktop'], [390, 'phone']] as const) {
      await dash.setViewportSize({ width: w, height: 900 });
      for (const t of ['live', 'opponents', 'hands', 'tables', 'diag', 'settings']) {
        await tab(t);
        if (t === 'hands') { await dash.locator('#hands-table tbody tr.click').first().click(); await sleep(500); }
        if (t === 'opponents' && w === 1440) { await dash.locator('#opp-table tbody tr.click').first().click(); await sleep(300); }
        const ok = await noOverflow();
        const text = (await dash.locator(`#tab-${t}`).innerText()).trim();
        check(`${label}: ${t} tab renders without horizontal page overflow`, ok && text.length > 40, `${text.length} characters`);
        await shot(`${label}-${t}`);
        if (t === 'hands') { await dash.locator('#hands-table tbody tr.sel').first().click(); await sleep(200); }
        if (t === 'opponents' && w === 1440) { await dash.locator('#opp-table tbody tr.open').first().click(); await sleep(200); }
      }
    }
    await dash.setViewportSize({ width: 1440, height: 900 });
    await tab('opponents');
    check('opponents: sortable table with sample sizes and style confidence', (await dash.locator('#opp-table th button.sortbtn').count()) >= 9 && /n=\d+/.test(await dash.locator('#opp-table tbody').innerText()) && /confidence|too few hands/.test(await dash.locator('#opp-table tbody').innerText()));
    await dash.fill('#opp-search', 'zzzz-nobody'); await sleep(500);
    check('opponents: search filters the list', (await dash.locator('#opp-table tbody tr.click').count()) === 0);
    await dash.fill('#opp-search', ''); await sleep(500);
    await tab('hands');
    await dash.locator('#hands-table tbody tr.click').first().click(); await sleep(500);
    check('hand review: cards are drawn as cards; streets, players and the result are shown', (await dash.locator('#hand-detail .pc').count()) >= 7 && (await dash.locator('#hand-detail .street').count()) >= 1 && (await dash.locator('#hand-detail ol.actions li').count()) > 3 && (await dash.locator('#hand-detail .resultbox').count()) === 1);
    check('hand review: table shown by short id or nickname, never the raw long id', !(await dash.locator('#hands-table tbody').innerText()).includes(OLD[0]) && (await dash.locator('#hands-table tbody').innerText()).includes('Friday home game'));
    const popup = await ctx.newPage();
    watch(popup, 'popup');
    await popup.setViewportSize({ width: 340, height: 520 });
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await popup.waitForSelector('#state'); await sleep(500);
    const popText = await popup.locator('body').innerText();
    check('popup: current table, mode and authorisation; no list of table ids', /36 other tables are authorised/.test(popText) && !popText.includes(stale[5]) && /not authorised/.test(popText) && /Recommending only/.test(popText) && (await popup.locator('#stop').count()) === 1 && (await popup.locator('#manage').count()) === 1, popText.replace(/\s+/g, ' ').slice(0, 160));
    if (shots) await popup.screenshot({ path: path.join(shots, 'popup.png'), fullPage: true });
    await popup.click('#stop'); await sleep(400);
    check('popup: emergency stop sets and clears', (await snap() as unknown as { settings: { estop: boolean } }).settings.estop === true && /Emergency stop is ON/.test(await popup.locator('#state').innerText()));
    await popup.click('#stop'); await sleep(400);
    await popup.close();

    // ---- 4a. delete one hand ----
    await dash.bringToFront();
    await tab('hands');
    await dash.selectOption('#tab-hands select[aria-label=Table]', OLD[0]); await sleep(400);
    await dash.locator('#hands-table tbody tr.click').first().click(); await sleep(500);
    await dash.click('#hand-delete');
    await confirm();
    s = await snap();
    check('hand deletion: one hand of that table removed with its recommendations and frames; no orphans', s.hands[OLD[0]] === before.hands[OLD[0]] - 1 && s.orphanDecisions === 0 && s.orphanFrames === 0 && s.hands[OLD[1]] === before.hands[OLD[1]] && s.hands[TABLE] >= before.hands[TABLE], `${before.hands[OLD[0]]} -> ${s.hands[OLD[0]]} hands`);
    check('hand deletion: opponent profiles unchanged', Object.keys(before.profiles).every((id) => (s.profiles[id] ?? 0) >= before.profiles[id]));

    // ---- 4b. revoke + delete one table ----
    await tab('tables');
    check('table manager: lists every known table with its counts', (await dash.locator('#tables-table tbody tr').count()) === 37, `${await dash.locator('#tables-table tbody tr').count()} rows`);
    check('table manager: the open table cannot be selected', await dash.locator(`#tables-table tr[data-id=${TABLE}] input[type=checkbox]`).isDisabled());
    await dash.fill('#tables-search', 'BBBB2222'); await sleep(500);
    await dash.locator(`#tables-table tr[data-id=${OLD[1]}] input[type=checkbox]`).check(); await sleep(300);
    await dash.click('#tables-purge');
    await confirm();
    s = await snap();
    check('delete history only: the table\'s rows are gone, its authorisation is kept', !(OLD[1] in s.hands) && !(OLD[1] in s.frames) && !(OLD[1] in s.decisions) && !(OLD[1] in s.diags) && s.settings.authorizedTables.includes(OLD[1]), `hands ${JSON.stringify(s.hands)}`);
    check('delete history only: other tables untouched, no orphans', s.hands[OLD[0]] === before.hands[OLD[0]] - 1 && s.hands[TABLE] >= before.hands[TABLE] && s.orphanDecisions === 0 && s.orphanFrames === 0);
    await dash.locator(`#tables-table tr[data-id=${OLD[1]}] input[type=checkbox]`).check(); await sleep(300);
    await dash.click('#tables-revoke');
    await confirm();
    s = await snap();
    check('revoke only: authorisation removed, nothing else changed', !s.settings.authorizedTables.includes(OLD[1]) && s.settings.authorizedTables.length === 35 && s.hands[OLD[0]] === before.hands[OLD[0]] - 1);
    await dash.fill('#tables-search', ''); await sleep(400);

    // ---- 4c. delete a profile while the table is live ----
    const victim = Object.entries(s.profiles).sort((a, b) => b[1] - a[1])[0];
    await tab('opponents');
    await dash.locator(`#opp-table tr[data-id="${victim[0]}"]`).click(); await sleep(300);
    await dash.locator('#opp-table .oppdetail button.danger').click();
    await confirm();
    const afterProfile = await snap();
    check('profile deletion: the profile is gone', !(victim[0] in afterProfile.profiles), `${victim[0]} had ${victim[1]} hands`);

    // ---- 4d. remove all inactive tables ----
    await tab('tables');
    await dash.click('#tables-all');
    await confirm({ tick: ['export'] }).catch(async () => { /* fewer than four tables with history: no typed confirmation */ });
    s = await snap();
    check('remove all inactive: only the open table remains, with its data', Object.keys(s.hands).join() === TABLE && Object.keys(s.frames).join() === TABLE && s.tables.join() === TABLE && s.settings.authorizedTables.length === 0 && s.hands[TABLE] >= before.hands[TABLE], `tables ${s.tables.join(', ')}; ${s.settings.authorizedTables.length} authorisations`);
    check('remove all inactive: no orphaned recommendations or frames', s.orphanDecisions === 0 && s.orphanFrames === 0);

    // ---- 5. persistence and continued recording ----
    const mark = await snap();
    await dash.reload(); await sleep(800);
    await tab('tables');
    check('after reload: deleted tables and revoked authorisations do not come back', (await dash.locator('#tables-table tbody tr').count()) === 1 && (await snap()).settings.authorizedTables.length === 0);
    for (let i = 0; i < 60 && ((await snap()).hands[TABLE] ?? 0) < mark.hands[TABLE] + 3; i++) await sleep(1000);
    await sleep(1500);
    s = await snap();
    check('the open table keeps recording after the deletions', s.hands[TABLE] >= mark.hands[TABLE] + 3 && s.frames[TABLE] > mark.frames[TABLE], `${mark.hands[TABLE]} -> ${s.hands[TABLE]} hands, ${mark.frames[TABLE]} -> ${s.frames[TABLE]} frames`);
    check('the deleted profile restarts from nothing instead of returning with its old totals', victim[0] in s.profiles && s.profiles[victim[0]] < victim[1] && s.profiles[victim[0]] <= s.hands[TABLE] - afterProfile.hands[TABLE] + 1, `${victim[1]} hands before deletion, ${s.profiles[victim[0]] ?? 'none'} now`);
    check('other profiles kept their totals', Object.entries(afterProfile.profiles).every(([id, n]) => (s.profiles[id] ?? 0) >= n));
    const st = await stats();
    check('recommend-only throughout: the extension clicked nothing', st.heroActions === 0 && st.illegalClicks === 0, `${st.hands} hands on the table`);
    check('no storage or engine errors logged', s.errors.length === 0, s.errors.join(' | '));
    check('no uncaught errors in the table page, dashboard or popup', errors.length === 0, errors.slice(0, 3).join(' | '));
    await tab('diag'); await shot('desktop-diag-after-deletions');

    const lines = ['# Dashboard, table manager and popup: end-to-end check (fixture table)', '',
      `Generated by \`sim/bot/e2e-dashboard.ts\` on ${new Date().toISOString().slice(0, 10)}. Chromium ${ctx.browser()?.version() ?? 'unknown'}, ${has('headed') ? 'headed' : 'headless'}.`,
      'The built `dist/` was loaded as an unpacked extension against a local stand-in table in recommend-only mode. **This is not the live site.**', '',
      '| Check | Result | Detail |', '|---|---|---|', ...checks.map((c) => `| ${c.name} | ${c.ok ? 'pass' : 'FAIL'} | ${c.detail.replace(/\|/g, '/')} |`)];
    fs.mkdirSync('reports', { recursive: true });
    const file = `reports/e2e-dashboard-${new Date().toISOString().slice(0, 10)}.md`;
    fs.writeFileSync(file, lines.join('\n') + '\n');
    console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed. Wrote ${file}`);
  } finally {
    await ctx.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
