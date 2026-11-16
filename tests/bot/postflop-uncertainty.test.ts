// The EV of a bet or raise is the lower of two scenarios (modelled responses, and opponents who fold less).
// Its standard error, the standard error of the gap to the runner-up, and everything derived from them
// (mixing, the "separated" stopping flag) must be computed from the SAME scenario as the EV.
// Before the fix they were always computed from the modelled-responses scenario (docs/bot/STRATEGY_V2_DIAGNOSIS.md).
import { afterEach, describe, expect, it } from 'vitest';
import { PostflopSolver, ROBUST_STICKINESS, setRobustStickiness } from '../../src/bot/strategy/postflop';
import { buildTable, FeatureCache } from '../../src/bot/strategy/villains';
import { buildSpot } from '../../sim/bot/scenarios';

const R0 = ROBUST_STICKINESS;
afterEach(() => setRobustStickiness(R0));

// River, heads-up, Hero first to act with nine high: every bet is a bluff, so the pessimistic scenario is the lower one.
const RIVER_BLUFF = { players: 6, hero: 'BB', cards: '9c 8c', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 7d 2s: BB x, BTN x', '4h: BB x, BTN x', 'Qd:'] };

function solve(robust: number, extraStickiness: number, samples = 3000) {
  const b = buildSpot(RIVER_BLUFF);
  const cache = new FeatureCache();
  const t = buildTable(b.h, b.heroSeat, b.heroCards, b.profiles, 1, cache);
  const villains = t.villains.map((v) => ({ ...v, tend: { ...v.tend, stickiness: v.tend.stickiness + extraStickiness } }));
  setRobustStickiness(robust);
  const s = new PostflopSolver(b.h, b.heroSeat, b.heroCards, villains, cache.get(b.h.board), 12345, t.heroPerceived);
  s.run(samples);
  return s.result();
}

describe('postflop EV uncertainty uses the scenario the EV came from', () => {
  // On the river nothing is played after the responses, so a solver whose opponents ARE the pessimistic
  // opponents (and whose two scenarios coincide) produces, deal for deal, the pessimistic series of the
  // ordinary solver. Wherever the ordinary solver reports the pessimistic EV it must report that series' error.
  it('a bluff scored by the pessimistic scenario reports that scenario\'s standard error', () => {
    const a = solve(0.4, 0), b = solve(0, 0.4), model = solve(0, 0);
    let checked = 0;
    a.candidates.forEach((c, i) => {
      if (c.action !== 'bet') return;
      expect(b.candidates[i].label).toBe(c.label);
      if (!(b.candidates[i].ev! < model.candidates[i].ev! - 1e-9)) return;   // pessimistic scenario is the lower one
      expect(c.ev!).toBeCloseTo(b.candidates[i].ev!, 9);
      expect(c.evSe!).toBeCloseTo(b.candidates[i].evSe!, 9);
      // The two scenarios really do differ in spread here, otherwise the test would prove nothing.
      expect(Math.abs(model.candidates[i].evSe! - b.candidates[i].evSe!)).toBeGreaterThan(1e-3);
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
  });

  it('the gap to the runner-up and its standard error come from the same scenario', () => {
    const a = solve(0.4, 0), b = solve(0, 0.4);
    expect(a.best).toBe(b.best);
    expect(a.evGap!).toBeCloseTo(b.evGap!, 9);
    expect(a.evGapSe!).toBeCloseTo(b.evGapSe!, 9);
    expect(a.candidates.map((c) => c.freq)).toEqual(b.candidates.map((c) => c.freq));
  });

  it('reports both scenarios for a bet so sampling error and model sensitivity can be told apart', () => {
    const a = solve(0.4, 0), model = solve(0, 0), sticky = solve(0, 0.4);
    a.candidates.forEach((c, i) => {
      if (c.action !== 'bet') { expect(c.evModel ?? null).toBeNull(); return; }
      expect(c.evModel!).toBeCloseTo(model.candidates[i].ev!, 9);
      expect(c.evPessimistic!).toBeCloseTo(sticky.candidates[i].ev!, 9);
      expect(c.ev!).toBeLessThanOrEqual(Math.min(c.evModel!, c.evPessimistic!) + 1e-9);
    });
  });
});
