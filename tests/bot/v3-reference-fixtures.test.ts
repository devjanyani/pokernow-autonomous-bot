// Phase 2.4 reference fixtures for version 3: targeted spots with explicitly specified opponent ranges and
// opponent types, checked against what the spot requires (and, for the river bluff-catch, against the closed-form
// equilibrium of the polarised river game). Each is a property of a best response to the stated model; none is a
// claim about real opponents. Sampling: fixed seeds, enough deals that the asserted gaps are many standard errors.
import { describe, expect, it } from 'vitest';
import { comboIndex, parseCardStrict } from '../../src/bot/cards';
import { computeFeatures, NEUTRAL, Tendencies } from '../../src/bot/ranges/postflop-model';
import { defaultKnobs, Knobs } from '../../src/bot/strategy/v3/model';
import { DEFAULT_V3, PostflopSearchV3, TNode } from '../../src/bot/strategy/v3/search';
import type { VillainModel } from '../../src/bot/strategy/villains';
import { legalActions, potTotal, seatOf } from '../../src/bot/table/engine';
import { buildSpot } from '../../sim/bot/scenarios';

const c = (s: string) => parseCardStrict(s) as number;
const PRE = 'UTG f, HJ f, CO f, BTN r2.5, SB f, BB c';
type Spot = ReturnType<typeof buildSpot>;

/** Every combination not colliding with Hero's cards or the board whose made-hand percentile passes `keep`. */
function rangeWhere(b: Spot, keep: (hs: number, outs: number) => boolean): Float64Array {
  const f = computeFeatures(b.h.board);
  const dead = new Set([...b.heroCards, ...b.h.board]);
  const r = new Float64Array(1326);
  for (let x = 0; x < 52; x++) for (let y = x + 1; y < 52; y++) {
    if (dead.has(x) || dead.has(y)) continue;
    const k = comboIndex(x, y);
    if (f.es[k] >= 0 && keep(f.hs[k], f.outs[k])) r[k] = 1;
  }
  return r;
}
function rangeOf(list: string[]): Float64Array {
  const r = new Float64Array(1326);
  for (const s of list) { const [a, b] = s.split(' ').map(c); r[comboIndex(a, b)] = 1; }
  return r;
}
function villain(b: Spot, range: Float64Array, tend: Tendencies = NEUTRAL): VillainModel {
  const seat = b.h.seats.find((s) => s.dealtIn && !s.folded && s.seat !== b.heroSeat)!.seat;
  const s = seatOf(b.h, seat);
  return { seat, playerId: s.playerId, name: s.name, range, line: '', tend, stack: s.stack, streetCommit: s.streetCommit, totalCommit: s.totalCommit, allIn: s.allIn, actsBehind: true, summary: '', rangeBasis: 'heuristic', rangeSource: 'fixture', retained: 1, poorFit: false };
}
function search(b: Spot, range: Float64Array, knobs: Knobs, deals = 2000, uncertainty = 0): PostflopSearchV3 {
  const s = new PostflopSearchV3(b.h, b.heroSeat, b.heroCards, villain(b, range, knobs.tend), knobs, computeFeatures(b.h.board), 11, undefined, { ...DEFAULT_V3, modelUncertainty: uncertainty });
  s.run(deals);
  return s;
}
const evs = (s: PostflopSearchV3) => { const r = s.result(2.5, false); return { r, ev: (pred: (label: string) => boolean) => r.candidates.filter((x) => pred(x.label)).map((x) => x.ev!) }; };
const nodesAt = (root: TNode, path: string): TNode[] => {
  const out: TNode[] = [];
  const walk = (n: TNode, p: string) => { if (p === path) out.push(n); n.kids.forEach((k, i) => walk(k, `${p} ${n.type === 'hero' ? 'H' : 'V'}:${n.acts[i].kind}`)); };
  walk(root, '');
  return out;
};
const STATION: Tendencies = { ...NEUTRAL, stickiness: NEUTRAL.stickiness + 2 };
const AGGRO: Tendencies = { ...NEUTRAL, aggression: NEUTRAL.aggression + 0.6 };

describe('version 3 reference fixtures', () => {
  it('1. facing a bet with a weak hand against a value-heavy range: folds, and every raise loses', () => {
    const b = buildSpot({ players: 6, hero: 'BB', cards: '7c 2d', lines: [PRE, 'Kh 9d 5s: BB x, BTN b2'] });
    const s = search(b, rangeWhere(b, (hs) => hs >= 0.7), defaultKnobs(NEUTRAL));
    const { r, ev } = evs(s);
    expect(r.candidates[r.best].action).toBe('fold');
    for (const x of ev((l) => l.startsWith('raise'))) expect(x).toBeLessThan(0);
  });

  it('2. bluff-raising against a calling station is worth less than against a neutral opponent, and is not chosen', () => {
    const b = buildSpot({ players: 6, hero: 'BB', cards: '3h 2c', lines: [PRE, 'Kh 9d 5s: BB x, BTN b2'] });
    const wide = rangeWhere(b, () => true);
    const neutral = evs(search(b, wide, defaultKnobs(NEUTRAL)));
    const station = evs(search(b, wide, defaultKnobs(STATION)));
    expect(Math.max(...station.ev((l) => l.startsWith('raise')))).toBeLessThan(Math.max(...neutral.ev((l) => l.startsWith('raise'))));
    expect(station.r.candidates[station.r.best].action).not.toBe('raise');
  });

  it('3. a set facing a bet from an aggressive opponent continues, and never folds to a re-raise', () => {
    const b = buildSpot({ players: 6, hero: 'BB', cards: '9c 9s', lines: [PRE, 'Kh 9d 5s: BB x, BTN b2'] });
    const s = search(b, rangeWhere(b, () => true), { ...defaultKnobs(AGGRO), raiseMult: 2 });
    const { r } = evs(s);
    const pot = potTotal(b.h);
    expect(['call', 'raise']).toContain(r.candidates[r.best].action);
    expect(r.candidates[r.best].ev!).toBeGreaterThan(0.5 * pot);
    for (const n of nodesAt(s.root, ' H:raise V:raise')) if (n.type === 'hero' && n.reach > 0) expect(n.acts[n.choice[0]].kind).not.toBe('fold');
  });

  it('4. top pair, weak kicker, raising into a value range: the plan folds to a re-raise', () => {
    const b = buildSpot({ players: 6, hero: 'BB', cards: 'Kc 3c', lines: [PRE, 'Kh 9d 5s: BB x, BTN b2'] });
    const s = search(b, rangeWhere(b, (hs) => hs >= 0.6), defaultKnobs(NEUTRAL));
    s.result(2.5, false);
    const hero = nodesAt(s.root, ' H:raise V:raise').filter((n) => n.type === 'hero' && n.reach > 0);
    expect(hero.length).toBeGreaterThan(0);
    for (const n of hero) expect(n.acts[n.choice[0]].kind).toBe('fold');
  });

  it('5. a combination draw first to act: after a check, its best answer to a bet is a raise, labelled a semi-bluff', () => {
    const b = buildSpot({ players: 6, hero: 'BB', cards: '8h 7h', lines: [PRE, '9h 6c 2h:'] });
    const s = search(b, rangeWhere(b, () => true), defaultKnobs(NEUTRAL));
    const co = s.result(2.5, false).v3.checkOptions!.filter((x) => !x.nextStreet);
    expect(co.length).toBeGreaterThan(0);
    for (const x of co) {
      const best = x.options.slice().sort((p, q) => q.ev - p.ev)[0];
      expect(best.label).toMatch(/^raise/);
      expect(best.purpose ?? '').toMatch(/semi-bluff/);
      expect(best.ev).toBeGreaterThan(x.options.find((o) => o.label === 'fold')!.ev);
    }
  });

  it('6. river bluff-catch against the equilibrium of the polarised game: calling is worth exactly what folding is', () => {
    // Board K K K 7 2; the bettor holds aces (6 combos) or 3 bluffs and bets the pot; the closed-form equilibrium
    // makes the bluff-catcher indifferent: (1/3) x (pot + bet) - (2/3) x bet = 0. Raising only gets aces' money in.
    const b = buildSpot({ players: 6, hero: 'BB', cards: 'Qc Qd', lines: [PRE, 'Ks Kh Kd: BB x, BTN x', '7c: BB x, BTN x', '2s: BB x, BTN b5.5'] });
    const la = legalActions(b.h, b.heroSeat)!;
    expect(la.callAmount).toBeCloseTo(potTotal(b.h) - la.callAmount, 9);              // a pot-sized bet
    const range = rangeOf(['As Ah', 'As Ad', 'As Ac', 'Ah Ad', 'Ah Ac', 'Ad Ac', '6h 5h', '6d 5d', '4h 3h']);
    const s = search(b, range, defaultKnobs(NEUTRAL), 6000);
    const { r, ev } = evs(s);
    const call = ev((l) => l.startsWith('call'))[0], fold = ev((l) => l === 'fold')[0];
    expect(fold).toBe(0);
    expect(Math.abs(call)).toBeLessThan(0.04 * potTotal(b.h));                           // sampling error only
    for (const x of ev((l) => l.startsWith('raise'))) expect(x).toBeLessThan(call);
    expect(['fold', 'call']).toContain(r.candidates[r.best].action);
  });

  it('7. river, second pair facing a bet from a value-heavy range: raising is worse than calling or folding', () => {
    const b = buildSpot({ players: 6, hero: 'BB', cards: '9c 8c', lines: [PRE, 'Kh 9d 5s: BB x, BTN x', '2c: BB x, BTN x', '7h: BB x, BTN b4'] });
    const s = search(b, rangeWhere(b, (hs) => hs >= 0.5), defaultKnobs(NEUTRAL));
    const { r, ev } = evs(s);
    const passive = Math.max(...ev((l) => l === 'fold' || l.startsWith('call')));
    for (const x of ev((l) => l.startsWith('raise'))) expect(x).toBeLessThan(passive);
    expect(['fold', 'call']).toContain(r.candidates[r.best].action);
  });

  it('8. ranges narrow along a line: the strong share of the opponent grows with each bet it makes', () => {
    const b = buildSpot({ players: 6, hero: 'BB', cards: 'Ac Qd', lines: [PRE, 'Kh 9d 5s:'] });
    const strong = search(b, rangeWhere(b, (hs) => hs >= 0.8), defaultKnobs(NEUTRAL));
    const air = search(b, rangeWhere(b, (hs, outs) => hs < 0.25 && outs < 4), defaultKnobs(NEUTRAL));
    strong.result(2.5, false); air.result(2.5, false);
    const mass = (s: PostflopSearchV3, path: string) => nodesAt(s.root, path).reduce((t, n) => t + n.reach, 0) / s.samples;
    const share = (path: string) => { const a = mass(strong, path), z = mass(air, path); return a / (a + z); };
    const afterFlopBet = share(' H:check V:bet'), afterTurnBet = share(' H:check V:bet H:call H:check V:bet');
    expect(share(' H:check')).toBeCloseTo(0.5, 9);                                    // Hero's own action: no narrowing
    expect(afterFlopBet).toBeGreaterThan(0.5);
    expect(afterTurnBet).toBeGreaterThan(afterFlopBet);
  });
});
