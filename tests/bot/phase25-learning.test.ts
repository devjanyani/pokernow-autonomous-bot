// Phase 2.5: importing real hand histories, the opponent-response models, and the experimental empirical
// corrections of version 3. All data here is SYNTHETIC (written in the test); no real hand is in the repository.
import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { BotAgent } from '../../src/bot/agent';
import { NEUTRAL } from '../../src/bot/ranges/postflop-model';
import { facingCorrection, PopulationCalibration, tiltRiverRange } from '../../src/bot/strategy/v3/empirical';
import { defaultKnobs, respond3 } from '../../src/bot/strategy/v3/model';
import { parsePhhs } from '../../sim/bot/data/importers';
import { sampleNumbers } from '../../sim/bot/data/fetch-handhq';
import { opportunities } from '../../sim/bot/phase25/extract';
import { cellOf, finalize, fitResidual, modelA, monotoneShifts, Row } from '../../sim/bot/phase25/models';
import { MULTS, NEUTRAL_MULT, NEUTRAL_SHIFT, SHIFTS } from '../../sim/bot/phase25/predict';
import { fitRiver, RiverObs } from '../../sim/bot/phase25/river-range';
import { buildSpot } from '../../sim/bot/scenarios';

const PHHS = `[1]
variant = 'NT'
ante_trimming_status = false
antes = [0, 0, 0]
blinds_or_straddles = [1, 2, 0]
min_bet = 2
starting_stacks = [inf, inf, inf]
actions = ['d dh p1 ????', 'd dh p2 ????', 'd dh p3 ????', 'p3 cc', 'p1 cc', 'p2 cc', 'd db 6hTdKd', 'p1 cc', 'p2 cbr 4', 'p3 f', 'p1 cbr 12', 'p2 f']
venue = 'Test'
time = 00:00:03
day = 2
hand = 1
seat_count = 6
players = ['a', 'binf', 'inf']

[2]
variant = 'NT'
antes = [0, 0, 0]
blinds_or_straddles = [1, 2, 0]
min_bet = 2
starting_stacks = [200, 200, 200]
actions = ['d dh p1 ????', 'd dh p2 ????', 'd dh p3 ????', 'p3 cbr 6', 'p1 f', 'p2 cc', 'd db 2c7d9h', 'p2 cc', 'p3 cbr 8', 'p2 cc', 'd db Qs', 'p2 cc', 'p3 cc', 'd db 3c', 'p2 cbr 20', 'p3 cc', 'p2 sm AhAd', 'p3 sm ????']
venue = 'Test'
day = 3
hand = 2
seat_count = 6
players = ['x', 'y', 'z']
`;

describe('PHH multi-hand files (HandHQ format)', () => {
  it('splits sections, reads unknown stacks as flagged placeholders, keeps quoted text that contains "inf"', () => {
    const r = parsePhhs(PHHS, 'test', 'f');
    expect(r.sections).toBe(2);
    expect(r.hands.length).toBe(2);
    const [a, b] = r.hands;
    expect(a.meta.stacksUnknown).toBe(1);
    expect(a.seats.map((s) => s.stack)).toEqual([2000, 2000, 2000]);
    expect(a.seats.map((s) => s.name)).toEqual(['a', 'binf', 'inf']);
    expect(a.meta.time).toBe('00:00:03');
    expect(b.meta.stacksUnknown).toBeUndefined();
    expect(b.holes[1]).toEqual(['Ah', 'Ad']);            // shown at showdown
    expect(b.holes[2]).toBeNull();                       // mucked: never guessed
  });
  it('turns decisions into opportunities with the right situation and denominators', () => {
    const [a, b] = parsePhhs(PHHS, 'test', 'f').hands;
    const ex = opportunities(a, 0);
    expect(ex.ok).toBe(true);
    const flop = ex.opps.map((o) => `${o.player}:${o.type}:${o.act}`);
    // p1 checks (may bet), p2 bets (may bet), p3 folds facing a bet, p1 check-raises facing a bet, p2 folds to the check-raise.
    expect(flop).toEqual(['a:open:check', 'binf:open:bet', 'inf:bet:fold', 'a:bet:raise', 'binf:xr:fold']);
    expect(ex.opps[2].frac).toBeCloseTo(4 / 6, 9);       // 4 to call into a pot of 6
    expect(ex.opps.every((o) => o.spr === null)).toBe(true);   // stacks unknown
    const rivers: string[] = [];
    const ex2 = opportunities(b, 0, (rv) => rivers.push(`${rv.bettor}|${rv.caller}|${rv.frac.toFixed(3)}`));
    expect(ex2.ok).toBe(true);
    expect(rivers).toEqual(['AhAd|null|0.690']);          // 20 into a pot of 29; the caller mucked
    expect(ex2.opps.find((o) => o.street === 'flop' && o.player === 'z')!.agg).toBe(true);   // preflop raiser on the flop
  });
  it('samples evenly over a folder, always including the first and last file', () => {
    expect(sampleNumbers(1198, 30)[0]).toBe(1);
    expect(sampleNumbers(1198, 30).slice(-1)[0]).toBe(1198);
    expect(new Set(sampleNumbers(325, 30)).size).toBe(30);
  });
});

/** A synthetic facing-a-bet row whose model predicts fold = base + 0.8 * shift at each grid point. */
function synthRow(base: number, y: number, i: number, street: Row['street'] = 'river'): Row {
  const grid: number[] = [];
  SHIFTS.forEach((sh) => MULTS.forEach((m) => {
    const f = Math.min(0.98, Math.max(0.02, base + 0.8 * sh));
    const r = Math.min(0.5 * (1 - f), 0.05 * m);
    grid.push(f, 1 - f - r, r);
  }));
  return { hand: `h${i}`, day: 1, player: `p${i % 50}`, street, facing: true, kind: 'raise', frac: 0.6, ip: true, agg: true, spr: 5, canAgg: true, y, grid };
}
const draw = (p: number[], u: number) => (u < p[0] ? 0 : u < p[0] + p[1] ? 1 : 2);
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

describe('residual calibration fitted to data (the Phase 2.4 defect must not come back)', () => {
  it('a high raw fold rate that the model already predicts moves nothing, however many decisions are seen', () => {
    for (const n of [100, 5000]) {
      // The model predicts 80% folds here (for example because the range that reaches the spot is weak); the
      // players fold exactly that often. A raw-frequency rule would read 80% against a 45% prior as "folds more".
      const rows = Array.from({ length: n }, (_, i) => synthRow(0.8, 0, i)).map((r) => ({ ...r, y: draw(modelA(r), rnd()) }));
      const fit = fitResidual(rows, 2).get(cellOf(rows[0]))!;
      expect(Math.abs(fit.shift)).toBeLessThanOrEqual(0.05);
      if (n === 5000) expect(fit.si).toBe(NEUTRAL_SHIFT);
    }
  });
  it('players who fold more than predicted move the shift up; with few decisions the penalty keeps the model', () => {
    const many = Array.from({ length: 4000 }, (_, i) => synthRow(0.4, rnd() < 0.5 ? 0 : 1, i));   // true shift +0.125
    expect(fitResidual(many, 2).get(cellOf(many[0]))!.shift).toBeGreaterThanOrEqual(0.1);
    const few = Array.from({ length: 6 }, (_, i) => synthRow(0.4, 0, i));
    const f = fitResidual(few, 2).get(cellOf(few[0]))!;
    expect(f.shift).toBeLessThanOrEqual(0.1);
    expect(f.mi).toBe(NEUTRAL_MULT);
  });
  it('folding stays monotone in the bet size: shifts are made non-decreasing over the size classes', () => {
    const fit = new Map([
      ['river|raise|small', { si: SHIFTS.indexOf(-0.05), mi: NEUTRAL_MULT, n: 100, shift: -0.05, mult: 1 }],
      ['river|raise|medium', { si: SHIFTS.indexOf(-0.15), mi: NEUTRAL_MULT, n: 300, shift: -0.15, mult: 1 }],
      ['river|raise|large', { si: SHIFTS.indexOf(0), mi: NEUTRAL_MULT, n: 100, shift: 0, mult: 1 }],
    ]);
    const m = monotoneShifts(fit);
    const s = ['small', 'medium', 'large'].map((z) => m.get(`river|raise|${z}`)!.shift);
    expect(s[0]).toBeLessThanOrEqual(s[1]);
    expect(s[1]).toBeLessThanOrEqual(s[2]);
  });
  it('probabilities are valid, and a class that is not allowed gets none', () => {
    const p = finalize([0.2, 0.5, 0.3], { facing: true, canAgg: false });
    expect(p[2]).toBe(0);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(finalize([0, 1, 0], { facing: true, canAgg: true }).every((x) => x > 0)).toBe(true);
  });
});

describe('the fitted population table in version 3', () => {
  const pop = JSON.parse(fs.readFileSync('src/bot/strategy/v3/population-calibration.json', 'utf8')) as PopulationCalibration;
  it('keeps every response a valid distribution and folding monotone in the bet size', () => {
    const k = { ...defaultKnobs(NEUTRAL), population: pop };
    for (const street of ['flop', 'turn', 'river'] as const) for (const [level, own, cr] of [[1, false, false], [2, true, false], [2, true, true]] as const) for (const s of [0.1, 0.4, 0.7, 0.95]) {
      let prev = -1;
      for (let f = 0.1; f <= 3; f += 0.1) {
        const r = respond3(s, { street, betFrac: f, level, ownRaised: own, checkRaised: cr, role: 'neutral', canRaise: true }, k);
        expect(r.fold + r.call + r.raise).toBeCloseTo(1, 9);
        expect(Math.min(r.fold, r.call, r.raise)).toBeGreaterThanOrEqual(0);
        expect(r.fold).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = r.fold;
      }
    }
  });
  it('interpolates over the bet size and makes no correction for a situation it has no cell for', () => {
    const p: PopulationCalibration = { source: 't', cells: { 'river|bet|small': { shift: -0.1, mult: 2, n: 9 }, 'river|bet|large': { shift: 0.1, mult: 1, n: 9 } } };
    const c = (f: number) => facingCorrection(p, { street: 'river', betFrac: f, level: 1, ownRaised: false, checkRaised: false, role: 'neutral', canRaise: true });
    expect(c(0.1)).toEqual({ shift: -0.1, mult: 2 });
    expect(c(2)).toEqual({ shift: 0.1, mult: 1 });
    expect(c(0.5).shift).toBeGreaterThan(-0.1);
    expect(c(0.5).shift).toBeLessThan(0.1);
    expect(facingCorrection(p, { street: 'flop', betFrac: 0.5, level: 1, ownRaised: false, checkRaised: false, role: 'neutral', canRaise: true })).toEqual({ shift: 0, mult: 1 });
  });
});

describe('river betting-range tilt', () => {
  it('re-weights by strength bin and never creates weight where the range had none', () => {
    const range = new Float64Array(1326); range[0] = 1; range[1] = 1; range[2] = 0;
    const hs = new Float32Array(1326).fill(-1); hs[0] = 0.1; hs[1] = 0.95; hs[2] = 0.5;
    const t = tiltRiverRange({ source: 't', bins: [0.2, 0.4, 0.6, 0.75, 0.9], theta: { 'medium|barrel': [1, 0, 0, 0, 0, -1] } }, range, hs, 0.6, true);
    expect(t.cell).toBe('medium|barrel');
    expect(t.range[0] / t.range[1]).toBeCloseTo(Math.exp(2), 9);
    expect(t.range[2]).toBe(0);
  });
  it('the fit recovers the direction of a known tilt from sampled revealed holdings', () => {
    const range = new Float64Array(1326).fill(0), hs = new Float32Array(1326).fill(-1);
    for (let k = 0; k < 600; k++) { range[k] = 1; hs[k] = (k + 0.5) / 600; }
    // True betting range: weak holdings three times as likely as the base says.
    const w = Array.from({ length: 600 }, (_, k) => (hs[k] < 0.2 ? 3 : 1)); const tot = w.reduce((a, b) => a + b, 0);
    const obs: RiverObs[] = Array.from({ length: 800 }, (_, i) => {
      let u = rnd() * tot, k = 0; while (u > w[k]) { u -= w[k]; k++; }
      return { hand: `h${i}`, day: 1, range, combo: k, hs, cell: 'medium|barrel' };
    });
    const m = fitRiver(obs, 0.1);
    const th = m.theta['medium|barrel'];
    expect(th[0]).toBeGreaterThan(th[3]);
    expect(th[0] - th[3]).toBeGreaterThan(0.5);
  });
});

describe('agent: the empirical options are experimental and visible', () => {
  const riv = JSON.parse(fs.readFileSync('src/bot/strategy/v3/river-range-calibration.json', 'utf8'));
  const pop = JSON.parse(fs.readFileSync('src/bot/strategy/v3/population-calibration.json', 'utf8'));
  const b = buildSpot({ players: 6, hero: 'BTN', cards: 'Kc Jd', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9d 5s: BB x, BTN b2, BB c', '2c: BB x, BTN x', '7h: BB b4'] });
  it('version 3 with them says which parts are empirical; without them it says nothing of the kind', () => {
    const withE = new BotAgent({ seed: 3, engine: 'v3', v3Population: pop, v3RiverRange: riv, v3Sensitivity: false }).decideSync(b.h, b.heroSeat, b.heroCards, 300);
    const without = new BotAgent({ seed: 3, engine: 'v3', v3Sensitivity: false }).decideSync(b.h, b.heroSeat, b.heroCards, 300);
    expect(withE.basis.filter((x) => x.startsWith('empirical')).length).toBe(2);
    expect(without.basis.some((x) => x.startsWith('empirical'))).toBe(false);
  });
  it('version 2 (production) ignores them completely', () => {
    const a = new BotAgent({ seed: 3, engine: 'v2', v3Population: pop, v3RiverRange: riv }).decideSync(b.h, b.heroSeat, b.heroCards, 300);
    const c = new BotAgent({ seed: 3, engine: 'v2' }).decideSync(b.h, b.heroSeat, b.heroCards, 300);
    expect(a.action).toBe(c.action);
    expect(a.to).toBe(c.to);
    expect(a.candidates.map((x) => x.ev)).toEqual(c.candidates.map((x) => x.ev));
  });
});

describe('provenance of the real hand histories', () => {
  it('the source record passes the Phase 2.2 validator and lists exactly the deterministic sample of the pinned dataset', async () => {
    const { validateSource } = await import('../../sim/bot/data/validate');
    const { sampleList } = await import('../../sim/bot/data/fetch-handhq');
    const src = JSON.parse(fs.readFileSync('sim/bot/data/sources/handhq-2009-sample-v1.json', 'utf8'));
    expect(validateSource(src).filter((i) => i.level === 'error')).toEqual([]);
    expect(src.kind).toBe('human-hands');
    expect(src.labelSemantics).toBe('human-action');
    const want = sampleList(30).map((x) => `phh-handhq/${x.folder}/${x.file}`).sort();
    expect(src.files.map((f: { path: string }) => f.path).sort()).toEqual(want);
    expect(src.origin).toContain('e47fbd5816372360bade4de5d712346fe1bb70f6');
  });
});
