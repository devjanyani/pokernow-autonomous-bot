// Regression tests for the strategy defects confirmed against real recordings (docs/bot/STRATEGY_AUDIT.md).
// The fixture holds anonymised hand records from recommend-mode sessions: only what was visible at the table.
import { describe, expect, it } from 'vitest';
import { BotAgent } from '../../src/bot/agent';
import { CardId, comboIndex, parseCards } from '../../src/bot/cards';
import { rebuildHand, RecordedHand, recordedHeroCards } from '../../src/bot/diag/rebuild';
import { NEUTRAL, computeFeatures } from '../../src/bot/ranges/postflop-model';
import { opponentPreflopRange } from '../../src/bot/ranges/preflop-model';
import { betProb2, mixRanges, quantileTable, responseProbs2, strengthTable } from '../../src/bot/ranges/range-model';
import { fullRange, rangeFraction, removeDead, topRange } from '../../src/bot/ranges/range';
import { analyseSpot, betRole, leadSeatFor } from '../../src/bot/strategy/spot';
import { buildTable, FeatureCache } from '../../src/bot/strategy/villains';
import { defaultLibrary } from '../../src/bot/strategy/library/builtin';
import { dealBoard, legalActions } from '../../src/bot/table/engine';
import { botPolicy } from '../../src/bot/sim/policies';
import { playSession } from '../../src/bot/sim/table';
import { makePolicy } from '../../sim/bot/run';
import fixture from './fixtures/live-2026-11-13-hands.json';
import { act, mk } from './helpers';

const hands = (fixture as { hands: RecordedHand[] }).hands;
const rec = (id: string) => hands.find((h) => h.handId === id)!;
const c2 = (s: string) => parseCards(s) as [CardId, CardId];
const at = (id: string, seq: number, engine: 'v1' | 'v2', samples = 4000) => {
  const r = rec(id), h = rebuildHand(r, seq);
  expect(h.toAct).toBe(r.heroSeat);
  return { h, r, d: new BotAgent({ seed: 7, engine }).decideSync(h, r.heroSeat!, recordedHeroCards(r)!, samples) };
};
const ev = (d: ReturnType<typeof at>['d'], label: RegExp) => d.candidates.find((c) => label.test(c.label))!.ev!;

describe('recorded hands replay through the rules engine', () => {
  it('every fixture hand rebuilds to its recorded end without an invented action', () => {
    expect(hands.length).toBeGreaterThanOrEqual(15);
    for (const r of hands) {
      const h = rebuildHand(r);
      expect(h.events.length).toBe(r.events.length);
      h.events.forEach((e, i) => { expect(e.seat).toBe(r.events[i].seat); expect(e.kind).toBe(r.events[i].kind); expect(e.to).toBeCloseTo(r.events[i].to, 6); });
    }
  });
});

describe('the recorded bottom-pair hand (c-12): Hero limp-called a raise with 5d 3h against advice', () => {
  // Recorded: eight-handed 1/2. Hero (UTG) limps, MP raises to 9, BB calls, Hero calls. Flop 5h 9d Kh, pot 28.
  // BB checks. Version 0.5.1 recommended "bet small (9)"; Hero checked, MP bet 28, both folded.
  it('rebuilds the recorded context: who raised, who has the lead, where Hero sits', () => {
    const { h, r } = at('c-12', 12, 'v2', 300);
    const s = analyseSpot(h, r.heroSeat!, recordedHeroCards(r)!);
    expect(s.preflopAggressor).toBe(4);
    expect(s.leadSeat).toBe(4);
    expect(s.heroRole).toBe('into-aggressor');
    expect(s.heroBetType).toBe('lead (donk bet)');
    expect(s.position).toBe('in between');            // the big blind has already checked, the raiser acts behind
    expect(s.potType).toBe('single-raised');
    expect(s.offRange).toBe(true);                    // 53o is not a limp-calling hand in the model
  });

  it('version 1 (baseline) reproduces the recorded recommendation: a small lead', () => {
    const { d } = at('c-12', 12, 'v1');
    expect(d.label).toBe('bet small (9)');
    expect(ev(d, /^bet small/)).toBeGreaterThan(ev(d, /^check/) + 1);
  });

  it('cause 1 (v1): the big blind\'s check to the raiser removed every king from its range', () => {
    const r = rec('c-12'), h = rebuildHand(r, 12), cards = recordedHeroCards(r)!;
    const f = computeFeatures(h.board);
    const share = (legacy: boolean) => {
      const bb = buildTable(h, r.heroSeat!, cards, new Map(), 1, new FeatureCache(), legacy).villains.find((v) => v.seat === 9)!;
      const before = removeDead(opponentPreflopRange(h, 9, NEUTRAL, legacy ? undefined : defaultLibrary()).range, [...cards, ...h.board]);
      let strongBefore = 0, strongAfter = 0, allBefore = 0, allAfter = 0;
      for (let k = 0; k < 1326; k++) {
        if (f.hs[k] < 0) continue;
        allBefore += before[k]; allAfter += bb.range[k];
        if (f.hs[k] >= 0.85) { strongBefore += before[k]; strongAfter += bb.range[k]; }   // top pair good kicker or better
      }
      return { before: strongBefore / allBefore, after: strongAfter / allAfter };
    };
    const v1 = share(true), v2 = share(false);
    expect(v1.before).toBeGreaterThan(0.08);
    expect(v1.after).toBeLessThan(0.02);                  // v1: a check to the raiser "proves" no strong hand
    expect(v2.after).toBeGreaterThan(0.6 * v2.before);    // v2: checking to the raiser says little
  });

  it('cause 2 (v1): a called bet was valued as a showdown with no further betting', () => {
    // In version 1 the small lead needed only 9 chips for a share of a 55-chip pot: any hand with a quarter
    // of the equity "profited". Version 2 plays the turn out, where the pair faces bets from better hands.
    const v1 = at('c-12', 12, 'v1').d, v2 = at('c-12', 12, 'v2').d;
    expect(ev(v1, /^bet small/)).toBeGreaterThan(3);
    expect(ev(v2, /^bet small/)).toBeLessThan(ev(v1, /^bet small/));
  });

  it('version 2 no longer prefers the lead here, says what it assumed, and marks the spot lower confidence', () => {
    const { d } = at('c-12', 12, 'v2', 8000);
    expect(ev(d, /^check/)).toBeGreaterThan(ev(d, /^bet small/));
    expect(d.action).toBe('check');
    const text = d.basis.join(' | ');
    expect(text).toMatch(/last preflop raiser P4; P4 holds the betting lead/);
    expect(text).toMatch(/check: an opponent bets behind in \d+% of deals/);
    expect(text).toMatch(/out-of-distribution/);
    expect(d.confidence).toBe('lower');
    expect(d.spot!.heroBetType).toBe('lead (donk bet)');
  });

  it('after the raiser bets the pot, both engines fold the pair (as recorded)', () => {
    expect(at('c-12', 15, 'v1').d.action).toBe('fold');
    expect(at('c-12', 15, 'v2').d.action).toBe('fold');
  });
});

describe('checking is never worth less than folding', () => {
  it('recorded hand c-4 (8d 3s in the big blind, five-way limped, flop 9d 8c Th): v1 valued a check below zero', () => {
    const v1 = at('c-4', 12, 'v1').d, v2 = at('c-4', 12, 'v2').d;
    expect(ev(v1, /^check/)).toBeLessThan(-0.5);          // the defect: after checking, Hero was forced to call a bet
    expect(v1.label).toMatch(/^bet small/);               // ...so the "least bad" action was a bet with negative EV
    expect(ev(v1, /^bet small/)).toBeLessThan(0);
    expect(ev(v2, /^check/)).toBeGreaterThanOrEqual(0);
    expect(v2.action).toBe('check');
  });

  it('holds at every postflop decision the bot meets in 150 simulated six-handed hands', async () => {
    const bot = botPolicy({ samples: 250, seed: 3 });
    bot.keepDecisions = true;
    const others = ['tight-aggressive', 'loose-passive', 'range-equity', 'loose-aggressive', 'calling-station'];
    await playSession({ players: [{ playerId: 'bot', policy: bot }, ...others.map((s, i) => ({ playerId: `${s}${i}`, policy: makePolicy(s, 200, i) }))], hands: 150, seed: 77, smallBlind: 10, bigBlind: 20, startStack: 2000 });
    const post = bot.decisions.filter((d) => d.street !== 'preflop');
    expect(post.length).toBeGreaterThan(40);
    for (const d of post) {
      const chk = d.candidates.find((c) => c.action === 'check');
      if (chk) { expect(chk.ev!).toBeGreaterThanOrEqual(-1e-9); expect(d.action).not.toBe('fold'); }
      expect(d.candidates.reduce((a, c) => a + c.freq, 0)).toBeCloseTo(1, 6);
      expect(d.spot).toBeDefined();
    }
  }, 120000);
});

describe('betting lead', () => {
  const flop = () => {
    const h = mk(6);                                   // seats 0..5, button 0: SB 1, BB 2, UTG 3, HJ 4, CO 5
    act(h, 'fold'); act(h, 'fold'); act(h, 'raise', 50); act(h, 'call'); act(h, 'fold'); act(h, 'call');   // CO opens, BTN and BB call
    dealBoard(h, parseCards('Kh 9d 5s'));
    return h;
  };
  it('the last preflop raiser holds the lead on the flop; players in front of it would be leading into it', () => {
    const h = flop();
    expect(leadSeatFor(h, 'flop')).toBe(5);
    expect(betRole(h, 2, 5, new Set())).toBe('into-aggressor');
    expect(betRole(h, 5, 5, new Set([2]))).toBe('aggressor');
    expect(betRole(h, 0, 5, new Set([2, 5]))).toBe('neutral');      // the raiser has checked: a stab, not a lead
  });
  it('a street that is checked through passes no lead on', () => {
    const h = flop();
    act(h, 'check'); act(h, 'check'); act(h, 'check');
    dealBoard(h, parseCards('2c'));
    expect(leadSeatFor(h, 'turn')).toBeNull();
    expect(analyseSpot(h, 2, c2('Td 9c')).heroBetType).toBe('probe bet');
  });
  it('names the bet: continuation bet, lead, delayed continuation bet', () => {
    const h = flop();
    expect(analyseSpot(h, 2, c2('5c 4c')).heroBetType).toBe('lead (donk bet)');
    act(h, 'check');
    expect(analyseSpot(h, 5, c2('Ac Qc')).heroBetType).toBe('continuation bet');
    act(h, 'check'); act(h, 'check');
    dealBoard(h, parseCards('2c'));
    act(h, 'check');
    expect(analyseSpot(h, 5, c2('Ac Qc')).heroBetType).toBe('delayed continuation bet');
  });
  it('the model bets most with the lead and least into it, for strong and weak holdings alike', () => {
    for (const s of [0.95, 0.6, 0.2]) {
      const p = (role: 'aggressor' | 'neutral' | 'into-aggressor') => betProb2(s, { street: 'flop', betFrac: 0.5, opponents: 1, isRaise: false, tend: NEUTRAL, role });
      expect(p('aggressor')).toBeGreaterThanOrEqual(p('neutral'));
      expect(p('neutral')).toBeGreaterThan(p('into-aggressor'));
    }
  });
});

describe('range-aware strength', () => {
  const f = computeFeatures(parseCards('Kh 9d 5s'));
  it('the same holding is stronger inside a weak range than inside a strong one', () => {
    const k = comboIndex(...c2('5c 4c'));
    const weak = fullRange(), strong = topRange(0.08);
    expect(quantileTable(weak, f)[k]).toBeGreaterThan(quantileTable(strong, f)[k] + 0.15);
    expect(strengthTable(weak, weak, f)[k]).toBeGreaterThan(strengthTable(strong, strong, f)[k]);
  });
  it('a range folds less to a bet from a weaker range than from a stronger one (range advantage)', () => {
    const own = topRange(0.3);
    const fold = (opp: Float64Array) => {
      const st = strengthTable(own, opp, f);
      let w = 0, fo = 0;
      for (let k = 0; k < 1326; k++) if (own[k] > 0 && st[k] >= 0) { w += own[k]; fo += own[k] * responseProbs2(st[k], { street: 'flop', betFrac: 0.5, opponents: 1, isRaise: false, tend: NEUTRAL }).fold; }
      return fo / w;
    };
    expect(fold(fullRange())).toBeLessThan(fold(topRange(0.08)) - 0.05);
  });
  it('is calibrated: two equal ranges on common boards bet and fold near the population priors it was set to', () => {
    const boards = ['Kh 9d 5s', 'Ah 7d 2c', 'Qs Jh 4d', '9c 8c 3h', 'Td 6s 2h', 'Js 7h 7d', 'Ac Kd 8s', '8h 5d 4c'];
    const r = topRange(0.3);
    let cbet = 0, stab = 0, foldHalf = 0;
    for (const b of boards) {
      const bf = computeFeatures(parseCards(b)), st = strengthTable(r, r, bf);
      let w = 0, a = 0, n = 0, fo = 0;
      for (let k = 0; k < 1326; k++) {
        if (!(r[k] > 0) || st[k] < 0) continue;
        const ctx = { street: 'flop' as const, betFrac: 0.5, opponents: 1, isRaise: false, tend: NEUTRAL };
        w += r[k]; a += r[k] * betProb2(st[k], { ...ctx, role: 'aggressor' }); n += r[k] * betProb2(st[k], { ...ctx, role: 'neutral' }); fo += r[k] * responseProbs2(st[k], ctx).fold;
      }
      cbet += a / w / boards.length; stab += n / w / boards.length; foldHalf += fo / w / boards.length;
    }
    expect(cbet).toBeGreaterThan(0.45); expect(cbet).toBeLessThan(0.65);          // prior: continuation bet 55%
    expect(stab).toBeGreaterThan(0.3); expect(stab).toBeLessThan(0.5);            // prior: bet when checked to 40%
    expect(foldHalf).toBeGreaterThan(0.35); expect(foldHalf).toBeLessThan(0.55);  // prior: fold to a bet 45%
  });
  it('Hero\'s perceived range is the range of Hero\'s line, not Hero\'s cards', () => {
    const r = rec('c-12'), h = rebuildHand(r, 12), cards = recordedHeroCards(r)!;
    const t = buildTable(h, r.heroSeat!, cards, new Map(), 1, new FeatureCache());
    expect(t.heroPerceived[comboIndex(cards[0], cards[1])]).toBeLessThan(0.05);    // 53o is not in a limp-call range
    expect(rangeFraction(t.heroPerceived)).toBeGreaterThan(0.03);
    expect(mixRanges([t.heroPerceived]).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});

describe('range collapse', () => {
  // Three-handed: BTN opens, BB calls, both check the flop and turn, BTN bets three times the pot on the river.
  const spot = () => {
    const h = mk(3);
    act(h, 'raise', 60); act(h, 'fold'); act(h, 'call');
    const b = parseCards('Ah Kd Qc Js 4h');
    dealBoard(h, b.slice(0, 3)); act(h, 'check'); act(h, 'check');
    dealBoard(h, [b[3]]); act(h, 'check'); act(h, 'check');
    dealBoard(h, [b[4]]); act(h, 'check'); act(h, 'bet', 400);
    return h;
  };
  const straightShare = (legacy: boolean) => {
    const h = spot(), f = computeFeatures(h.board);
    const v = buildTable(h, 2, c2('7s 2d'), new Map(), 1, new FeatureCache(), legacy).villains[0];
    let s = 0, t = 0;
    for (let k = 0; k < 1326; k++) { t += v.range[k]; if (f.hs[k] > 0.9) s += v.range[k]; }
    return { share: s / t, v };
  };
  it('v1: two checks all but deleted the straights, so the overbet looked like a bluff', () => {
    expect(straightShare(true).share).toBeLessThan(0.1);
  });
  it('v2: slow-played straights stay in the range and 7-high does not bluff-raise', () => {
    const { share, v } = straightShare(false);
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeGreaterThan(3 * straightShare(true).share);
    expect(v.retained).toBeGreaterThan(straightShare(true).v.retained);
    const d = new BotAgent({ seed: 5 }).decideSync(spot(), 2, c2('7s 2d'), 3000);
    expect(d.action).toBe('fold');
    for (const c of d.candidates.filter((x) => x.action === 'raise')) expect(c.ev!).toBeLessThan(0);
  });
});

describe('preflop: the width of a raise depends on what happened before it', () => {
  it('recorded hand c-7: a big-blind raise over limpers is not read as a 42% open', () => {
    const r = rec('c-7');
    const seq = r.events.filter((e) => e.seat === r.heroSeat && !e.kind.startsWith('post') && e.street === 'preflop')[1].seq;
    const v1 = at('c-7', seq, 'v1', 300).d.basis.join(' | '), v2 = at('c-7', seq, 'v2', 300).d.basis.join(' | ');
    expect(v1).toMatch(/vs BB open \(est\. 42% range\)/);
    const m = /vs BB raise over limpers \(est\. (\d+)% range\)/.exec(v2);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThan(30);
  });
});

describe('Hero deviates from the advice and the engine keeps working', () => {
  it('gives a legal, explained decision at every recorded point where Hero was to act, including after ignored advice', () => {
    let points = 0, afterDeviation = 0;
    for (const r of hands) {
      const cards = recordedHeroCards(r)!;
      let deviated = false;
      for (const e of r.events.filter((x) => x.seat === r.heroSeat && !x.kind.startsWith('post'))) {
        const h = rebuildHand(r, e.seq);
        if (h.toAct !== r.heroSeat) continue;
        const d = new BotAgent({ seed: 7 }).decideSync(h, r.heroSeat!, cards, 300);
        const la = legalActions(h, r.heroSeat!)!;
        expect(d.candidates.some((c) => c.action === d.action)).toBe(true);
        if (d.action === 'fold') expect(la.canCheck).toBe(false);
        expect(d.basis[0]).toMatch(/^spot: /);
        expect(d.spot).toBeDefined();
        points++;
        if (deviated) afterDeviation++;
        if (d.action !== e.kind) deviated = true;
      }
    }
    expect(points).toBeGreaterThan(35);
    expect(afterDeviation).toBeGreaterThan(8);
  }, 120000);

  it('flags an off-range hand as lower confidence but still plays it on its merits (c-7: 9s 2s flops two pair)', () => {
    const r = rec('c-7');
    const seq = r.events.find((e) => e.seat === r.heroSeat && e.street === 'flop')!.seq;
    const { d } = at('c-7', seq, 'v2');
    expect(d.basis.join(' | ')).toMatch(/out-of-distribution/);
    expect(d.confidence).toBe('lower');
    expect(d.action).not.toBe('fold');
  });

  it('a hand inside the range of its line is not flagged', () => {
    const h = mk(6);
    act(h, 'fold'); act(h, 'fold'); act(h, 'fold'); act(h, 'raise', 50); act(h, 'fold'); act(h, 'call');
    dealBoard(h, parseCards('Kh 9d 5s'));
    const d = new BotAgent({ seed: 1 }).decideSync(h, 2, c2('Kd Jd'), 600);
    expect(d.basis.join(' | ')).not.toMatch(/out-of-distribution/);
    expect(d.spot!.offRange).toBe(false);
  });
});

describe('leading is not prohibited', () => {
  const bbVsBtn = () => {
    const h = mk(6);
    act(h, 'fold'); act(h, 'fold'); act(h, 'fold'); act(h, 'raise', 50); act(h, 'fold'); act(h, 'call');
    return h;
  };
  it('leads a set into the raiser for value and says so', () => {
    const h = bbVsBtn();
    dealBoard(h, parseCards('Kh 9h 5s'));
    const d = new BotAgent({ seed: 2 }).decideSync(h, 2, c2('5c 5d'), 3000);
    expect(d.action).toBe('bet');
    expect(d.basis.join(' | ')).toMatch(/bet type: lead \(donk bet\); purpose: value bet/);
  });
  it('the engine baseline (v1) and v2 are separate code paths with separate explanations', () => {
    const h = bbVsBtn();
    dealBoard(h, parseCards('Kh 9h 5s'));
    const v1 = new BotAgent({ seed: 2, engine: 'v1' }).decideSync(h, 2, c2('5c 5d'), 500);
    expect(v1.spot).toBeUndefined();
    expect(v1.basis.join(' | ')).toMatch(/^computed: Monte Carlo EV/);
  });
});
