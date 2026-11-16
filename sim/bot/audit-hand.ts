// ============================================================
// Frame-by-frame view of one recorded hand from a debug bundle, next to the stored summary:
// what the table showed (stacks, bets, pot, board, acting seat) and what the reconstruction did with it.
//
//   npx tsx sim/bot/audit-hand.ts <bundle.json> <table:h:number as printed by audit-bundle, e.g. T7:h:58> [--names] [--replay]
//
// --replay re-runs the current tracker over the session up to this hand and prints its issues and final state.
// Names are replaced by placeholders unless --names is given.
// ============================================================

import * as fs from 'fs';
import { TableObs } from '../../src/bot/adapter/observation';
import { HandTracker } from '../../src/bot/adapter/tracker';
import { cardStr } from '../../src/bot/cards';
import { parseBundle } from '../../src/bot/diag/recorder';
import type { DecisionRecord, HandRecord } from '../../src/bot/ext/records';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (f: string) => process.argv.includes(`--${f}`);
if (args.length < 2) { console.error('usage: npx tsx sim/bot/audit-hand.ts <bundle.json> <T7:h:58> [--names] [--replay]'); process.exit(2); }
const bundle = parseBundle(JSON.parse(fs.readFileSync(args[0], 'utf8').trimStart()));
const frames = bundle.hands.flatMap((h) => h.frames).sort((a, b) => a.wall - b.wall || a.n - b.n);
const alias = new Map<string, string>();
[...new Set(frames.map((f) => f.obs.tableId))].forEach((t, i) => alias.set(t, `T${i + 1}`));
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
const stem = (id: string) => anon(id).replace(/:[\d.]+$/, '');

const want = args[1];
const key = [...new Set(frames.map((f) => f.handKey).filter((k): k is string => !!k))].find((k) => stem(k) === want);
if (!key) { console.error(`no recorded hand ${want}`); process.exit(2); }
const rec = (bundle.handRecords as HandRecord[]).find((r) => r.handId === key);
const mine = frames.filter((f) => f.handKey === key);
const session = mine[0].session;
// Include the frames just after the hand (until the next hand key appears) to see the pay-out.
const sess = frames.filter((f) => f.session === session).sort((a, b) => a.n - b.n);
const lastN = mine[mine.length - 1].n;
const after = sess.filter((f) => f.n > lastN).slice(0, 6);

if (rec) {
  console.log(`Stored summary ${stem(rec.handId)}: blinds ${rec.smallBlind}/${rec.bigBlind}, valid=${rec.valid}, observedToEnd=${rec.observedToEnd}, showdown=${rec.wentToShowdown}, heroNet=${rec.heroNet}, hero ${rec.heroCards?.join(' ') ?? '?'}, board ${rec.board.join(' ') || '-'}`);
  for (const s of rec.seats) console.log(`  seat ${s.seat} ${anon(s.name)} ${s.position ?? '-'} ${s.dealtIn ? '' : '(not dealt) '}start ${s.startStack} end ${s.endStack} (${s.endStack - s.startStack >= 0 ? '+' : ''}${Math.round((s.endStack - s.startStack) * 100) / 100})${s.folded ? ' folded' : ''}${s.shown ? ` shows ${s.shown.join(' ')}` : ''}`);
  let street = '';
  for (const e of rec.events) {
    if (e.street !== street) { street = e.street; console.log(`  -- ${street} (pot ${e.potBefore})`); }
    console.log(`  ${e.seq}. seat ${e.seat} ${e.kind}${e.kind === 'bet' || e.kind === 'raise' ? ` to ${e.to}` : e.amount ? ` ${e.amount}` : ''}${e.allIn ? ' all-in' : ''} [${e.source ?? '?'}${e.uncertain ? ', UNCONFIRMED' : e.inferred ? ', deduced' : ''}]`);
  }
  const ds = (bundle.decisions as DecisionRecord[]).filter((d) => d.handId === key);
  for (const d of ds) console.log(`  recommendation at event ${d.eventCount}: ${d.decision.label}${d.execution ? ` -> ${d.execution.status} (${d.execution.reason})` : ' (shown only)'}; pot ${d.pot}; ${d.decision.candidates.map((c) => `${c.label} ev ${c.ev === null ? '-' : c.ev.toFixed(1)} f ${(100 * c.freq).toFixed(0)}%`).join(' | ')}`);
} else console.log(`No stored summary for ${want}.`);

console.log('\nFrames (n: board | pot | actor shown/engine | seats as stack+bet, f=folded, c=cards, x=sitting out, *=hero) -> reconstruction');
const show = (o: TableObs) => o.seats.map((s) => `${s.seat}${s.isHero ? '*' : ''}:${s.stack ?? '?'}+${s.bet}${s.folded ? 'f' : ''}${s.hasCards ? 'c' : ''}${s.sittingOut ? 'x' : ''}${s.shownCards ? `[${s.shownCards.map(cardStr).join('')}]` : ''}`).join(' ');
let prev = '';
for (const f of [...mine, ...after]) {
  const o = f.obs as TableObs;
  const line = `${o.board.map(cardStr).join('') || '-'} | pot ${o.pot ?? '?'} | ${o.toActSeat ?? '-'}/${f.tracker.predictedActor ?? '-'}${o.heroToAct ? ' HERO' : ''} | ${show(o)}`;
  const t = f.tracker;
  const ev = f.events.map((e) => anon(e.text) + (e.uncertain ? '??' : e.inferred ? '*' : '')).join(', ');
  const tail = `${f.handKey === key ? '' : `(${f.handKey ? stem(f.handKey) : 'no hand'}) `}${t.phase}/${t.street ?? '-'} valid=${t.valid}${ev ? ` + ${ev}` : ''}${t.blockers.length ? ` BLOCK: ${anon(t.blockers.join(' | '))}` : ''}${t.warnings.length ? ` warn: ${anon(t.warnings.join(' | '))}` : ''}${f.decision.state !== 'none' ? ` rec=${f.decision.state}${f.decision.label ? `(${f.decision.label})` : ''}${f.decision.reason ? ` "${anon(f.decision.reason).slice(0, 90)}"` : ''}` : ''}`;
  console.log(`${f.n}: ${line === prev ? '(table unchanged)' : line}\n      -> ${tail}`);
  prev = line;
}

if (flag('replay')) {
  const tr = new HandTracker();
  let issues: string[] = [];
  for (const f of sess) {
    if (f.n > lastN + 6) break;
    const done = tr.ingest(f.obs as TableObs);
    if (tr.state.hand && stem(tr.state.hand.handId) === want) issues = tr.state.issues.slice();
    for (const c of done) if (stem(c.hand.handId) === want) console.log(`\nReplay with the current code: valid=${c.valid}, observedToEnd=${c.observedToEnd}, phase ${c.hand.phase}; stack changes ${c.hand.seats.filter((s) => s.dealtIn).map((s) => `${s.seat}:${Math.round((s.stack - s.startStack) * 100) / 100}`).join(' ')}`);
  }
  console.log(`Tracker messages in replay:\n${issues.map((i) => `  ${anon(i)}`).join('\n') || '  none'}`);
}
