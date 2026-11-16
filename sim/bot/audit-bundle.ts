// ============================================================
// Audit of a debug bundle: what was recorded, what the stored hand summaries say, and what the CURRENT
// reconstruction makes of the same observations.
//
//   npx tsx sim/bot/audit-bundle.ts <bundle.json> [--names] [--hand <substring of hand id>] [--all]
//
// Player names and table ids are replaced by stable placeholders unless --names is given, so the output can
// be quoted in a committed document. Nothing is uploaded; the bundle is only read.
// ============================================================

import * as fs from 'fs';
import { TableObs } from '../../src/bot/adapter/observation';
import { HandTracker } from '../../src/bot/adapter/tracker';
import { parseBundle } from '../../src/bot/diag/recorder';
import type { DecisionRecord, HandRecord } from '../../src/bot/ext/records';
import { toHandRecord, toStackCheck } from '../../src/bot/ext/records';
import { chipImbalance, handStatus, heroCommitted, heroResult } from '../../src/bot/ext/viewmodel';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--hand');
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
if (!file) { console.error('usage: npx tsx sim/bot/audit-bundle.ts <bundle.json> [--names] [--hand id] [--all]'); process.exit(2); }
const bundle = parseBundle(JSON.parse(fs.readFileSync(file, 'utf8').trimStart()));
const frames = bundle.hands.flatMap((h) => h.frames).sort((a, b) => a.wall - b.wall || a.n - b.n);
const records = bundle.handRecords as HandRecord[];
const decisions = bundle.decisions as DecisionRecord[];

// ---- placeholders ----
const alias = new Map<string, string>();
const tables = [...new Set(frames.map((f) => f.obs.tableId))];
tables.forEach((t, i) => alias.set(t, `T${i + 1}`));
let np = 0;
for (const f of frames) for (const s of f.obs.seats) if (s.name && !alias.has(s.name)) alias.set(s.name, s.isHero ? 'Hero' : `P${++np}`);
const keys = [...alias.keys()].sort((a, b) => b.length - a.length);
const WORD = /[A-Za-z0-9_]/;
/** Replace names and table ids by their placeholders, whole words only (a player called "ch" must not rewrite "check"). */
function anon(s: string): string {
  if (process.argv.includes('--names')) return s;
  let o = s;
  for (const k of keys) {
    let from = 0;
    for (let i = o.indexOf(k, from); i >= 0; i = o.indexOf(k, from)) {
      const whole = !WORD.test(o[i - 1] ?? ' ') && !WORD.test(o[i + k.length] ?? ' ');
      const to = alias.get(k) as string;
      if (whole) { o = o.slice(0, i) + to + o.slice(i + k.length); from = i + to.length; } else from = i + k.length;
    }
  }
  return o;
}
const hid = (id: string | null) => (id ? anon(id).replace(/:[\d.]+$/, '') : 'none');
const stem = (id: string) => id.split(':').slice(0, 3).join(':');

// ---- replay every recording session with the current tracker ----
interface Replayed { rec: HandRecord; firstInvalid: { n: number; issue: string } | null; session: string; why: string | null }
const replayed = new Map<string, Replayed>();
const sessions = [...new Set(frames.map((f) => f.session))];
const perSession: { session: string; table: string; frames: number; start: number; end: number; gaps: number }[] = [];
for (const s of sessions) {
  const fs2 = frames.filter((f) => f.session === s).sort((a, b) => a.n - b.n);
  let gaps = 0;
  for (let i = 1; i < fs2.length; i++) if (fs2[i].n !== fs2[i - 1].n + 1) gaps++;
  perSession.push({ session: s, table: alias.get(fs2[0].obs.tableId) as string, frames: fs2.length, start: fs2[0].wall, end: fs2[fs2.length - 1].wall, gaps });
  const liveKeys = new Map<string, string>();
  for (const f of fs2) if (f.handKey) liveKeys.set(stem(f.handKey), f.handKey);
  const tr = new HandTracker();
  let firstInvalid: { n: number; issue: string } | null = null, curId: string | null = null, why: string | null = null;
  for (const f of fs2) {
    const done = tr.ingest(f.obs as TableObs);
    for (const k of tr.takeResultChecks()) { const key = liveKeys.get(stem(k.handId)) ?? k.handId; const r = replayed.get(key); if (r) r.rec.stackCheck = toStackCheck(k); }
    for (const c of done) replayed.set(liveKeys.get(stem(c.hand.handId)) ?? c.hand.handId, { rec: toHandRecord(c, f.obs.tableId, f.wall), firstInvalid: c.valid ? null : firstInvalid, session: s, why: c.valid ? null : why ?? (c.meta?.some((m) => m.uncertain) ? `an unconfirmed deduction (${c.meta.find((m) => m.uncertain)?.source})` : c.observedToEnd ? null : 'ending not observed') });
    const st = tr.state;
    const id = st.hand?.handId ?? null;
    if (id !== curId) { curId = id; firstInvalid = null; why = null; }
    // The same test the tracker applies after every observation (a stack it cannot account for), with its context.
    if (st.hand && st.valid && st.hand.phase !== 'complete' && !why) {
      for (const o of f.obs.seats) {
        const e = st.hand.seats.find((x) => x.seat === o.seat);
        if (!e || !e.dealtIn || o.stack === null) continue;
        if (Math.abs(e.stack - o.stack) > 0.011 && Math.abs(e.stack + e.streetCommit - (o.stack + o.bet)) > 0.011) {
          const live = st.hand.seats.filter((x) => x.dealtIn && !x.folded);
          const others = Math.max(0, ...live.filter((x) => x.seat !== e.seat).map((x) => x.totalCommit));
          const refund = Math.max(0, e.totalCommit - others);
          const diff = Math.round((o.stack - e.stack) * 100) / 100;
          why = `stack not explained in phase ${st.hand.phase}${st.hand.toAct === null ? ' (no one to act)' : ''}: ${e.folded ? 'folded seat' : e.allIn ? 'all-in seat' : 'live seat'} shows ${diff > 0 ? '+' : ''}${diff}${refund > 0 && Math.abs(diff - refund) <= 0.011 ? ' = its uncalled bet returned' : diff > 0 && st.hand.toAct === null ? ' (pot paid before the engine settled?)' : ''}`;
          break;
        }
      }
      const fc = st.issues.find((i) => /folded with a free check/.test(i));
      if (!why && fc) why = 'a seat folded with a free check available';
    }
    if (st.hand && !st.valid && !firstInvalid) firstInvalid = { n: f.n, issue: st.issues.filter((i) => i.startsWith('INVALID')).pop() ?? st.issues[st.issues.length - 1] ?? '?' };
  }
}

// ---- report ----
const fmt = (ts: number) => new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
console.log(`Bundle exported ${bundle.exportedAt} by extension ${bundle.build.extensionVersion}; mode ${String(bundle.settings.mode)}.`);
console.log(`${frames.length} frames, ${bundle.hands.length} recorded hands, ${records.length} hand summaries, ${decisions.length} stored recommendations, ${bundle.diagnostics.length} log lines.`);
console.log(`Dropped: pruned ${bundle.dropped.framesPrunedFromStorage}, before storage ${bundle.dropped.framesDroppedBeforeStorage}, sequence gaps ${bundle.dropped.sequenceGaps}.\n`);
console.log('| Session | Table | Start (UTC) | Minutes | Frames | Sequence gaps | Hands recorded | Summaries | Valid live | Valid now |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const s of perSession) {
  const keysIn = new Set(frames.filter((f) => f.session === s.session && f.handKey).map((f) => f.handKey as string));
  const recs = records.filter((r) => keysIn.has(r.handId));
  const now = [...replayed.values()].filter((v) => v.session === s.session);
  console.log(`| ${perSession.indexOf(s) + 1} | ${s.table} | ${fmt(s.start)} | ${Math.round((s.end - s.start) / 60000)} | ${s.frames} | ${s.gaps} | ${keysIn.size} | ${recs.length} | ${recs.filter((r) => r.valid).length} | ${now.filter((v) => v.rec.valid).length} of ${now.length} |`);
}

const cat = (r: HandRecord) => handStatus(r).kind;
const count = (rs: HandRecord[]) => { const o: Record<string, number> = {}; for (const r of rs) o[cat(r)] = (o[cat(r)] ?? 0) + 1; return o; };
console.log(`\nStored summaries by status: ${JSON.stringify(count(records))}`);
console.log(`Same recording rebuilt by the current code: ${JSON.stringify(count([...replayed.values()].map((v) => v.rec)))} (${replayed.size} hands completed in replay)`);
const sumBB = (rs: HandRecord[], pred: (r: HandRecord) => boolean) => rs.filter((r) => pred(r) && r.heroNet !== null).reduce((a, r) => a + (heroResult(r) as number) / r.bigBlind, 0);
const nBB = (rs: HandRecord[], pred: (r: HandRecord) => boolean) => rs.filter((r) => pred(r) && r.heroNet !== null).length;
console.log(`Hero result, stored: valid hands ${sumBB(records, (r) => r.valid).toFixed(1)} bb over ${nBB(records, (r) => r.valid)}; verified (valid and chips add up) ${sumBB(records, (r) => cat(r) === 'verified').toFixed(1)} bb over ${nBB(records, (r) => cat(r) === 'verified')}; every hand with a number ${sumBB(records, () => true).toFixed(1)} bb over ${nBB(records, () => true)}.`);
const now = [...replayed.values()].map((v) => v.rec);
const checks: Record<string, number> = {};
for (const r of now) { const k = r.stackCheck?.status ?? 'no following hand seen'; checks[k] = (checks[k] ?? 0) + 1; }
console.log(`Next-hand stack check of the rebuilt hands: ${JSON.stringify(checks)}`);
for (const [k, v] of replayed) if (v.rec.stackCheck && ['awarded-differently', 'unexplained'].includes(v.rec.stackCheck.status)) console.log(`  ${hid(k)}: ${v.rec.stackCheck.status}: ${anon(v.rec.stackCheck.note)}`);
console.log(`Hero result, rebuilt now: verified ${sumBB(now, (r) => cat(r) === 'verified').toFixed(1)} bb over ${nBB(now, (r) => cat(r) === 'verified')}.`);

const reasons: Record<string, number> = {};
for (const v of replayed.values()) {
  if (v.rec.valid) continue;
  const k = (v.firstInvalid?.issue ?? v.why ?? (v.rec.observedToEnd ? 'invalid, cause not identified' : 'ending not observed')).replace(/[+-]?\d+(\.\d+)?/g, 'N').slice(0, 150);
  reasons[anon(k)] = (reasons[anon(k)] ?? 0) + 1;
}
console.log('\nWhy hands are not valid in the replay (numbers replaced by N):');
for (const [k, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${n} x ${k}`);

console.log('\n| Hand | Stored: status | Stored net (bb) | Hero put in (bb) | Chip imbalance | Now: status | Now net (bb) | First problem in replay |');
console.log('|---|---|---|---|---|---|---|---|');
const only = opt('hand');
for (const r of records.sort((a, b) => a.ts - b.ts)) {
  const v = replayed.get(r.handId);
  const interesting = args.includes('--all') || cat(r) !== 'verified' || (v && cat(v.rec) !== 'verified') || (r.heroNet !== null && Math.abs(r.heroNet / r.bigBlind) >= 80) || !v;
  if (only ? !r.handId.includes(only) : !interesting) continue;
  const bb = (x: number | null) => (x === null ? '–' : (x / r.bigBlind).toFixed(1));
  console.log(`| ${hid(r.handId)} | ${cat(r)} | ${bb(r.heroNet)} | ${bb(heroCommitted(r))} | ${chipImbalance(r) ?? '–'} | ${v ? cat(v.rec) : 'not completed in replay'} | ${v ? bb(heroResult(v.rec)) : '–'} | ${v?.firstInvalid ? `frame ${v.firstInvalid.n}: ${anon(v.firstInvalid.issue).slice(0, 150)}` : anon(v?.why ?? '')} |`);
}
// Independent check of the results: Hero's stack at the end of each rebuilt hand against the stack the table
// shows when the next hand of the same session starts. A difference is a top-up or re-buy between hands, or an error.
console.log('');
console.log('Hero stack continuity (rebuilt hand end -> next hand start, same session):');
let links = 0, same = 0;
const jumps: string[] = [];
for (const s of sessions) {
  const hs = [...replayed.entries()].filter(([, v]) => v.session === s).map(([k, v]) => ({ k, r: v.rec })).sort((x, y) => x.r.ts - y.r.ts);
  for (let i = 0; i + 1 < hs.length; i++) {
    const a = hs[i].r, b = hs[i + 1].r;
    const ea = a.seats.find((x) => x.seat === a.heroSeat), sb = b.seats.find((x) => x.seat === b.heroSeat);
    if (!ea || !sb || a.heroNet === null) continue;
    links++;
    const d = Math.round((sb.startStack - (ea.startStack + (heroResult(a) as number))) * 100) / 100;
    if (Math.abs(d) <= 0.011) same++; else jumps.push(`${hid(hs[i].k)} -> ${hid(hs[i + 1].k)}: ${d > 0 ? '+' : ''}${d} chips (${cat(a)})`);
  }
}
console.log(`  ${same} of ${links} consecutive pairs agree exactly.${jumps.length ? ' Differences:' : ''}`);
for (const j of jumps) console.log(`  ${j}`);

const unrecorded = [...new Set(frames.map((f) => f.handKey).filter((k): k is string => !!k))].filter((k) => !records.some((r) => r.handId === k));
console.log(`\nRecorded hands with frames but no stored summary: ${unrecorded.length}${unrecorded.length ? ` (${unrecorded.slice(0, 40).map(hid).join(', ')})` : ''}`);

// Reasons a result could not be cross-checked.
const un: Record<string, number> = {};
for (const v of replayed.values()) if (v.rec.stackCheck?.status === 'unavailable') { const k = anon(v.rec.stackCheck.note).replace(/\d+/g, 'N'); un[k] = (un[k] ?? 0) + 1; }
if (Object.keys(un).length) { console.log('\nWhy a result could not be cross-checked with the next hand:'); for (const [k, n] of Object.entries(un)) console.log(`  ${n} x ${k}`); }

// Frames in which the page showed no chip amounts at all.
const blind = frames.filter((f) => f.obs.pot === null && f.obs.seats.length > 0 && f.obs.seats.every((x) => x.stack === null));
console.log(`\nFrames with no readable chip amounts (pot and every stack unreadable): ${blind.length} of ${frames.length}${blind.length ? `, in ${new Set(blind.map((f) => f.session)).size} session(s)` : ''}.`);

// Hero's decisions in the stored summaries against the stored recommendations.
let heroActs = 0, withRec = 0, followed = 0, executed = 0;
const missingWhy: Record<string, number> = {};
const differs: string[] = [];
for (const r of records) {
  for (const e of r.events) {
    if (e.seat !== r.heroSeat || e.kind.startsWith('post')) continue;
    if (e.inferred) continue; // not an action Hero was seen to take
    heroActs++;
    const ds = decisions.filter((d) => d.handId === r.handId && d.eventCount === e.seq).sort((x, y) => x.ts - y.ts);
    const d = ds[ds.length - 1];
    if (!d) {
      // What the recorder showed at that decision point.
      const fr = frames.filter((f) => f.handKey === r.handId && f.tracker.eventCount === e.seq && f.obs.heroToAct);
      const st = fr.find((f) => f.decision.state === 'blocked') ?? fr[fr.length - 1];
      const k = !fr.length ? 'Hero\'s turn was never recorded at that point (acted between two reads)' : st.decision.state === 'blocked' ? `blocked: ${anon(st.decision.reason ?? '?').replace(/\d+(\.\d+)?/g, 'N').slice(0, 90)}` : `state "${st.decision.state}" (${anon(st.decision.reason ?? 'no reason').replace(/\d+(\.\d+)?/g, 'N').slice(0, 70)})`;
      const kk = `${hid(r.handId)} ${e.street}: ${k}`;
      missingWhy[kk] = (missingWhy[kk] ?? 0) + 1;
      continue;
    }
    withRec++;
    if (d.execution) executed++;
    const same = d.decision.action === e.kind && (!(e.kind === 'bet' || e.kind === 'raise') || Math.abs((d.decision.to ?? e.to) - e.to) < 0.011);
    if (same) followed++; else differs.push(`${hid(r.handId)} ${e.street}: recommended ${d.decision.label}, played ${e.kind}${e.kind === 'bet' || e.kind === 'raise' ? ` to ${e.to}` : e.amount ? ` ${e.amount}` : ''}${d.execution ? ` [executor: ${d.execution.status}]` : ' [shown only]'}`);
  }
}
console.log(`\nHero actions in the stored summaries: ${heroActs}; with a stored recommendation ${withRec} (${executed} of them carried out by the executor); played as recommended ${followed}; played differently ${differs.length}; no recommendation stored ${heroActs - withRec}.`);
for (const [k, n] of Object.entries(missingWhy).sort((x, y) => y[1] - x[1])) console.log(`  no recommendation, ${n} x ${k}`);
for (const d of differs) console.log(`  differs: ${d}`);
