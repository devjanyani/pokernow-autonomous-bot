// Phase 3.1c: the recorded QJs and 56s preflop folds (2026-11-21, T8 hands 25 and 5), the price check candidate
// (PreflopCorrections.priceAware, off by default) and the tools used to value them.
import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import { BotAgent } from '../../src/bot/agent';
import { CardId, Rng } from '../../src/bot/cards';
import { rebuildHand, RecordedHand, recordedHeroCards } from '../../src/bot/diag/rebuild';
import { multiwayEquity } from '../../src/bot/equity/equity';
import { rangeFraction, rangeTotal, toWeighted } from '../../src/bot/ranges/range';
import { PUNISHER_FACTORIES, INDEPENDENT_FACTORIES } from '../../src/bot/sim/independent';
import { playSession, Policy } from '../../src/bot/sim/table';
import { HandState, legalActions, potTotal, seatOf, validateAction } from '../../src/bot/table/engine';
import { drawHoles, engineView, strongest, valueSpot } from '../../sim/bot/preflop-consistency';
import { referenceValues } from '../../sim/bot/reference';

const FIX = 'tests/bot/fixtures/live-2026-11-21-preflop.json';
const hands = (JSON.parse(fs.readFileSync(FIX, 'utf8')) as { hands: RecordedHand[] }).hands;
const rec = (n: string) => hands.find((h) => h.handId.endsWith(`:h${n}`))!;

function at(n: string, seq: number): { h: HandState; seat: number; cards: [CardId, CardId]; r: RecordedHand } {
  const r = rec(n);
  const h = rebuildHand(r, seq);
  expect(h.toAct).toBe(r.heroSeat);
  return { h, seat: r.heroSeat!, cards: recordedHeroCards(r)!, r };
}
const v2 = () => new BotAgent({ seed: 7 });
const price = () => new BotAgent({ seed: 7, preflopCorrections: { priceAware: true } });
const needed = (h: HandState, seat: number) => { const la = legalActions(h, seat)!; return la.callAmount / (potTotal(h) + la.callAmount); };
const freq = (d: { candidates: { action: string; freq: number }[] }, a: string) => d.candidates.filter((c) => c.action === a).reduce((t, c) => t + c.freq, 0);

describe('fixture: the recorded spots are reconstructed exactly', () => {
  it('no player name or table id is in the committed fixture', () => {
    const txt = fs.readFileSync(FIX, 'utf8');
    for (const r of hands) for (const s of r.seats) { expect(s.name).toBe(`P${s.seat}`); expect(s.playerId).toBe(`p${s.seat}`); }
    expect(txt).not.toMatch(/pglTk/);
  });

  it('h25 #10 (QJs): UTG limped, MP limped, HJ raised to 4, CO and BB called; 2 to call into 17, MP still to act', () => {
    const { h, seat, cards } = at('25', 10);
    expect(cards.length).toBe(2);
    expect(h.seats.filter((s) => s.dealtIn).length).toBe(8);
    expect(seatOf(h, seat).pos!.label).toBe('UTG');
    expect(h.smallBlind).toBe(1); expect(h.bigBlind).toBe(2); expect(h.ante).toBe(0);
    expect(potTotal(h)).toBe(17);
    expect(legalActions(h, seat)!.callAmount).toBe(2);
    expect(seatOf(h, seat).streetCommit).toBe(2);
    expect(seatOf(h, seat).stack + seatOf(h, seat).streetCommit).toBe(69);
    expect(needed(h, seat)).toBeCloseTo(2 / 19, 6);
    const live = h.seats.filter((s) => s.dealtIn && !s.folded && s.seat !== seat).map((s) => s.pos!.label).sort();
    expect(live).toEqual(['BB', 'CO', 'HJ', 'MP']);
  });

  it('h5 #13 (56s): CO isolated three limpers to 12, UTG+1 limp-re-raised to 22; 10 to call into 41, nobody behind', () => {
    const { h, seat } = at('5', 13);
    expect(h.seats.filter((s) => s.dealtIn).length).toBe(8);
    expect(seatOf(h, seat).pos!.label).toBe('CO');
    expect(potTotal(h)).toBe(41);
    expect(legalActions(h, seat)!.callAmount).toBe(10);
    expect(seatOf(h, seat).stack + seatOf(h, seat).streetCommit).toBe(97);
    expect(needed(h, seat)).toBeCloseTo(10 / 51, 6);
    expect(h.seats.filter((s) => s.dealtIn && !s.folded && s.seat !== seat).map((s) => s.pos!.label)).toEqual(['UTG+1']);
  });
});

describe('baseline (version 2, unchanged): why both hands fold', () => {
  it('h25 #10: the price-blind band "vs raise over limpers" folds QJs although its own-range equity is about twice the price', () => {
    const { h, seat, cards } = at('25', 10);
    const { d, villains } = engineView(h, seat, cards);
    expect(d.action).toBe('fold');
    expect(freq(d, 'fold')).toBe(1);
    expect(d.preflop?.source).toBe('heuristic');
    expect(d.basis.some((b) => b.startsWith('heuristic: vs HJ raise over limpers') && b.includes('continue top 9%'))).toBe(true);
    const live = villains.filter((v) => !seatOf(h, v.seat).folded);
    const e = multiwayEquity(cards, [], live.map((v) => toWeighted(v.range, cards).range), 8000, 3);
    expect(e.equity).toBeGreaterThan(0.19);
    expect(e.equity).toBeGreaterThan(1.8 * needed(h, seat));
  });

  it('h5 #13: the "vs 3-bet without a chart" band (a share of Hero\'s opening range, the price only an on/off gate) folds 56s', () => {
    const { h, seat, cards } = at('5', 13);
    const { d, villains } = engineView(h, seat, cards);
    expect(d.action).toBe('fold');
    expect(freq(d, 'fold')).toBe(1);
    expect(d.basis).toContain('heuristic: vs 3-bet without a chart: 4-bet top 2.6%, call a band of the opening range when deep');
    const e = multiwayEquity(cards, [], villains.filter((v) => !seatOf(h, v.seat).folded).map((v) => toWeighted(v.range, cards).range), 8000, 3);
    expect(e.equity).toBeGreaterThan(0.32);
    expect(rangeFraction(villains.find((v) => v.line === '3bet')!.range)).toBeLessThan(0.13);
  });

  it('an explicit priceAware: false is identical to version 2', () => {
    for (const [n, q] of [['25', 10], ['5', 13], ['58', 13]] as const) {
      const { h, seat, cards } = at(n, q);
      const a = v2().decideSync(h, seat, cards, 2000);
      const b = new BotAgent({ seed: 7, preflopCorrections: { priceAware: false } }).decideSync(h, seat, cards, 2000);
      expect(b.candidates).toEqual(a.candidates);
      expect(b.basis).toEqual(a.basis);
    }
  });
});

describe('candidate: price check in the two price-blind heuristic branches (off by default)', () => {
  it('calls h25 #10 and h5 #13, and says why', () => {
    for (const [n, q] of [['25', 10], ['5', 13]] as const) {
      const { h, seat, cards } = at(n, q);
      const base = v2().decideSync(h, seat, cards, 2000);
      const d = price().decideSync(h, seat, cards, 2000);
      expect(d.action).toBe('call');
      expect(freq(d, 'call')).toBeCloseTo(1, 9);
      expect(d.basis.some((b) => b.startsWith('phase 3.1c: price check') && b.includes('the fold share is called instead'))).toBe(true);
      // Never adds raises.
      expect(freq(d, 'raise')).toBeCloseTo(freq(base, 'raise'), 9);
      expect(validateAction(h, { seat, kind: d.action, to: d.to })).toBeNull();
    }
  });

  it('the h58 #13 control (KQo, 18 into 68, five opponents) keeps the band\'s fold share', () => {
    const { h, seat, cards } = at('58', 13);
    const base = v2().decideSync(h, seat, cards, 2000);
    const d = price().decideSync(h, seat, cards, 2000);
    expect(freq(d, 'fold')).toBeCloseTo(freq(base, 'fold'), 9);
    expect(freq(base, 'fold')).toBeGreaterThan(0.2);
    expect(d.basis.some((b) => b.includes("the band's fold stands"))).toBe(true);
  });

  it('the same QJs at a poor price folds: the h25 fixture with the iso raise to 12 instead of 4', () => {
    const r = JSON.parse(JSON.stringify(rec('25'))) as RecordedHand;
    for (const e of r.events) if (e.seq >= 5 && e.seq <= 9 && (e.kind === 'raise' || e.kind === 'call')) { e.to = 12; e.amount = e.seat === 10 ? 10 : 12; }
    const h = rebuildHand(r, 10);
    expect(legalActions(h, r.heroSeat!)!.callAmount).toBe(10);
    const d = price().decideSync(h, r.heroSeat!, recordedHeroCards(r)!, 2000);
    expect(d.action).toBe('fold');
    expect(freq(d, 'fold')).toBe(1);
  });

  it('multiway, a hand with little equity still folds under the candidate (72o in Hero\'s seat at h25 #10)', () => {
    const r = JSON.parse(JSON.stringify(rec('25'))) as RecordedHand;
    r.heroCards = ['7c', '2h'];
    const d = price().decideSync(rebuildHand(r, 10), r.heroSeat!, recordedHeroCards(r)!, 2000);
    expect(d.action).toBe('fold');
  });

  it('KNOWN LIMITATION (one reason the candidate was not adopted): heads-up against a small 3-bet it calls any two, 72o included', () => {
    // Raw equity of 72o against an 11.8% range is about 25%, and 0.92 x 25% x 51 > 10 + margin. The realisation
    // factor does not depend on the hand, so the rule cannot tell 56s from 72o here.
    const r = JSON.parse(JSON.stringify(rec('5'))) as RecordedHand;
    r.heroCards = ['7c', '2h'];
    const h = rebuildHand(r, 13);
    expect(v2().decideSync(h, r.heroSeat!, recordedHeroCards(r)!, 2000).action).toBe('fold');
    expect(price().decideSync(h, r.heroSeat!, recordedHeroCards(r)!, 2000).action).toBe('call');
  });

  it('charts and the computed all-in rule are not touched: a chart spot gives the same mix with and without the flag', () => {
    // h5 #6: Hero isolates three limpers from the CO by the chart.
    const { h, seat, cards } = at('5', 6);
    const a = v2().decideSync(h, seat, cards, 2000), b = price().decideSync(h, seat, cards, 2000);
    expect(b.candidates.map((c) => c.freq)).toEqual(a.candidates.map((c) => c.freq));
    expect(b.basis.some((x) => x.includes('price check'))).toBe(false);
  });
});

describe('valuation tools (sim/bot/preflop-consistency.ts, sim/bot/reference.ts)', () => {
  it('strongest(r, w) keeps the strongest share w of the weight', () => {
    const { h, seat, cards } = at('5', 13);
    const { villains } = engineView(h, seat, cards);
    const r = villains.find((v) => v.line === '3bet')!.range;
    const s = strongest(r, 0.5);
    expect(rangeTotal(s)).toBeCloseTo(0.5 * rangeTotal(r), 6);
    expect(strongest(r, 1)).toBe(r);
  });

  it('drawHoles never deals a card twice and respects the ranges', () => {
    const { h, seat, cards } = at('25', 10);
    const { villains } = engineView(h, seat, cards);
    const live = villains.filter((v) => !seatOf(h, v.seat).folded);
    const rng = new Rng(1);
    for (let i = 0; i < 200; i++) {
      const holes = drawHoles(live.map((v) => ({ seat: v.seat, r: v.range })), cards, rng);
      const all = [...cards, ...[...holes.values()].flat()];
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it('the reference evaluator still refuses preflop points unless asked, and a fold is worth exactly 0', async () => {
    const { h, seat, cards } = at('5', 13);
    const { villains } = engineView(h, seat, cards);
    const holes = drawHoles([{ seat: 7, r: villains.find((v) => v.seat === 7)!.range }], cards, new Rng(3));
    holes.set(seat, cards);
    const fold: Policy = { name: 'f', act: (v) => ({ kind: v.la.canCheck ? 'check' : 'fold' }) };
    const spot = { h, heroSeat: seat, holes, policies: new Map([[7, INDEPENDENT_FACTORIES.nit()]]), continuation: fold };
    await expect(referenceValues(spot, [{ kind: 'fold' }], { seed: 1 })).rejects.toThrow(/postflop/);
    const [f, c] = await referenceValues(spot, [{ kind: 'fold' }, { kind: 'call' }], { seed: 1, flopRunouts: 3, allowPreflop: true });
    expect(f.mean).toBe(0);
    expect(Number.isFinite(c.mean)).toBe(true);
    // Calling and then giving up on the flop loses exactly the increment, whatever the cards.
    const giveUp = await referenceValues({ ...spot, policies: new Map([[7, { name: 'bet', act: (v) => (v.la.canRaise && v.h.street !== 'preflop' ? { kind: v.la.raiseKind, to: v.la.minRaiseTo } : { kind: v.la.canCheck ? 'check' : 'call' }) } as Policy]]) }, [{ kind: 'call' }], { seed: 2, flopRunouts: 4, allowPreflop: true });
    expect(giveUp[0].samples.every((x) => x === -10)).toBe(true);
  });

  it('a post-hoc rake never increases a value and takes nothing without a flop', async () => {
    const { h, seat, cards } = at('5', 13);
    const { villains } = engineView(h, seat, cards);
    const holes = drawHoles([{ seat: 7, r: villains.find((v) => v.seat === 7)!.range }], cards, new Rng(4));
    holes.set(seat, cards);
    const check: Policy = { name: 'c', act: (v) => ({ kind: v.la.canCheck ? 'check' : 'call' }) };
    const spot = { h, heroSeat: seat, holes, policies: new Map([[7, check]]), continuation: check };
    const o = { seed: 5, flopRunouts: 30, allowPreflop: true };
    const [a] = await referenceValues(spot, [{ kind: 'call' }], o);
    const [b] = await referenceValues(spot, [{ kind: 'call' }], { ...o, rake: { pct: 0.05, cap: 6 } });
    a.samples.forEach((x, i) => { expect(b.samples[i]).toBeLessThanOrEqual(x + 1e-9); if (x <= 0) expect(b.samples[i]).toBe(x); });
    expect(a.samples.some((x, i) => x > 0 && b.samples[i] < x)).toBe(true);
  });

  it('valueSpot pairs every candidate on the same deals (fold 0, paired difference = the call value)', async () => {
    const { h, seat, cards } = at('5', 13);
    const { villains } = engineView(h, seat, cards);
    const v = await valueSpot(h, seat, cards, villains, [{ label: 'fold', choice: { kind: 'fold' } }, { label: 'call', choice: { kind: 'call' } }], { family: 'nit', width: 1, deals: 6, runouts: 1, seed: 9 });
    expect(v.values[0].mean).toBe(0);
    expect(v.values[1].vsFold.mean).toBeCloseTo(v.values[1].mean, 9);
  });
});

describe('value-punisher (simulator opponent, Phase 3.1c)', () => {
  it('is separate from the earlier independent pool and plays only legal actions', async () => {
    expect(Object.keys(INDEPENDENT_FACTORIES)).not.toContain('value-punisher');
    const players = [PUNISHER_FACTORIES['value-punisher'](), INDEPENDENT_FACTORIES['pot-odds-caller'](), PUNISHER_FACTORIES['value-punisher'](), INDEPENDENT_FACTORIES.trapper()]
      .map((p, i) => ({ playerId: `p${i}`, policy: p }));
    const res = await playSession({ players, hands: 150, seed: 31, smallBlind: 1, bigBlind: 2, startStack: 200, mode: 'cash' });
    expect(res.illegal).toEqual([]);
  });

  it('isolates limpers with a min-raise and 3-bets an open to 1.8x, only with strong hands', async () => {
    const p = PUNISHER_FACTORIES['value-punisher']();
    const seen: { kind: string; to?: number; bet: number; raises: number }[] = [];
    const spy: Policy = { name: 'spy', act: async (v) => { const a = await p.act(v); if (v.h.street === 'preflop') seen.push({ kind: a.kind, to: a.to, bet: v.h.currentBet, raises: v.h.raisesThisStreet }); return a; } };
    const players = [spy, INDEPENDENT_FACTORIES['pot-odds-caller'](), INDEPENDENT_FACTORIES.raiser(), INDEPENDENT_FACTORIES['pot-odds-caller']()].map((x, i) => ({ playerId: `p${i}`, policy: x }));
    await playSession({ players, hands: 400, seed: 32, smallBlind: 1, bigBlind: 2, startStack: 400, mode: 'cash' });
    const threeBets = seen.filter((s) => s.raises === 1 && s.kind === 'raise');
    expect(threeBets.length).toBeGreaterThan(0);
    for (const s of threeBets) expect([Math.round(1.8 * s.bet), ...[1, 2, 3].map((c) => (4 + c) * s.bet)]).toContain(s.to);
    const raisesFirst = seen.filter((s) => s.raises === 0 && s.kind === 'raise');
    const share = raisesFirst.length / Math.max(1, seen.filter((s) => s.raises === 0).length);
    expect(share).toBeLessThan(0.2);
  });
});
