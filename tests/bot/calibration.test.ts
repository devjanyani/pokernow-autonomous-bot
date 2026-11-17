// Opponent-response calibration framework (sim/bot/data/calibration.ts): assumptions, population observations
// and player observations stay separate, and nothing is reported as observed that was not counted.
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { INDEPENDENT_FACTORIES } from '../../src/bot/sim/independent';
import { callingStationPolicy } from '../../src/bot/sim/policies';
import { playSession } from '../../src/bot/sim/table';
import { calibrationTable, countHand, countHistories, currentAssumption, estimate, facingKey, newCounts, openKey, sizeClass } from '../../sim/bot/data/calibration';
import { parsePhh } from '../../sim/bot/data/importers';
import type { HandHistory } from '../../sim/bot/data/schema';

const A = { mean: 0.45, strength: 10, basis: 'heuristic' as const, from: 'test' };

describe('the three layers', () => {
  it('with no observation the answer is the assumption, labelled as assumed, with a wide interval', () => {
    const e = estimate(A, null, null);
    expect(e).toMatchObject({ restsOn: 'assumption', observations: 0, population: null, player: null });
    expect(e.mean).toBeCloseTo(0.45, 9);
    expect(e.hi - e.lo).toBeGreaterThan(0.4);
    expect(e.note).toMatch(/ASSUMED, not measured/);
    expect(estimate(A, { n: 0, d: 0, source: 'x' }, null).restsOn).toBe('assumption'); // zero opportunities is not an observation
  });

  it('population data replaces the assumption in proportion to how much there is, and says where it came from', () => {
    const few = estimate(A, { n: 9, d: 10, source: 'slice-1' }, null);
    const many = estimate(A, { n: 900, d: 1000, source: 'slice-1' }, null);
    expect(few.restsOn).toBe('population');
    expect(few.mean).toBeGreaterThan(0.6); expect(few.mean).toBeLessThan(0.75);       // still pulled toward 45%
    expect(many.mean).toBeGreaterThan(0.89);
    expect(many.hi - many.lo).toBeLessThan(0.04);
    expect(many.note).toMatch(/observed 900 of 1000 \[slice-1\]; the assumption was 45%/);
    expect(many.assumption).toEqual(A);                                                // the assumption is kept alongside, not overwritten
  });

  it('a player\'s own record is shrunk toward the population, or toward the assumption when there is no population data', () => {
    const pop = { n: 300, d: 1000, source: 'slice-1' };
    const small = estimate(A, pop, { n: 4, d: 4, source: 'Bob' });
    const large = estimate(A, pop, { n: 190, d: 200, source: 'Bob' });
    expect(small.restsOn).toBe('player');
    expect(small.mean).toBeGreaterThan(0.3); expect(small.mean).toBeLessThan(0.5);    // four hands do not make a 100% folder
    expect(large.mean).toBeGreaterThan(0.85);
    expect(small.player).toMatchObject({ n: 4, d: 4, raw: 1 });
    expect(small.population!.d).toBe(1000);
    const alone = estimate(A, null, { n: 4, d: 4, source: 'Bob' });
    expect(alone.note).toMatch(/an assumed 45% \(test; no population data\)/);
    expect(alone.mean).toBeLessThan(0.6);
  });

  it('refuses counts that are not counts, and observations without a source', () => {
    expect(() => estimate(A, { n: 5, d: 3, source: 'x' }, null)).toThrow(/whole numbers/);
    expect(() => estimate(A, { n: 1.5, d: 3, source: 'x' }, null)).toThrow(/whole numbers/);
    expect(() => estimate(A, { n: 1, d: 3, source: ' ' }, null)).toThrow(/need a source/);
  });

  it('the engine\'s present numbers are exposed as assumptions with their location, never as observations', () => {
    const a = currentAssumption('fold', 'river');
    expect(a).toMatchObject({ mean: 0.5, strength: 10, basis: 'heuristic' });
    expect(a.from).toMatch(/PRIORS\.foldVsBetRiver/);
    expect(currentAssumption('bet', 'flop').from).toMatch(/betWhenCheckedToFlop/);
  });
});

describe('counting', () => {
  it('bet sizes are classed by pot fraction', () => {
    expect([0.25, 0.5, 1, 2].map(sizeClass)).toEqual(['small', 'medium', 'large', 'overbet']);
  });

  it('a recorded hand yields exactly the responses it contains', () => {
    const hand = parsePhh(fs.readFileSync(path.join(__dirname, 'fixtures', 'data', 'synthetic-hand-1.phh'), 'utf8'), 'synthetic-hands', 'h1').hand as HandHistory;
    const c = newCounts();
    expect(countHistories(c, [hand, { ...hand, board: ['As', '3d', '5c'] }])).toEqual({ used: 1, skipped: 1 }); // the second has a duplicated card
    // Flop: checked to the raiser, who bets 8 into 13 (medium); the caller calls. Turn: check, check. River: check, bet 20 into 29 (medium), fold.
    expect(c.all.get(openKey('flop', true))).toMatchObject({ check: 1, bet: 1 });
    expect(c.all.get(facingKey('flop', 'medium', true))).toMatchObject({ call: 1, fold: 0, raise: 0 });
    expect(c.all.get(openKey('turn', true))).toMatchObject({ check: 2, bet: 0 });
    expect(c.all.get(facingKey('river', 'medium', true))).toMatchObject({ fold: 1, call: 0 });
    expect([...c.all.keys()].some((k) => k.includes('preflop'))).toBe(false);
  });

  it('recovers known behaviour from simulated hands: a player who never folds, and one who folds a lot', async () => {
    const c = newCounts();
    await playSession({
      players: [{ playerId: 'station', policy: callingStationPolicy() }, { playerId: 'maniac', policy: INDEPENDENT_FACTORIES.maniac() }, { playerId: 'nit', policy: INDEPENDENT_FACTORIES.nit() }],
      hands: 900, seed: 11, smallBlind: 10, bigBlind: 20, startStack: 2000, onHand: (r) => countHand(c, r.h),
    });
    expect(c.hands).toBe(900);
    const facing = (player: string) => { let f = 0, d = 0; for (const [k, t] of c.byPlayer.get(player) ?? []) if (k.startsWith('facing')) { f += t.fold; d += t.fold + t.call + t.raise; } return { f, d }; };
    expect(facing('station')).toMatchObject({ f: 0 });
    expect(facing('station').d).toBeGreaterThan(100);
    expect(facing('nit').f / facing('nit').d).toBeGreaterThan(0.5);
    const rows = calibrationTable(c, 'simulated: station, maniac, nit', 'station');
    const stationFolds = rows.filter((r) => r.action === 'fold' && r.estimate.restsOn === 'player');
    expect(stationFolds.length).toBeGreaterThan(0);
    for (const r of stationFolds) expect(r.estimate.mean).toBeLessThan(r.estimate.population!.mean);
    // Every row rests on counted events and names its source; none is a bare assumption.
    expect(rows.every((r) => r.estimate.population !== null && r.estimate.population.source.startsWith('simulated'))).toBe(true);
    expect(rows.some((r) => r.assumptionOutsideInterval)).toBe(true);
  }, 120000);
});
