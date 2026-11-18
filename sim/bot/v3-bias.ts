// Selection bias of version 3's values below the root: plain (choose and value on the same deals) against
// cross-fitted, at several deal counts, against a large run. Development measurement.
//   npx tsx sim/bot/v3-bias.ts
import { NEUTRAL, computeFeatures } from '../../src/bot/ranges/postflop-model';
import { removeDead } from '../../src/bot/ranges/range';
import { defaultKnobs } from '../../src/bot/strategy/v3/model';
import { DEFAULT_V3, PostflopSearchV3 } from '../../src/bot/strategy/v3/search';
import { seatOf } from '../../src/bot/table/engine';
import { buildSpot } from './scenarios';

const spots = [
  { players: 6, hero: 'BB', cards: '5c 4c', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9d 5s:'] },
  { players: 6, hero: 'BB', cards: 'Qs Js', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Ks 9d 5s:'] },
  { players: 6, hero: 'BTN', cards: '7d 6d', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9c 2s: BB x'] },
  { players: 6, hero: 'BB', cards: 'Kc 4c', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9d 5s: BB x, BTN b2'] },
];
for (const sp of spots) {
  const b = buildSpot(sp);
  const opp = b.h.seats.find((s) => s.dealtIn && !s.folded && s.seat !== b.heroSeat)!.seat;
  const so = seatOf(b.h, opp);
  const range = removeDead(new Float64Array(1326).fill(1), [...b.heroCards, ...b.h.board]);
  const vm = { seat: opp, playerId: so.playerId, name: so.name, range, line: '', tend: NEUTRAL, stack: so.stack, streetCommit: so.streetCommit, totalCommit: so.totalCommit, allIn: false, actsBehind: true, summary: '', rangeBasis: 'heuristic' as const, rangeSource: '', retained: 1, poorFit: false };
  const f = computeFeatures(b.h.board);
  const mk = (cross: boolean, seed: number) => new PostflopSearchV3(b.h, b.heroSeat, b.heroCards, vm, defaultKnobs(NEUTRAL), f, seed, undefined, { ...DEFAULT_V3, modelUncertainty: 0, crossFit: cross });
  const big = mk(true, 1001); big.run(12000);
  const ref = big.result(2.5, false).candidates.map((c) => c.ev!);
  const bigPlain = mk(false, 1001); bigPlain.run(12000);
  const refP = bigPlain.result(2.5, false).candidates.map((c) => c.ev!);
  console.log(`\n${sp.cards} ${sp.lines[1]}  reference (12000 deals, cross / plain): ${ref.map((x, i) => `${big.specs[i].label} ${x.toFixed(1)}/${refP[i].toFixed(1)}`).join(' | ')}`);
  for (const n of [400, 1200, 2400]) {
    const reps = n === 400 ? 12 : 6;
    const bp = new Array(ref.length).fill(0), bx = new Array(ref.length).fill(0);
    let agreeP = 0, agreeX = 0;
    const bestRef = ref.indexOf(Math.max(...ref));
    for (let s = 1; s <= reps; s++) {
      const p = mk(false, s); p.run(n); const rp = p.result(2.5, false); rp.candidates.forEach((c, i) => { bp[i] += (c.ev! - ref[i]) / reps; }); if (rp.best === bestRef) agreeP++;
      const x = mk(true, s); x.run(n); const rx = x.result(2.5, false); rx.candidates.forEach((c, i) => { bx[i] += (c.ev! - ref[i]) / reps; }); if (rx.best === bestRef) agreeX++;
    }
    console.log(`  ${n} deals: bias plain ${bp.map((x) => x.toFixed(1)).join(' ')} | cross ${bx.map((x) => x.toFixed(1)).join(' ')} | picks the reference's best: plain ${agreeP}/${reps}, cross ${agreeX}/${reps}`);
  }
}
