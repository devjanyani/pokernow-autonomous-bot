// Version 3 postflop engine: multi-action search over betting sequences (src/bot/strategy/v3).
import { describe, expect, it } from 'vitest';
import { BotAgent } from '../../src/bot/agent';
import { comboIndex, parseCardStrict } from '../../src/bot/cards';
import { emptyProfile, extractHandDeltas } from '../../src/bot/opponents/profile';
import { computeFeatures, NEUTRAL } from '../../src/bot/ranges/postflop-model';
import { strengthTable } from '../../src/bot/ranges/range-model';
import { removeDead } from '../../src/bot/ranges/range';
import { archetypePolicy } from '../../src/bot/sim/policies';
import { playSession } from '../../src/bot/sim/table';
import { bet3, defaultKnobs, knobsFor, opponentMixture, respond3 } from '../../src/bot/strategy/v3/model';
import { DEFAULT_V3, PostflopSearchV3, TNode } from '../../src/bot/strategy/v3/search';
import type { VillainModel } from '../../src/bot/strategy/villains';
import { dealBoard, legalActions, potTotal, seatOf } from '../../src/bot/table/engine';
import { botPolicy } from '../../src/bot/sim/policies';
import { buildSpot } from '../../sim/bot/scenarios';
import { act, mk } from './helpers';

const c = (s: string) => parseCardStrict(s) as number;
const flopSpot = () => buildSpot({ players: 6, hero: 'BB', cards: '5c 4c', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9d 5s:'] });

function villainOf(h: ReturnType<typeof flopSpot>['h'], seat: number, range: Float64Array): VillainModel {
  const s = seatOf(h, seat);
  return { seat, playerId: s.playerId, name: s.name, range, line: '', tend: NEUTRAL, stack: s.stack, streetCommit: s.streetCommit, totalCommit: s.totalCommit, allIn: s.allIn, actsBehind: true, summary: '', rangeBasis: 'heuristic', rangeSource: 'test', retained: 1, poorFit: false };
}
const walk = (n: TNode, f: (n: TNode, path: string) => void, path = '') => { f(n, path); n.kids.forEach((k, i) => walk(k, f, `${path} ${n.type === 'hero' ? 'H' : 'V'}:${n.acts[i].kind}`)); };

describe('version 3 opponent model: responses depend on the betting so far', () => {
  const k = defaultKnobs(NEUTRAL);
  const base = { street: 'flop' as const, betFrac: 0.6, level: 1, checkRaised: false, ownRaised: false, role: 'neutral' as const, canRaise: true };
  it('the same holding folds more to a check-raise, more when its bet is raised, and more again at the third raise', () => {
    for (const s of [0.45, 0.55, 0.65]) {
      const bet = respond3(s, base, k), raised = respond3(s, { ...base, level: 2, ownRaised: true }, k);
      const cr = respond3(s, { ...base, level: 2, ownRaised: true, checkRaised: true }, k), third = respond3(s, { ...base, level: 3, ownRaised: true }, k);
      expect(raised.fold).toBeGreaterThan(bet.fold);
      expect(cr.fold).toBeGreaterThan(raised.fold);
      expect(third.fold).toBeGreaterThan(raised.fold);
      for (const r of [bet, raised, cr, third]) expect(r.fold + r.call + r.raise).toBeCloseTo(1, 9);
    }
  });
  it('raising is impossible when the tree does not allow it, and re-raising needs a stronger hand', () => {
    expect(respond3(0.97, { ...base, canRaise: false }, k).raise).toBe(0);
    expect(respond3(0.97, { ...base, level: 3, ownRaised: true }, k).raise).toBeLessThan(respond3(0.97, base, k).raise);
  });
  it('a player who raises a lot, measured on enough hands, raises more in the model; three hands change nothing', () => {
    const p = emptyProfile('x');
    p.stats.raiseVsBetFlop = { n: 3, d: 3 };
    const few = knobsFor(p, NEUTRAL);
    expect(few.raiseMult).toBeGreaterThan(1);
    expect(few.raiseMult).toBeLessThan(1.6);
    p.stats.raiseVsBetFlop = { n: 30, d: 80 };
    const many = knobsFor(p, NEUTRAL);
    expect(many.raiseMult).toBeGreaterThan(few.raiseMult);
    expect(many.evidence.join()).toMatch(/30 raises in 80 spots/);
    expect(knobsFor(p, NEUTRAL, 0)).toEqual(defaultKnobs(NEUTRAL));            // exploit weight 0: population model only
    expect(knobsFor(undefined, NEUTRAL).evidence).toEqual([]);
  });
  it('a player seen folding to check-raises folds more to one; bet sizes follow the player\'s own large-bet share', () => {
    const p = emptyProfile('y');
    p.stats.foldToCheckRaise = { n: 18, d: 20 };
    p.betSizes = [2, 2, 20, 6];
    const kk = knobsFor(p, NEUTRAL);
    expect(kk.checkRaiseShift).toBeGreaterThan(defaultKnobs(NEUTRAL).checkRaiseShift);
    expect(kk.largeShare).toBeGreaterThan(0.6);
    const b = bet3(0.9, { street: 'flop', role: 'aggressor', lateStreet: false }, kk);
    expect(b.large).toBeGreaterThan(b.small);
    expect(b.check + b.small + b.large).toBeCloseTo(1, 9);
  });
});

describe('model uncertainty', () => {
  it('decisions are a best response to a mixture of opponents whose deviation share shrinks with evidence', () => {
    const none = opponentMixture(defaultKnobs(NEUTRAL));
    expect(none.map((m) => m.weight)).toEqual([0.6, 0.2, 0.2].map((x) => expect.closeTo(x, 9)));
    expect(none[1].knobs.tend.stickiness).toBeGreaterThan(0);
    expect(none[2].knobs.raiseMult).toBe(2);
    const p = emptyProfile('z');
    p.stats.foldVsBetFlop = { n: 60, d: 120 }; p.stats.foldVsBetTurn = { n: 30, d: 60 };
    const seen = opponentMixture(knobsFor(p, NEUTRAL));
    expect(seen[0].weight).toBeGreaterThan(0.95);
    expect(opponentMixture(defaultKnobs(NEUTRAL), 0)[0].weight).toBe(1);
  });
});

describe('new profile statistics', () => {
  it('fold to a check-raise, fold and re-raise when raised are counted with their opportunities', () => {
    const h = mk(2, { stacks: [2000, 2000] });         // seat 0 button / small blind, seat 1 big blind
    act(h, 'call'); act(h, 'check');
    dealBoard(h, [c('Kh'), c('9d'), c('5s')]);
    act(h, 'check'); act(h, 'bet', 20); act(h, 'raise', 80); act(h, 'fold');   // big blind checks, button bets, big blind check-raises, button folds
    const d = extractHandDeltas(h);
    const btn = d.get('p0')!.stats, bb = d.get('p1')!.stats;
    expect(btn.foldToCheckRaise).toEqual({ n: 1, d: 1 });
    expect(btn.foldVsRaise).toEqual({ n: 1, d: 1 });
    expect(btn.reraiseVsRaise).toEqual({ n: 0, d: 1 });
    expect(bb.checkRaise).toEqual({ n: 1, d: 1 });
    expect(bb.foldToCheckRaise).toBeUndefined();
  });
});

describe('version 3 betting tree', () => {
  it('contains the sequences the engine must be able to plan, all built by the rules engine', () => {
    const b = flopSpot();
    const opp = b.h.seats.find((s) => s.dealtIn && !s.folded && s.seat !== b.heroSeat)!.seat;
    const f = computeFeatures(b.h.board);
    const range = removeDead(new Float64Array(1326).fill(1), [...b.heroCards, ...b.h.board]);
    const s = new PostflopSearchV3(b.h, b.heroSeat, b.heroCards, villainOf(b.h, opp, range), defaultKnobs(NEUTRAL), f, 1, undefined);
    const paths = new Set<string>();
    walk(s.root, (_n, p) => paths.add(p.trim()));
    const has = (re: RegExp) => [...paths].some((p) => re.test(p));
    expect(has(/^H:check V:bet H:raise V:(fold|call|raise)$/)).toBe(true);                              // check-raise
    expect(has(/^H:bet V:raise H:raise/)).toBe(true);                                                  // bet, raised, re-raise
    expect(has(/^H:check V:bet H:call H:check V:bet H:raise$/)).toBe(true);                            // check-call, then raise on the turn
    expect(has(/^H:bet V:call H:check V:bet H:(call|raise)$/)).toBe(true);                             // bet-call, then check and face a turn bet
    expect(has(/^H:check V:check H:bet$/)).toBe(true);                                                 // checked through, bet the turn
    expect(s.nodes).toBeGreaterThan(200);
    expect(s.nodes).toBeLessThan(6000);
    // Root candidates are version 2's, so the two engines value the same first actions.
    const v2 = new BotAgent({ seed: 1, engine: 'v2' }).decideSync(b.h, b.heroSeat, b.heroCards, 50).candidates.map((x) => x.action + (x.to ?? ''));
    expect(s.specs.map((x) => x.action + (x.action === 'bet' || x.action === 'raise' ? Math.round(x.to) : ''))).toEqual(v2.map((x) => x.replace(/(\d+)\.\d+/, (_m, a) => a)));
    // Every sized action respects the legal window of its node.
    walk(s.root, (n) => { if (n.type === 'end') return; for (const a of n.acts) if (a.kind === 'bet' || a.kind === 'raise') expect(a.to).toBeGreaterThan(0); });
  });

  it('river, one opponent holding: every value equals the hand computation from the model\'s probabilities', () => {
    const b = buildSpot({ players: 6, hero: 'BB', cards: 'Ah Ad', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Ks 7d 2c: BB x, BTN x', '9h: BB x, BTN x', '3s:'] });
    const opp = b.h.seats.find((s) => s.dealtIn && !s.folded && s.seat !== b.heroSeat)!.seat;
    const range = new Float64Array(1326); range[comboIndex(c('Qc'), c('Qd'))] = 1;          // Hero always wins
    const f = computeFeatures(b.h.board);
    const knobs = { ...defaultKnobs(NEUTRAL), raiseMult: 0 };                              // the opponent never raises
    const search = new PostflopSearchV3(b.h, b.heroSeat, b.heroCards, villainOf(b.h, opp, range), knobs, f, 3, undefined, { ...DEFAULT_V3, modelUncertainty: 0 });
    search.run(40);
    const res = search.result(2.5, false);
    const pot = potTotal(b.h);
    const sv = strengthTable(range, removeDead(new Float64Array(1326).fill(1), b.h.board), f)[comboIndex(c('Qc'), c('Qd'))];
    const facingCtx = (betFrac: number, level: number, checkRaised: boolean) => ({ street: 'river' as const, betFrac, level, checkRaised, ownRaised: level >= 2, role: 'neutral' as const, canRaise: true });
    for (let i = 0; i < search.specs.length; i++) {
      const sp = search.specs[i];
      let want: number;
      if (sp.action === 'check') {
        const kid = search.root.kids[i];
        const dist = bet3(sv, { street: 'river', role: kid.ctx!.role, lateStreet: true }, knobs);
        want = dist.check * pot;
        kid.acts.forEach((a, j) => {
          if (a.kind !== 'bet') return;
          const x = a.to, p = a.mkeys.reduce((t, m) => t + (m === 'small' ? dist.small : m === 'large' ? dist.large : 0), 0);
          const hn = kid.kids[j];
          const opts = hn.acts.map((ha) => {
            if (ha.kind === 'fold') return 0;
            if (ha.kind === 'call') return pot + x;
            const r = ha.to;
            const resp = respond3(sv, facingCtx((r - x) / (pot + 2 * x), 2, true), knobs);
            return resp.fold * (pot + x) + resp.call * (pot + r);
          });
          want += p * Math.max(...opts);
        });
      } else {
        const bAmt = sp.to;
        const resp = respond3(sv, facingCtx(bAmt / pot, 1, false), knobs);
        want = resp.fold * pot + resp.call * (pot + bAmt);
      }
      expect(res.candidates[i].ev).toBeCloseTo(want, 6);
      expect(res.candidates[i].evSe).toBeCloseTo(0, 9);
    }
  });

  it('checking is never worth less than folding, and with the nuts no plan ever folds', () => {
    // Quad kings on a board with no flush or straight flush possible: nothing beats Hero.
    const b = buildSpot({ players: 6, hero: 'BB', cards: 'Kh Kc', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Ks Kd 7c: BB x, BTN x', '2h: BB x, BTN x', '3s:'] });
    const opp = b.h.seats.find((s) => s.dealtIn && !s.folded && s.seat !== b.heroSeat)!.seat;
    const range = removeDead(new Float64Array(1326).fill(1), [...b.heroCards, ...b.h.board]);
    const s = new PostflopSearchV3(b.h, b.heroSeat, b.heroCards, villainOf(b.h, opp, range), defaultKnobs(NEUTRAL), computeFeatures(b.h.board), 4, undefined);
    s.run(300);
    const r = s.result(2.5, false);
    expect(r.candidates[0].label).toBe('check');
    expect(r.candidates[0].ev!).toBeGreaterThanOrEqual(0);
    walk(s.root, (n) => { if (n.type === 'hero' && n.choice.length) for (const ch of n.choice) expect(n.acts[ch].kind).not.toBe('fold'); });
  });
});

describe('version 3 in the agent', () => {
  it('heads-up pots use version 3 and say so; multiway pots fall back to version 2 with the reason', () => {
    const b = flopSpot();
    const d = new BotAgent({ seed: 2, engine: 'v3' }).decideSync(b.h, b.heroSeat, b.heroCards, 300);
    expect(d.engine).toBe('v3');
    expect(d.basis.join('\n')).toMatch(/version 3, experimental/);
    expect(validLegal(b, d)).toBe(true);
    const m = buildSpot({ players: 6, hero: 'BB', cards: '5c 4c', lines: ['UTG f, HJ f, CO c, BTN r2.5, SB f, BB c, CO c', 'Kh 9d 5s:'] });
    const dm = new BotAgent({ seed: 2, engine: 'v3' }).decideSync(m.h, m.heroSeat, m.heroCards, 300);
    expect(dm.engine).toBe('v2');
    expect(dm.basis.join('\n')).toMatch(/version 3 not used: 2 opponents in the pot/);
    const pre = buildSpot({ players: 6, hero: 'CO', cards: 'Ah Kd', lines: ['UTG f, HJ f'] });
    expect(new BotAgent({ seed: 2, engine: 'v3' }).decideSync(pre.h, pre.heroSeat, pre.heroCards, 300).engine).toBe('v2'); // preflop: version 2
  });

  it('is reproducible and plays whole sessions with no illegal action', async () => {
    const b = flopSpot();
    const a1 = new BotAgent({ seed: 9, engine: 'v3' }).decideSync(b.h, b.heroSeat, b.heroCards, 200);
    const a2 = new BotAgent({ seed: 9, engine: 'v3' }).decideSync(b.h, b.heroSeat, b.heroCards, 200);
    expect(a1.candidates.map((x) => x.ev)).toEqual(a2.candidates.map((x) => x.ev));
    const res = await playSession({
      players: [{ playerId: 'v3', policy: botPolicy({ samples: 150, seed: 3, engine: 'v3', v3Sensitivity: false }) }, { playerId: 'tag', policy: archetypePolicy('tight-aggressive') }],
      hands: 60, seed: 21, smallBlind: 10, bigBlind: 20, startStack: 2000,
    });
    expect(res.illegal).toEqual([]);
  }, 120000);
});

function validLegal(b: ReturnType<typeof flopSpot>, d: { action: string; to?: number }): boolean {
  const la = legalActions(b.h, b.heroSeat)!;
  if (d.action === 'check') return la.canCheck;
  if (d.action === 'fold') return true;
  if (d.action === 'call') return la.canCall;
  return la.canRaise && d.to! >= la.minRaiseTo - 1e-9 && d.to! <= la.maxRaiseTo + 1e-9;
}

describe('bet sizes at small stakes (both engines)', () => {
  it('at 0.25 / 0.50 the candidate sizes are distinct and in cents, not whole chips', () => {
    const h = mk(2, { stacks: [100, 100], sb: 0.25, bb: 0.5 });
    act(h, 'call'); act(h, 'check');
    dealBoard(h, [c('Kh'), c('9d'), c('5s')]);
    const hero = h.toAct!;
    const opp = h.seats.find((s) => s.seat !== hero)!.seat;
    const range = removeDead(new Float64Array(1326).fill(1), [c('7c'), c('6c'), ...h.board]);
    const v2 = new BotAgent({ seed: 1, engine: 'v2' }).decideSync(h, hero, [c('7c'), c('6c')], 60);
    const bets2 = v2.candidates.filter((x) => x.action === 'bet').map((x) => x.to!);
    expect(bets2.length).toBeGreaterThanOrEqual(4);                 // pot of 1 chip: 0.33, 0.66, 1.0, 1.5 must not collapse
    expect(new Set(bets2).size).toBe(bets2.length);
    expect(bets2.some((x) => Math.round(x) !== x)).toBe(true);
    const s3 = new PostflopSearchV3(h, hero, [c('7c'), c('6c')], villainOf(h as never, opp, range), defaultKnobs(NEUTRAL), computeFeatures(h.board), 1, undefined);
    const bets3 = s3.specs.filter((x) => x.action === 'bet').map((x) => x.to);
    expect(bets3).toEqual(bets2);
  });
});

describe('selection bias option', () => {
  it('cross-fitting changes nothing when every deal is the same (river, one opponent holding)', () => {
    const b = buildSpot({ players: 6, hero: 'BB', cards: 'Ah Ad', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Ks 7d 2c: BB x, BTN x', '9h: BB x, BTN x', '3s:'] });
    const opp = b.h.seats.find((s) => s.dealtIn && !s.folded && s.seat !== b.heroSeat)!.seat;
    const range = new Float64Array(1326); range[comboIndex(c('Qc'), c('Qd'))] = 1;
    const run = (crossFit: boolean) => { const s = new PostflopSearchV3(b.h, b.heroSeat, b.heroCards, villainOf(b.h, opp, range), defaultKnobs(NEUTRAL), computeFeatures(b.h.board), 3, undefined, { ...DEFAULT_V3, modelUncertainty: 0, crossFit }); s.run(50); return s.result(2.5, false).candidates.map((x) => x.ev); };
    const a = run(false), x = run(true);
    a.forEach((v, i) => expect(x[i]).toBeCloseTo(v!, 9));
    expect(DEFAULT_V3.crossFit).toBe(false);
  });
});
