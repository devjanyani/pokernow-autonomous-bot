import { describe, expect, it } from 'vitest';
import { cardsAreDistinct, comboIndex, handClass, parseCards, parseCardStrict } from '../../src/bot/cards';
import { evaluateHand } from '../../src/core/equity/hand-eval';
import { multiwayEquity, ProgressiveEquity, showdownPayout } from '../../src/bot/equity/equity';
import { CLASS_ORDER, fullRange, rangeFraction, rangeFromClasses, toWeighted, topRange } from '../../src/bot/ranges/range';
import { computeFeatures, responseProbs, NEUTRAL, betProb } from '../../src/bot/ranges/postflop-model';
import {
  applyHandToProfiles, classify, emptyProfile, exploitNotes, extractHandDeltas, PlayerProfile, posterior, sanitizeProfile, tendencies,
} from '../../src/bot/opponents/profile';
import { completeHand, dealBoard, HandState } from '../../src/bot/table/engine';
import { act, mk } from './helpers';

const c2 = (s: string) => parseCards(s) as [number, number];
const any = (dead: number[]) => toWeighted(fullRange(), dead).range;

describe('card parsing never invents a card (edge case 19)', () => {
  it('parses symbols and rejects ambiguity', () => {
    expect(parseCardStrict('A♠')).toBe(12 * 4 + 3);
    expect(parseCardStrict('10h')).toBe(8 * 4 + 0);
    expect(parseCardStrict('td')).toBe(8 * 4 + 1);
    for (const bad of ['', 'A', '1h', 'Ax', 'hh', '11c', 'A♠♠']) expect(parseCardStrict(bad)).toBeNull();
    expect(cardsAreDistinct(parseCards('Ah Kh'))).toBe(true);
    expect(cardsAreDistinct([5, 5])).toBe(false);
    expect(cardsAreDistinct([52])).toBe(false);
    expect(handClass(...c2('Kd Ah'))).toBe('AKo');
    expect(handClass(...c2('9s 9h'))).toBe('99');
  });
});

describe('seven-card ranking: kickers, ties and split pots (edge cases 20, 21)', () => {
  const r = (s: string) => evaluateHand(parseCards(s));
  it('orders categories and kickers', () => {
    expect(r('Ah Kh Qh Jh Th 2c 3d')).toBeGreaterThan(r('9c 9d 9h 9s Ad 2c 3d'));
    expect(r('Ah Ad Kc 7s 2d 9h 4c')).toBeGreaterThan(r('Ac As Qc 7s 2d 9h 4c')); // kicker K > Q
    expect(r('Ah Kd 2c 2d 7s 7h Qc')).toBe(r('Ac Ks 2c 2d 7s 7h Qc'));            // same two pair + kicker
    expect(r('5h 4d 3c 2s Ah 9d 9c')).toBeGreaterThan(r('Ah Ad 9d 9c Kc 3c 2s')); // wheel beats two pair
  });
  it('board plays: everyone ties and equity is 1/(players)', () => {
    const board = parseCards('Ah Kh Qh Jh Th');
    const hero = c2('2c 3d');
    const e2 = multiwayEquity(hero, board, [any([...hero, ...board])], 500, 1);
    expect(e2.equity).toBeCloseTo(0.5, 10);
    expect(e2.tie).toBe(1);
    const e4 = multiwayEquity(hero, board, [1, 2, 3].map(() => any([...hero, ...board])), 500, 1);
    expect(e4.equity).toBeCloseTo(0.25, 10);
  });
});

describe('equity benchmarks (Monte Carlo vs published values)', () => {
  it('AA vs KK preflop is about 82%', () => {
    const hero = c2('Ah As');
    const kk = toWeighted(rangeFromClasses(['KK']), hero).range;
    const e = multiwayEquity(hero, [], [kk], 40000, 3);
    expect(Math.abs(e.equity - 0.819)).toBeLessThan(4 * e.stdErr + 0.004);
  });
  it('AKs vs QQ is a coin flip near 46%', () => {
    const hero = c2('Ah Kh');
    const e = multiwayEquity(hero, [], [toWeighted(rangeFromClasses(['QQ']), hero).range], 40000, 4);
    expect(Math.abs(e.equity - 0.46)).toBeLessThan(4 * e.stdErr + 0.006);
  });
  it('AA vs one random hand is about 85.2%, vs nine random hands about 31%', () => {
    const hero = c2('Ad Ac');
    const one = multiwayEquity(hero, [], [any(hero)], 40000, 5);
    expect(Math.abs(one.equity - 0.852)).toBeLessThan(4 * one.stdErr + 0.004);
    const nine = multiwayEquity(hero, [], Array.from({ length: 9 }, () => any(hero)), 30000, 6);
    expect(nine.opponents).toBe(9);
    expect(Math.abs(nine.equity - 0.311)).toBeLessThan(4 * nine.stdErr + 0.008);
  });
  it('multiway equity is not the product of heads-up equities', () => {
    // JTs keeps far more equity multiway than 0.575^4 suggests (correlated outcomes).
    const hero = c2('Jh Th');
    const hu = multiwayEquity(hero, [], [any(hero)], 30000, 7).equity;
    const four = multiwayEquity(hero, [], [1, 2, 3, 4].map(() => any(hero)), 30000, 8).equity;
    expect(four).toBeGreaterThan(hu ** 4 + 0.05);
  });
  it('sampled opponent holdings never share a card', () => {
    const hero = c2('Ah Kh');
    const board = parseCards('Qh Jh 2c');
    const narrow = toWeighted(rangeFromClasses(['AA', 'KK', 'AKs', 'AKo']), [...hero, ...board]).range;
    const e = multiwayEquity(hero, board, [narrow, narrow, narrow], 3000, 9);
    expect(e.samples).toBe(3000);
    expect(e.equity).toBeGreaterThan(0);
  });
  it('refines progressively: the standard error shrinks with more samples', () => {
    const hero = c2('9h 9d');
    const p = new ProgressiveEquity(hero, parseCards('2c 7d Kh'), [any([...hero, ...parseCards('2c 7d Kh')]), any([...hero, ...parseCards('2c 7d Kh')])], 11);
    p.run(200);
    const a = p.estimate();
    p.run(6000);
    const b = p.estimate();
    expect(a.samples).toBe(200);
    expect(b.samples).toBe(6200);
    expect(b.stdErr).toBeLessThan(a.stdErr / 3);
    expect(Math.abs(a.equity - b.equity)).toBeLessThan(5 * a.stdErr);
  });
  it('is reproducible for a seed', () => {
    const hero = c2('8h 7h');
    const a = multiwayEquity(hero, [], [any(hero), any(hero)], 2000, 42);
    const b = multiwayEquity(hero, [], [any(hero), any(hero)], 2000, 42);
    expect(a.equity).toBe(b.equity);
  });
});

describe('side-pot aware payouts', () => {
  it('pays only the pots Hero is eligible for', () => {
    // Hero all-in for 100 with the best hand; two opponents have 500 each.
    expect(showdownPayout(0, [100, 500, 500], [9, 5, 7])).toBe(300);
    // Hero covers: second-best hand wins the side pot between the two big stacks.
    expect(showdownPayout(0, [500, 100, 500], [7, 9, 5])).toBe(800);
    // Folded money (rank -1) is dead and goes to the winner of the level it sits in.
    expect(showdownPayout(0, [200, 200, 60], [5, 4, -1])).toBe(460);
    // Tie splits; uncalled excess returns to Hero.
    expect(showdownPayout(0, [300, 100], [5, 5])).toBe(100 + 200);
    expect(showdownPayout(0, [100, 100], [1, 2])).toBe(0);
  });
});

describe('ranges and the behaviour model', () => {
  it('orders 169 classes and builds top-fraction ranges', () => {
    expect(CLASS_ORDER.length).toBe(169);
    expect(CLASS_ORDER[0].name).toBe('AA');
    expect(CLASS_ORDER[168].end).toBeCloseTo(1, 10);
    expect(rangeFraction(topRange(0.2))).toBeCloseTo(0.2, 2);
    expect(rangeFraction(fullRange())).toBe(1);
  });
  it('strength features: nuts near 1, draws add effective strength, river has no draw value', () => {
    const flop = computeFeatures(parseCards('Qh Jh 2c'));
    const nutDraw = comboIndex(...c2('Ah Kh'));
    const set = comboIndex(...c2('Qd Qc'));
    const air = comboIndex(...c2('7s 3d'));
    expect(flop.hs[set]).toBeGreaterThan(0.99);
    expect(flop.outs[nutDraw]).toBe(13);
    expect(flop.es[nutDraw]).toBeGreaterThan(flop.hs[nutDraw] + 0.15);
    expect(flop.es[air]).toBeLessThan(0.3);
    expect(flop.hs[comboIndex(...c2('Qh 2d'))]).toBe(-1); // blocked by the board
    const river = computeFeatures(parseCards('Qh Jh 2c 5d 9s'));
    expect(river.es[nutDraw]).toBe(river.hs[nutDraw]);
  });
  it('responses are probabilities, monotone in strength and bet size', () => {
    const ctx = { street: 'flop' as const, betFrac: 0.66, opponents: 1, isRaise: false, tend: NEUTRAL };
    let prevFold = 1;
    for (let es = 0; es <= 1.0001; es += 0.05) {
      const r = responseProbs(es, ctx);
      expect(r.fold + r.call + r.raise).toBeCloseTo(1, 9);
      expect(r.fold).toBeLessThanOrEqual(prevFold + 1e-9);
      prevFold = r.fold;
    }
    expect(responseProbs(0.5, { ...ctx, betFrac: 2 }).fold).toBeGreaterThan(responseProbs(0.5, { ...ctx, betFrac: 0.33 }).fold);
    const station = { ...NEUTRAL, stickiness: 1 };
    expect(responseProbs(0.4, { ...ctx, tend: station }).fold).toBeLessThan(responseProbs(0.4, ctx).fold);
    expect(betProb(0.95, ctx)).toBeGreaterThan(betProb(0.4, ctx));
  });
});

// ---- opponent profiles -------------------------------------------------------

/** 3-handed hand: BTN opens, SB 3-bets, BB folds, BTN folds. */
function threeBetHand(id: string): HandState {
  const h = mk(3);
  h.handId = id;
  act(h, 'raise', 60); act(h, 'raise', 200); act(h, 'fold'); act(h, 'fold');
  return h;
}

describe('opponent profiles: opportunities, dedupe, shrinkage', () => {
  it('counts numerators and true opportunity denominators', () => {
    const d = extractHandDeltas(threeBetHand('a'));
    const btn = d.get('p0')!.stats, sb = d.get('p1')!.stats, bb = d.get('p2')!.stats;
    expect(btn.vpip).toEqual({ n: 1, d: 1 });
    expect(btn.pfr).toEqual({ n: 1, d: 1 });
    expect(btn.rfi).toEqual({ n: 1, d: 1 });
    expect(btn.foldTo3Bet).toEqual({ n: 1, d: 1 });
    expect(btn.threeBet).toBeUndefined();          // the opener cannot 3-bet its own open
    expect(sb.threeBet).toEqual({ n: 1, d: 1 });
    expect(sb.rfi).toBeUndefined();                // pot was already opened: no first-in opportunity
    expect(sb.foldTo3Bet).toBeUndefined();
    expect(bb.vpip).toEqual({ n: 0, d: 1 });
    expect(bb.threeBet).toBeUndefined();           // facing two raises is not a 3-bet opportunity
  });

  it('a walk gives the big blind no VPIP opportunity', () => {
    const h = mk(3);
    act(h, 'fold'); act(h, 'fold');
    const d = extractHandDeltas(h);
    expect(d.get('p2')!.stats.vpip).toBeUndefined();
    expect(d.get('p0')!.stats.vpip).toEqual({ n: 0, d: 1 });
    expect(d.get('p1')!.stats.rfi).toEqual({ n: 0, d: 1 });
  });

  it('tracks c-bets, folds to c-bets, check-raises and showdowns', () => {
    const h = mk(3);
    act(h, 'raise', 60); act(h, 'call'); act(h, 'call');   // BTN opens, blinds call
    dealBoard(h, parseCards('2c 7d 9h'));
    act(h, 'check'); act(h, 'check'); act(h, 'bet', 90);   // BTN c-bets
    act(h, 'raise', 300); act(h, 'fold'); act(h, 'call'); // SB check-raises, BB folds, BTN calls
    dealBoard(h, parseCards('Jh')); act(h, 'check'); act(h, 'check');
    dealBoard(h, parseCards('Qs')); act(h, 'check'); act(h, 'check');
    completeHand(h, (s) => (s === 0 ? 2 : 1));
    const reveals = new Map<number, [number, number]>([[0, c2('9c 9d')], [1, c2('Ah Kh')]]);
    const d = extractHandDeltas(h, reveals);
    const btn = d.get('p0')!, sb = d.get('p1')!.stats, bb = d.get('p2')!.stats;
    expect(btn.stats.cbetFlop).toEqual({ n: 1, d: 1 });
    expect(sb.checkRaise).toEqual({ n: 1, d: 1 });
    expect(sb.foldToCbetFlop).toEqual({ n: 0, d: 1 });
    expect(bb.foldToCbetFlop).toBeUndefined();        // BB faced a c-bet AND a raise: not a clean fold-to-c-bet spot
    expect(bb.foldVsBetFlop).toEqual({ n: 1, d: 1 });
    expect(bb.checkRaise).toEqual({ n: 0, d: 1 });
    expect(btn.stats.wtsd).toEqual({ n: 1, d: 1 });
    expect(btn.stats.wsd).toEqual({ n: 1, d: 1 });
    expect(sb.wsd).toEqual({ n: 0, d: 1 });
    expect(bb.wtsd).toEqual({ n: 0, d: 1 });
    expect(btn.stats.cbetTurn).toEqual({ n: 0, d: 1 });
    expect(btn.betSizes.reduce((a, b) => a + b, 0)).toBe(1);
    expect(btn.shownN.reduce((a, b) => a + b, 0)).toBe(1);
    expect(btn.showdown!.cards).toBe('9c 9d');
  });

  it('never double-counts a hand (edge case 26) and keeps identities separate (edge case 25)', () => {
    const profiles = new Map<string, PlayerProfile>();
    const h = threeBetHand('dup');
    expect(applyHandToProfiles(profiles, h).length).toBe(3);
    expect(applyHandToProfiles(profiles, h)).toEqual([]);
    expect(profiles.get('p0')!.stats.vpip).toEqual({ n: 1, d: 1 });
    expect(profiles.get('p0')!.hands).toBe(1);
    // An unfinished hand is never applied.
    expect(applyHandToProfiles(profiles, mk(3))).toEqual([]);
    // Same display name, different id -> different profile.
    const other = threeBetHand('other');
    other.seats[0].playerId = 'someone-else'; other.seats[0].name = profiles.get('p0')!.name;
    applyHandToProfiles(profiles, other);
    expect(profiles.get('someone-else')!.hands).toBe(1);
    expect(profiles.get('p0')!.hands).toBe(1);
  });

  it('shrinks small samples toward the prior and widens with uncertainty', () => {
    const p = emptyProfile('x');
    expect(posterior(p, 'vpip').mean).toBeCloseTo(0.26, 6);
    p.stats.vpip = { n: 3, d: 3 };
    const small = posterior(p, 'vpip');
    expect(small.raw).toBe(1);
    expect(small.mean).toBeLessThan(0.45);
    expect(tendencies(p).looseness).toBeLessThan(1.15);
    p.stats.vpip = { n: 300, d: 400 };
    const big = posterior(p, 'vpip');
    expect(big.mean).toBeGreaterThan(0.7);
    expect(big.hi - big.lo).toBeLessThan(small.hi - small.lo);
    expect(tendencies(p).looseness).toBeGreaterThan(1.8);
    expect(tendencies(p, 0).looseness).toBe(1);
  });

  it('classification is probabilistic and starts unclassified', () => {
    const fresh = classify(emptyProfile('x'));
    expect(fresh.unclassified).toBe(1);
    const p = emptyProfile('lag');
    p.stats.vpip = { n: 90, d: 200 }; p.stats.aggVsCall = { n: 150, d: 200 };
    const c = classify(p);
    expect(c.looseAggressive).toBeGreaterThan(0.9);
    expect(c.tightAggressive + c.looseAggressive + c.tightPassive + c.loosePassive + c.unclassified).toBeCloseTo(1, 9);
  });

  it('exploit notes need evidence, not a couple of hands', () => {
    const p = emptyProfile('x');
    p.stats.foldTo3Bet = { n: 3, d: 3 };
    expect(exploitNotes(p)).toEqual([]);
    p.stats.foldTo3Bet = { n: 27, d: 30 };
    p.stats.callVsBetRiver = { n: 26, d: 30 };
    expect(exploitNotes(p).map((n) => n.id).sort()).toEqual(['overfold-3bet', 'river-station']);
  });

  it('repairs corrupted stored profiles', () => {
    const bad = { playerId: 'x', stats: { vpip: { n: 9, d: 2 }, pfr: { n: 'NaN', d: -4 } }, betSizes: 'oops' } as unknown as PlayerProfile;
    const p = sanitizeProfile(bad);
    expect(p.stats.vpip).toEqual({ n: 2, d: 2 });
    expect(p.stats.pfr).toEqual({ n: 0, d: 0 });
    expect(p.betSizes).toEqual([0, 0, 0, 0]);
    expect(p.stats.threeBet).toEqual({ n: 0, d: 0 });
  });
});
