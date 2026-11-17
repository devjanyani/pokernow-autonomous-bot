// The river reference (sim/bot/river-reference.ts): the in-repository solver checked against a game whose
// equilibrium is known in closed form, and against an independent recomputation of every value.
import { describe, expect, it } from 'vitest';
import { parseCardStrict } from '../../src/bot/cards';
import type { RangeHand } from '../../src/core/solver/postflop-cfr';
import { independentCheck, RiverSpec, solveRiver } from '../../sim/bot/river-reference';

const c = (s: string) => parseCardStrict(s) as number;
const SUITS = ['s', 'h', 'd', 'c'];
/** Every combination of the two ranks (pairs: six; otherwise sixteen). */
function combos(r1: string, r2: string): RangeHand[] {
  const out: RangeHand[] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    if (r1 === r2 && j <= i) continue;
    out.push({ cards: [c(r1 + SUITS[i]), c(r2 + SUITS[j])], weight: 1 });
  }
  return out;
}

/**
 * The textbook polarised river. Board K K K 7 2. Hero holds either aces (always best) or one of four no-pair
 * hands (always worst); the other player holds queens (beats the bluffs, loses to aces) and has checked.
 * Pot 100, one bet of 100 allowed (all-in), no raise. No hand blocks another.
 *   - the caller must call half the time, so that a bluff earns nothing: (1 - c) * 100 - c * 100 = 0
 *   - Hero bets every ace and bluffs half as many hands as it has aces: 6 value hands, 3 bluffs
 *   - aces earn 100 + 0.5 * 100 = 150; a bluffing hand earns 0 whether it bets or checks
 */
function polar(): RiverSpec {
  return {
    board: ['Ks', 'Kh', 'Kd', '7c', '2s'].map(c),
    hero: [...combos('A', 'A'), ...combos('6', '5'), ...combos('6', '4'), ...combos('5', '4'), ...combos('4', '3')],
    villain: combos('Q', 'Q'),
    pot: 100, stack: 100, toCall: 0, heroIsIP: true, betFractions: [1], maxAggressions: 1,
  };
}

describe('river solver against a known equilibrium', () => {
  const spec = polar();
  const sol = solveRiver(spec, { maxIterations: 4000, targetPotShare: 0.0005 });
  const chk = independentCheck(sol, spec);
  const root = sol.solver.root;
  const bet = root.actions.findIndex((a) => a.kind !== 'check');

  it('the game is the one intended: check or one bet of 100, then fold or call', () => {
    expect(root.actions.map((a) => [a.kind === 'check' ? 'check' : 'bet', a.chips])).toEqual([['check', 0], ['bet', 100]]);
    expect(root.children[bet].actions.map((a) => a.kind)).toEqual(['fold', 'call']);
    expect(spec.hero.length).toBe(70);
  });

  it('converges: a best-responding opponent gains less than 0.1% of the pot', () => {
    expect(sol.exploitPotShare).toBeLessThan(0.001);
  });

  it('the caller calls half the time', () => {
    const f = sol.solver.rangeFrequencies(root.children[bet]);
    expect(f[1]).toBeGreaterThan(0.48);
    expect(f[1]).toBeLessThan(0.52);
  });

  it('Hero bets every value hand and bluffs half as many hands as it has value hands', () => {
    let value = 0, bluffs = 0;
    for (let i = 0; i < 70; i++) { if (i < 6) value += chk.actionProbs[bet][i]; else bluffs += chk.actionProbs[bet][i]; }
    expect(value).toBeGreaterThan(5.9);
    expect(bluffs).toBeGreaterThan(2.8);
    expect(bluffs).toBeLessThan(3.2);
  });

  it('values match theory: 150 for aces (100 if checked), 0 for a bluffing hand either way', () => {
    for (let i = 0; i < 6; i++) {
      expect(chk.heroValues[i]).toBeGreaterThan(149);
      expect(chk.heroValues[i]).toBeLessThan(151);
      expect(chk.actionValues[0][i]).toBeCloseTo(100, 6);
      expect(chk.actionValues[bet][i]).toBeGreaterThan(149);
    }
    for (let i = 6; i < 70; i++) {
      expect(Math.abs(chk.heroValues[i])).toBeLessThan(1);
      expect(chk.actionValues[0][i]).toBeCloseTo(0, 6);
      expect(Math.abs(chk.actionValues[bet][i])).toBeLessThan(2);
    }
  });

  it('the independent recomputation agrees with the solver\'s own numbers', () => {
    expect(chk.maxValueDiff).toBeLessThan(1e-6);
    expect(Math.abs(chk.exploitChips - sol.solver.exploitability())).toBeLessThan(1e-6);
  });
});

describe('river solver: card removal and facing a bet', () => {
  it('hands that share a card are never matched against each other (independent check agrees with blockers present)', () => {
    // Both ranges contain the same aces and overlapping suits, so many pairs conflict.
    const spec: RiverSpec = {
      board: ['Ks', '9h', '4d', '7c', '2s'].map(c),
      hero: [...combos('A', 'K'), ...combos('A', 'A'), ...combos('Q', 'J')].filter((h) => !['Ks'].map(c).some((x) => h.cards.includes(x))),
      villain: [...combos('A', 'K'), ...combos('K', 'Q'), ...combos('A', 'Q'), ...combos('9', '9')].filter((h) => !['Ks', '9h'].map(c).some((x) => h.cards.includes(x))),
      pot: 60, stack: 180, toCall: 0, heroIsIP: false, betFractions: [0.5, 1],
    };
    const sol = solveRiver(spec, { maxIterations: 1200 });
    const chk = independentCheck(sol, spec);
    expect(chk.maxValueDiff).toBeLessThan(1e-6);
    expect(Math.abs(chk.exploitChips - sol.solver.exploitability())).toBeLessThan(1e-6);
    expect(sol.exploitPotShare).toBeLessThan(0.01);
  });

  it('facing a pot-sized bet with a pure bluff-catcher against a polarised range, calling and folding are worth about the same', () => {
    // Roles reversed: the other player bet 100 into 100 with aces or air in the equilibrium ratio (6 : 3 by weight).
    const air = [...combos('6', '5')].map((h) => ({ ...h, weight: 3 / 16 }));
    const spec: RiverSpec = { board: ['Ks', 'Kh', 'Kd', '7c', '2s'].map(c), hero: combos('Q', 'Q'), villain: [...combos('A', 'A'), ...air], pot: 100, stack: 100, toCall: 100, heroIsIP: true, betFractions: [1], maxAggressions: 1 };
    const sol = solveRiver(spec, { maxIterations: 600 });
    const chk = independentCheck(sol, spec);
    const fold = sol.solver.root.actions.findIndex((a) => a.kind === 'fold'), call = sol.solver.root.actions.findIndex((a) => a.kind === 'call');
    for (let i = 0; i < 6; i++) expect(Math.abs(chk.actionValues[call][i] - chk.actionValues[fold][i])).toBeLessThan(1e-6);
  });
});
