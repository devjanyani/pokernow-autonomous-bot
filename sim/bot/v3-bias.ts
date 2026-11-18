// Selection bias of version 3's root values and the quality of its choices, by valuation method, at equal deal
// budgets, against a large holdout-valued run (12,000 deals). Development measurement (Phase 2.3, extended in 2.4).
//   npx tsx sim/bot/v3-bias.ts [--reps 12]
//
// Methods: plain (later choices made and valued on the same deals); cross (each half's later choices made on the
// other half); holdout k (later choices made on all but every k-th deal, root values on every k-th deal only).
// Reported per spot and deal count: mean bias of each candidate's value against the reference, how often the
// method picks the reference's best action, and the mean regret (reference value of the best minus the reference
// value of the action picked, chips).
import { NEUTRAL, computeFeatures } from '../../src/bot/ranges/postflop-model';
import { removeDead } from '../../src/bot/ranges/range';
import { defaultKnobs } from '../../src/bot/strategy/v3/model';
import { DEFAULT_V3, PostflopSearchV3, SearchConfig } from '../../src/bot/strategy/v3/search';
import { seatOf } from '../../src/bot/table/engine';
import { buildSpot } from './scenarios';

const argN = (f: string, d: number) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const REPS = argN('reps', 12);
export const BIAS_SPOTS = [
  { players: 6, hero: 'BB', cards: '5c 4c', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9d 5s:'] },
  { players: 6, hero: 'BB', cards: 'Qs Js', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Ks 9d 5s:'] },
  { players: 6, hero: 'BTN', cards: '7d 6d', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9c 2s: BB x'] },
  { players: 6, hero: 'BB', cards: 'Kc 4c', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9d 5s: BB x, BTN b2'] },
  { players: 6, hero: 'BB', cards: 'Ah Th', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9h 5s: BB x, BTN b2'] },
  { players: 6, hero: 'BTN', cards: 'Jd Td', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9c 2s: BB x, BTN b1.5, BB c', '5d: BB x'] },
];
const METHODS: [string, Partial<SearchConfig>][] = [['plain', {}], ['cross', { crossFit: true }], ['holdout 2', { holdoutEvery: 2 }], ['holdout 3', { holdoutEvery: 3 }]];

for (const sp of BIAS_SPOTS) {
  const b = buildSpot(sp);
  const opp = b.h.seats.find((s) => s.dealtIn && !s.folded && s.seat !== b.heroSeat)!.seat;
  const so = seatOf(b.h, opp);
  const range = removeDead(new Float64Array(1326).fill(1), [...b.heroCards, ...b.h.board]);
  const vm = { seat: opp, playerId: so.playerId, name: so.name, range, line: '', tend: NEUTRAL, stack: so.stack, streetCommit: so.streetCommit, totalCommit: so.totalCommit, allIn: false, actsBehind: true, summary: '', rangeBasis: 'heuristic' as const, rangeSource: '', retained: 1, poorFit: false };
  const f = computeFeatures(b.h.board);
  const mk = (cfg: Partial<SearchConfig>, seed: number) => new PostflopSearchV3(b.h, b.heroSeat, b.heroCards, vm, defaultKnobs(NEUTRAL), f, seed, undefined, { ...DEFAULT_V3, modelUncertainty: 0, ...cfg });
  const big = mk({ holdoutEvery: 3 }, 1001); big.run(12000);
  const ref = big.result(2.5, false).candidates.map((c) => c.ev!);
  const bestRef = ref.indexOf(Math.max(...ref));
  console.log(`\n${sp.cards} ${sp.lines.slice(1).join(' / ')}  reference (12000 deals, holdout 3): ${ref.map((x, i) => `${big.specs[i].label} ${x.toFixed(1)}`).join(' | ')}`);
  for (const n of [400, 1200]) {
    const row: string[] = [];
    for (const [name, cfg] of METHODS) {
      const bias = new Array(ref.length).fill(0);
      let agree = 0, regret = 0;
      for (let s = 1; s <= REPS; s++) {
        const x = mk(cfg, s); x.run(n); const r = x.result(2.5, false);
        r.candidates.forEach((c, i) => { bias[i] += (c.ev! - ref[i]) / REPS; });
        if (r.best === bestRef) agree++;
        regret += (ref[bestRef] - ref[r.best]) / REPS;
      }
      row.push(`${name}: bias ${bias.map((x) => x.toFixed(1)).join(' ')}, best ${agree}/${REPS}, regret ${regret.toFixed(2)}`);
    }
    console.log(`  ${n} deals | ${row.join(' | ')}`);
  }
}
