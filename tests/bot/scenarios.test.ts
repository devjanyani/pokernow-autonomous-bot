// The decision scenarios (sim/bot/scenarios.ts). Only PROPERTIES are asserted: statements that follow from the
// rules or from the engine's own stated model. Observations ("plausible poker, not a theorem") are not asserted,
// and no test here says that a class of hand must take a particular action.
import { describe, expect, it } from 'vitest';
import { buildSpot, runScenarios, SCENARIOS } from '../../sim/bot/scenarios';
import { defaultLibrary } from '../../src/bot/strategy/library/builtin';

describe('decision scenarios', () => {
  it('every scenario builds to a spot with Hero to act', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (const s of SCENARIOS) { const b = buildSpot(s.spot); expect(b.h.toAct).toBe(b.heroSeat); }
  });

  it('covers every category asked for, with a held-out set that was not used for tuning', () => {
    const cats = new Set(SCENARIOS.map((s) => s.category));
    for (const c of ['OOP caller vs late raiser', 'Bottom pair by texture', 'Top pair wet vs dry', 'Weak draws, unfavourable odds', 'Strong draws with fold equity', 'Multiway weak pairs',
      'Missed flop', 'Turn barrels', 'River bluff-catching', 'Off-strategy preflop call', 'Opponent models', 'Heads-up vs multiway']) expect(cats.has(c)).toBe(true);
    expect(SCENARIOS.filter((s) => s.set === 'held-out').length).toBeGreaterThanOrEqual(10);
  });

  it('version 2 satisfies every property in the design set and in the held-out set', () => {
    const res = runScenarios('v2', 3000, 11);
    const failed = res.flatMap((r) => r.checks.filter((c) => c.kind === 'property' && !c.pass).map((c) => `${r.scenario.set} ${r.scenario.id}: ${c.text}`));
    expect(failed).toEqual([]);
  }, 180000);

  it('version 1 (baseline) violates "checking is never worth less than folding" and the all-in pot-odds identity', () => {
    const res = runScenarios('v1', 3000, 11);
    const failed = res.flatMap((r) => r.checks.filter((c) => c.kind === 'property' && !c.pass).map((c) => `${r.scenario.id}: ${c.text}`));
    expect(failed.some((f) => /EV\(check\) >= 0/.test(f))).toBe(true);
    expect(failed.some((f) => /ho-allin-flop-draw: closing call/.test(f))).toBe(true);
  }, 180000);

  it('ships no solver references, and says so rather than inventing them', () => {
    expect(defaultLibrary().packs.flatMap((p) => p.references ?? [])).toEqual([]);
  });
});
