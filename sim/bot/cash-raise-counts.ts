// ============================================================
// Phase 2.4: what a recorded cash session can say about responses to bets and raises after the flop.
//
//   npx tsx sim/bot/cash-raise-counts.ts debug_bundles/<cash bundle>.json [--samples 600]
//
// 1. Every bet or raise after the flop by ANY player and the responses of the players facing it (fold / call /
//    raise), split by situation: facing a bet, facing a raise of one's own bet, facing a check-raise, facing a
//    third bet or more; heads-up and multiway separately. Beta(1,1) 90% intervals.
// 2. For Hero's heads-up bets and raises: version 3's own predicted response probability for the whole range at the
//    action Hero actually took (no player profile, population model), against what followed. This is the residual
//    calibration data version 3 would use (model.ts CALIB_GRID).
// Output is anonymised: counts only. Tournament bundles must not be passed (cash priors only).
// ============================================================

import * as fs from 'fs';
import { BotAgent } from '../../src/bot/agent';
import { rebuildHand, RecordedHand, recordedHeroCards } from '../../src/bot/diag/rebuild';
import type { HandRecord } from '../../src/bot/ext/records';
import type { HandState } from '../../src/bot/table/engine';

const file = process.argv[2];
const argS = (f: string, d: string) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : d; };
const samples = Number(argS('samples', '600'));
const b = JSON.parse(fs.readFileSync(file, 'utf8')) as { handRecords: HandRecord[] };

// Beta(1,1) posterior 90% interval by normal approximation on the posterior (adequate for a table of counts).
const iv = (k: number, n: number) => { const a = k + 1, bb = n - k + 1, m = a / (a + bb), sd = Math.sqrt(a * bb / ((a + bb) ** 2 * (a + bb + 1))); return `${k}/${n}: ${(100 * m).toFixed(0)}% (${(100 * Math.max(0, m - 1.645 * sd)).toFixed(0)}–${(100 * Math.min(1, m + 1.645 * sd)).toFixed(0)}%)`; };

type Sit = 'facing a bet' | 'own bet raised' | 'facing a check-raise' | 'facing a third bet or more';
const tally = new Map<string, { n: number; fold: number; call: number; raise: number }>();
const add = (k: string, kind: string) => { const t = tally.get(k) ?? { n: 0, fold: 0, call: 0, raise: 0 }; t.n++; if (kind === 'fold') t.fold++; else if (kind === 'call') t.call++; else if (kind === 'raise' || kind === 'bet') t.raise++; tally.set(k, t); };
const heroRows: { sit: string; predicted: number; happened: boolean; what: string }[] = [];
let hands = 0;

for (const rec of [...b.handRecords].sort((x, y) => x.ts - y.ts)) {
  if (!rec.valid || !rec.observedToEnd) continue;
  let full: HandState;
  try { full = rebuildHand(rec as unknown as RecordedHand); } catch { continue; }
  hands++;
  const ev = full.events;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (e.street === 'preflop' || (e.kind !== 'bet' && e.kind !== 'raise')) continue;
    const street = ev.filter((x, j) => j <= i && x.street === e.street && !x.kind.startsWith('post'));
    const level = street.filter((x) => x.kind === 'bet' || x.kind === 'raise').length;
    const raiserChecked = street.some((x) => x.seat === e.seat && x.kind === 'check');
    // Live players at this point (not folded before i).
    const folded = new Set(ev.slice(0, i).filter((x) => x.kind === 'fold').map((x) => x.seat));
    const live = full.seats.filter((s) => s.dealtIn && !folded.has(s.seat)).length;
    const shape = live <= 2 ? 'heads-up' : 'multiway';
    // Each player's first action after e on the same street, until the next bet or raise.
    const seen = new Set<number>();
    for (let j = i + 1; j < ev.length; j++) {
      const r = ev[j];
      if (r.street !== e.street) break;
      if (r.seat === e.seat || seen.has(r.seat) || r.kind.startsWith('post')) { if (r.kind === 'bet' || r.kind === 'raise') break; continue; }
      seen.add(r.seat);
      const ownBet = street.some((x) => x.seat === r.seat && (x.kind === 'bet' || x.kind === 'raise'));
      const sit: Sit = level >= 3 ? 'facing a third bet or more' : raiserChecked && level >= 2 ? 'facing a check-raise' : ownBet ? 'own bet raised' : raiserChecked ? 'facing a check-raise' : 'facing a bet';
      add(`${sit} | ${shape}`, r.kind);
      if (r.kind === 'raise' || r.kind === 'bet') break;
    }
    // Hero's heads-up bets and raises: version 3's own prediction for the action Hero took.
    if (e.seat === rec.heroSeat && shape === 'heads-up') {
      const hero = recordedHeroCards(rec as unknown as RecordedHand);
      if (!hero) continue;
      let h: HandState;
      try { h = rebuildHand(rec as unknown as RecordedHand, e.seq); } catch { continue; }
      if (h.toAct !== rec.heroSeat) continue;
      let curve: { key: string; predicted: number[] } | null = null;
      const agent = new BotAgent({
        seed: 7, engine: 'v3', v3Sensitivity: false,
        onV3Search: (s) => {
          let best = -1, gap = Infinity;
          s.specs.forEach((sp, k) => { if (sp.action === e.kind && Math.abs(sp.to - e.to) < gap) { gap = Math.abs(sp.to - e.to); best = k; } });
          curve = best >= 0 ? s.calibCurve(best) : null;
        },
      });
      try { agent.decideSync(h, rec.heroSeat!, hero, samples); } catch { continue; }
      const c = curve as { key: string; predicted: number[] } | null;
      if (!c) continue;
      const resp = ev.slice(i + 1).find((x) => x.seat !== e.seat && !x.kind.startsWith('post'));
      if (!resp) continue;
      const neutral = c.key === 'raiseVsBet' ? 6 : 4;
      heroRows.push({ sit: c.key, predicted: c.predicted[neutral], happened: c.key === 'raiseVsBet' ? resp.kind === 'raise' : resp.kind === 'fold', what: resp.kind });
    }
  }
}

console.log(`## Responses to bets and raises after the flop: ${hands} rebuilt cash hands\n`);
console.log('Each cell: count / responses, Beta(1,1) posterior mean and 90% interval (each column on its own, so the means need not add up to 100%).\n');
console.log('| Situation | Shape | Responses | Fold | Call | Raise |');
console.log('|---|---|---|---|---|---|');
for (const [k, t] of [...tally.entries()].sort()) { const [sit, shape] = k.split(' | '); console.log(`| ${sit} | ${shape} | ${t.n} | ${iv(t.fold, t.n)} | ${iv(t.call, t.n)} | ${iv(t.raise, t.n)} |`); }
console.log('\n### Hero\'s heads-up bets and raises: version 3\'s prediction (population model) against what followed\n');
console.log('| Knob it informs | Opportunities | Observed | Predicted (sum) |');
console.log('|---|---|---|---|');
for (const key of ['raiseVsBet', 'foldVsRaise', 'foldToCheckRaise']) {
  const rs = heroRows.filter((r) => r.sit === key);
  console.log(`| ${key} | ${rs.length} | ${rs.filter((r) => r.happened).length} | ${rs.reduce((t, r) => t + r.predicted, 0).toFixed(1)} |`);
}
