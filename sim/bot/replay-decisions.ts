// ============================================================
// Re-run the strategy engine on Hero's decision points in recorded hands.
//
//   npx tsx sim/bot/replay-decisions.ts <bundle.json | fixture.json> [--hand N] [--street flop] [--samples 4000] [--recorded]
//
// For every recorded hand that can be rebuilt by the rules engine, each point
// where Hero was to act is reconstructed and the CURRENT engine is asked for a
// decision. With --recorded the decision stored in the bundle at recording
// time is printed next to it. Opponent profiles are NOT restored (the bundle
// holds no profiles), so the re-run uses neutral opponent tendencies.
// ============================================================

import * as fs from 'fs';
import { BotAgent } from '../../src/bot/agent';
import { cardsStr } from '../../src/bot/cards';
import { rebuildHand, RecordedHand, recordedHeroCards } from '../../src/bot/diag/rebuild';
import { potTotal } from '../../src/bot/table/engine';
import type { Decision } from '../../src/bot/strategy/types';

const arg = (f: string) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const file = process.argv[2];
if (!file) { console.error('usage: replay-decisions <bundle.json> [--hand N] [--street s] [--samples N] [--recorded]'); process.exit(2); }
const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { handRecords?: RecordedHand[]; hands?: RecordedHand[]; decisions?: { handId: string; eventCount: number; decision: Decision }[] };
const records = (data.handRecords ?? data.hands ?? []).filter((r) => Array.isArray(r.events));
const samples = Number(arg('samples') ?? 4000);
const onlyHand = arg('hand'), onlyStreet = arg('street');
const short = (id: string) => id.split(':')[2] ?? id;

const line = (d: Decision) => `${d.label}  [${d.candidates.map((c) => `${c.label} ${c.ev === null ? '' : c.ev.toFixed(1)}${c.freq > 0.005 ? ` f${(100 * c.freq).toFixed(0)}%` : ''}`).join(' | ')}]`;

for (const rec of records) {
  if (onlyHand && short(rec.handId) !== onlyHand) continue;
  const hero = recordedHeroCards(rec);
  if (rec.heroSeat === null || !hero) continue;
  const points = rec.events.filter((e) => e.seat === rec.heroSeat && !e.kind.startsWith('post'));
  for (const e of points) {
    if (onlyStreet && e.street !== onlyStreet) continue;
    let h;
    try { h = rebuildHand(rec, e.seq); } catch (err) { console.log(`hand ${short(rec.handId)}: cannot rebuild (${(err as Error).message})`); break; }
    if (h.toAct !== rec.heroSeat) continue;
    const pos = h.seats.find((s) => s.seat === rec.heroSeat)!.pos!.label;
    const d = new BotAgent({ seed: 7 }).decideSync(h, rec.heroSeat, hero, samples);
    console.log(`hand ${short(rec.handId)} #${e.seq} ${h.street} ${pos} ${cardsStr(hero)} | ${cardsStr(h.board)} | pot ${potTotal(h)} | Hero actually: ${e.kind}${e.kind === 'bet' || e.kind === 'raise' ? ` ${e.to}` : ''}`);
    console.log(`   now:      ${line(d)}`);
    for (const b of d.basis) console.log(`             ${b}`);
    if (process.argv.includes('--recorded')) {
      const r = data.decisions?.find((x) => x.handId === rec.handId && x.eventCount === e.seq);
      console.log(`   recorded: ${r ? line(r.decision) : '(none stored)'}`);
    }
  }
}
