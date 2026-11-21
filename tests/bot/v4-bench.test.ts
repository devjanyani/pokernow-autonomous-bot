// Phase 3.1: the paired preflop evaluation harness (sim/bot/v4-bench.ts) is reproducible, pairs engines on the same
// deals, charges the post-hoc rake correctly, and detects a deliberately poor preflop strategy.
import { describe, expect, it } from 'vitest';
import { cells, runCell } from '../../sim/bot/v4-bench';
import { pairedDiff } from '../../src/bot/sim/table';

const cell = (id: string) => cells().find((c) => c.id === id)!;

describe('v4-bench harness', () => {
  it('lists 28 cells: heads-up, six and nine players, 40 / 100 / 200bb, two opponent sizing profiles', () => {
    const all = cells();
    expect(all.length).toBe(28);
    expect(new Set(all.map((c) => c.id)).size).toBe(28);
    expect(new Set(all.map((c) => c.field.length + 1))).toEqual(new Set([2, 6, 9]));
    expect(new Set(all.map((c) => c.stackBB))).toEqual(new Set([40, 100, 200]));
    expect(new Set(all.map((c) => c.sizes))).toEqual(new Set(['std', 'big']));
  });

  it('is reproducible: the same cell, engine and seed give bit-identical per-deal results', async () => {
    const a = await runCell(cell('six-100-big'), 'v2c', 40, 99001, 40);
    const b = await runCell(cell('six-100-big'), 'v2c', 40, 99001, 40);
    expect(a.hash).toBe(b.hash);
    expect(a.perDeal).toEqual(b.perDeal);
    expect(a.stats.illegal).toBe(0);
    expect(a.stats.preflop).toBeGreaterThan(20);
  }, 120000);

  it('charges the rake only to winners of pots that saw a flop, never more than the cap', async () => {
    const r = await runCell(cell('hu-pot-odds-caller-100'), 'v2', 60, 99002, 40);
    for (let i = 0; i < r.perDeal.length; i++) {
      const net = r.perDeal[i], raked = r.perDealRaked[i];
      if (net <= 0) expect(raked).toBe(net);
      else { expect(raked).toBeLessThanOrEqual(net); expect(net - raked).toBeLessThanOrEqual(3 + 1e-9); }
    }
  }, 120000);

  // Detection power at 1,000 deals per cell is measured by `--suite negative` (reports/phase31-bench-negative.md); a unit
  // test cannot afford enough deals for a significant result, so it checks the control's mechanics and direction.
  it('negative control: the fold-everything control never enters, loses at most its blind in a folded hand, and trails version 2', async () => {
    const v2 = await runCell(cell('hu-maniac-100'), 'v2', 300, 99003, 40);
    const bad = await runCell(cell('hu-maniac-100'), 'neg-fold', 300, 99003, 40);
    expect(bad.stats.vpip.n).toBe(0);
    expect(bad.stats.actions['facing-open']?.call ?? 0).toBe(0);
    expect(bad.stats.actions['facing-open']?.raise ?? 0).toBe(0);
    for (const x of bad.perDeal) if (x < 0 && x > -1.0001) expect([-0.5, -1].some((b) => Math.abs(x - b) < 1e-9)).toBe(true);
    expect(pairedDiff(bad.perDeal, v2.perDeal).bb100).toBeLessThan(0);
  }, 180000);
});
