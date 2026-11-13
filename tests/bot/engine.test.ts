import { describe, expect, it } from 'vitest';
import { parseCards, Rng, shuffledDeck } from '../../src/bot/cards';
import { assignPositions } from '../../src/bot/table/positions';
import { buildPots, settlePots } from '../../src/bot/table/pots';
import {
  applyAction, awaitingBoard, completeHand, createHand, dealBoard, HandState, IllegalActionError, legalActions,
  potBreakdown, potTotal, seatOf, tableCounts, totalChips, UnsupportedGameError, validateAction,
} from '../../src/bot/table/engine';
import { playHand } from '../../src/bot/sim/table';
import { randomPolicy } from '../../src/bot/sim/policies';
import { act, mk } from './helpers';

const label = (h: HandState, seat: number) => seatOf(h, seat).pos!.label;

describe('positions for 2-10 players', () => {
  it('labels every table size and never duplicates a label', () => {
    const expected: Record<number, string[]> = {
      2: ['BTN', 'BB'],
      3: ['BTN', 'SB', 'BB'],
      4: ['BTN', 'SB', 'BB', 'CO'],
      5: ['BTN', 'SB', 'BB', 'HJ', 'CO'],
      6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
      7: ['BTN', 'SB', 'BB', 'UTG', 'MP', 'HJ', 'CO'],
      8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'],
      9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'],
      10: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO'],
    };
    for (let n = 2; n <= 10; n++) {
      const pos = assignPositions(Array.from({ length: n }, (_, i) => i), 0);
      expect(pos.map((p) => p.label)).toEqual(expected[n]);
      expect(new Set(pos.map((p) => p.label)).size).toBe(n);
      expect(pos.map((p) => p.preflopOrder).sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it('derives positions from the button and dealt-in seats, not seat numbers', () => {
    // Seats 1, 4, 7, 9 occupied at a 10-seat table, button on seat 7.
    const pos = assignPositions([1, 4, 7, 9], 7);
    const by = Object.fromEntries(pos.map((p) => [p.seat, p.label]));
    expect(by).toEqual({ 7: 'BTN', 9: 'SB', 1: 'BB', 4: 'CO' });
    expect(pos.find((p) => p.seat === 4)!.preflopOrder).toBe(0);
    expect(pos.find((p) => p.seat === 9)!.postflopOrder).toBe(0);
  });

  it('maps the last six seats to 6-max chart positions by players behind', () => {
    const pos = assignPositions(Array.from({ length: 9 }, (_, i) => i), 0);
    const chart = Object.fromEntries(pos.map((p) => [p.label, p.chart6]));
    expect(chart).toMatchObject({ BTN: 'BTN', SB: 'SB', BB: 'BB', CO: 'CO', HJ: 'MP', LJ: 'UTG', MP: null, 'UTG+1': null, UTG: null });
  });

  it('handles a dead button and rejects bad input', () => {
    const pos = assignPositions([2, 5, 8], 6); // button seat 6 is empty -> seat 5 acts as button
    expect(pos.find((p) => p.isButton)!.seat).toBe(5);
    expect(() => assignPositions([1], 1)).toThrow();
    expect(() => assignPositions([1, 1], 1)).toThrow();
  });
});

describe('heads-up table rules (edge case 14)', () => {
  it('button posts the small blind, acts first preflop and last postflop', () => {
    const h = mk(2, { button: 0 });
    expect(seatOf(h, 0).streetCommit).toBe(10);
    expect(seatOf(h, 1).streetCommit).toBe(20);
    expect(h.toAct).toBe(0);
    act(h, 'call');
    expect(h.toAct).toBe(1); // big blind option
    act(h, 'check');
    expect(awaitingBoard(h)).toBe(true);
    dealBoard(h, parseCards('Ah Kd 2c'));
    expect(h.toAct).toBe(1); // big blind first postflop
    expect(tableCounts(h, 0).headsUpTable).toBe(true);
  });

  it('a 3-handed hand that becomes heads-up is NOT a heads-up table (scenario C)', () => {
    const h = mk(3, { button: 0 });
    act(h, 'fold'); // BTN folds
    const c = tableCounts(h, 2);
    expect(c.headsUpTable).toBe(false);
    expect(c.potType).toBe('heads-up');
    expect(c.dealtIn).toBe(3);
    expect(h.toAct).toBe(1); // SB acts before BB preflop (ring rules)
  });
});

describe('player counts (scenarios A-E)', () => {
  it('A: ten seated, eight fold -> heads-up pot at a ten-handed table', () => {
    const h = mk(10);
    expect(tableCounts(h, 2).opponentsContesting).toBe(9); // edge case 1
    act(h, 'raise', 60); // UTG seat 3
    for (let i = 0; i < 6; i++) act(h, 'fold');
    act(h, 'fold'); act(h, 'fold'); // BTN, SB
    act(h, 'call'); // BB seat 2
    const c = tableCounts(h, 2);
    expect(c).toMatchObject({ seated: 10, dealtIn: 10, folded: 8, contesting: 2, opponentsContesting: 1, potType: 'heads-up', headsUpTable: false });
  });

  it('B: four-way pot', () => {
    const h = mk(10);
    act(h, 'raise', 60); act(h, 'call'); act(h, 'call');
    for (let i = 0; i < 6; i++) act(h, 'fold');
    act(h, 'call');
    const c = tableCounts(h, 2);
    expect(c.contesting).toBe(4);
    expect(c.potType).toBe('multiway');
    expect(c.opponentsContesting).toBe(3);
  });

  it('E: all-in player still contests but cannot act', () => {
    const h = mk(5, { stacks: [2000, 2000, 2000, 300, 2000] });
    // order preflop: seat3 (HJ), seat4 (CO), seat0 BTN, seat1 SB, seat2 BB
    act(h, 'raise', 300); // seat 3 all-in
    act(h, 'call'); act(h, 'call'); act(h, 'fold'); act(h, 'fold');
    dealBoard(h, parseCards('2c 7d 9h'));
    act(h, 'bet', 200); // seat 4
    const c = tableCounts(h, 0);
    expect(c).toMatchObject({ dealtIn: 5, folded: 2, contesting: 3, allIn: 1, canAct: 2, opponentsContesting: 2, potType: 'multiway' });
    expect(h.toAct).toBe(0);
  });

  it('counts opponents still to act on the street', () => {
    const h = mk(4);
    for (let i = 0; i < 2; i++) act(h, 'call');
    act(h, 'call'); act(h, 'check');
    dealBoard(h, parseCards('2c 7d 9h'));
    expect(h.toAct).toBe(1);
    expect(tableCounts(h, 1).opponentsToActThisStreet).toBe(3);
    act(h, 'check');
    expect(tableCounts(h, 2).opponentsToActThisStreet).toBe(2);
  });

  it('players sitting out are seated but not dealt in (edge cases 9, 10)', () => {
    const h = mk(6, { sitOut: [3, 4] });
    const c = tableCounts(h, 0);
    expect(c.seated).toBe(6);
    expect(c.dealtIn).toBe(4);
    expect(label(h, 5)).toBe('CO');
    expect(seatOf(h, 3).pos).toBeNull();
    // A stack of zero is never dealt in.
    expect(tableCounts(mk(4, { stacks: [100, 0, 100, 100] }), 0).dealtIn).toBe(3);
    expect(() => mk(3, { sitOut: [0, 1] })).toThrow();
  });
});

describe('betting rules', () => {
  it('tracks street vs total contribution separately', () => {
    const h = mk(3);
    act(h, 'raise', 60); act(h, 'call'); act(h, 'call');
    dealBoard(h, parseCards('2c 7d 9h'));
    for (const s of h.seats) { expect(s.streetCommit).toBe(0); expect(s.totalCommit).toBe(60); }
    act(h, 'bet', 100);
    expect(seatOf(h, 1).streetCommit).toBe(100);
    expect(seatOf(h, 1).totalCommit).toBe(160);
    expect(legalActions(h)!.callAmount).toBe(100);
    expect(potTotal(h)).toBe(280);
  });

  it('computes the minimum raise from the last full raise', () => {
    const h = mk(3);
    expect(legalActions(h)).toMatchObject({ canCheck: false, callAmount: 20, minRaiseTo: 40, maxRaiseTo: 2000, raiseKind: 'raise' });
    act(h, 'raise', 70); // raise of 50
    expect(legalActions(h)!.minRaiseTo).toBe(120);
    expect(validateAction(h, { seat: h.toAct!, kind: 'raise', to: 100 })?.code).toBe('under-min');
    expect(validateAction(h, { seat: h.toAct!, kind: 'raise', to: 2001 })?.code).toBe('over-stack');
    expect(validateAction(h, { seat: h.toAct!, kind: 'check' })?.code).toBe('check-facing-bet');
    expect(validateAction(h, { seat: 0, kind: 'call' })?.code).toBe('out-of-turn');
    expect(() => applyAction(h, { seat: h.toAct!, kind: 'bet', to: 200 })).toThrow(IllegalActionError);
  });

  it('a short all-in raise does not reopen betting (edge case 8)', () => {
    const h = mk(3, { stacks: [2000, 150, 2000] }); // seat1 = SB with 150
    act(h, 'raise', 100);  // BTN raises to 100 (raise size 80)
    act(h, 'raise', 150);  // SB all-in to 150: only 50 more, not a full raise
    expect(seatOf(h, 1).allIn).toBe(true);
    act(h, 'call');        // BB calls 150
    // Back on the BTN: it already acted and the bet grew by less than a full raise.
    const la = legalActions(h)!;
    expect(h.toAct).toBe(0);
    expect(la.canCall).toBe(true);
    expect(la.callAmount).toBe(50);
    expect(la.canRaise).toBe(false);
    expect(validateAction(h, { seat: 0, kind: 'raise', to: 400 })?.code).toBe('raise-closed');
  });

  it('a player who has not yet acted may still raise over a short all-in', () => {
    const h = mk(3, { stacks: [2000, 150, 2000] });
    act(h, 'raise', 100); act(h, 'raise', 150);
    const la = legalActions(h)!; // BB has not acted voluntarily
    expect(la.canRaise).toBe(true);
    expect(la.minRaiseTo).toBe(230); // 150 + last full raise (80)
  });

  it('a full all-in raise does reopen betting', () => {
    const h = mk(3, { stacks: [2000, 400, 2000] });
    act(h, 'raise', 100); act(h, 'raise', 400); act(h, 'call');
    expect(legalActions(h)!.canRaise).toBe(true);
  });

  it('big blind keeps its option; hand ends early when everyone folds', () => {
    const h = mk(4);
    act(h, 'call'); act(h, 'fold'); act(h, 'call');
    expect(h.toAct).toBe(2);
    expect(legalActions(h)!.canCheck).toBe(true);
    const h2 = mk(4);
    act(h2, 'fold'); act(h2, 'fold'); act(h2, 'fold');
    expect(h2.phase).toBe('complete');
    expect(h2.payouts!.get(2)).toBe(30);
    expect(seatOf(h2, 2).stack).toBe(2010);
    expect(h2.wentToShowdown).toBe(false);
  });

  it('runs out the board when no more betting is possible', () => {
    const h = mk(2, { stacks: [500, 2000] });
    act(h, 'raise', 500); act(h, 'call');
    expect(h.toAct).toBeNull();
    dealBoard(h, parseCards('2c 7d 9h'));
    expect(h.toAct).toBeNull();
    dealBoard(h, parseCards('Jh')); dealBoard(h, parseCards('Qs'));
    expect(h.phase).toBe('showdown');
    completeHand(h, (s) => (s === 0 ? 2 : 1));
    expect(seatOf(h, 0).stack).toBe(1000);
  });

  it('supports antes and a straddle (edge case 13)', () => {
    const h = mk(5, { ante: 5, straddle: 40 });
    expect(potTotal(h)).toBe(5 * 5 + 10 + 20 + 40);
    expect(seatOf(h, 3).streetCommit).toBe(40); // seat left of the BB straddles
    expect(h.toAct).toBe(4);                    // action starts left of the straddle
    expect(legalActions(h)).toMatchObject({ callAmount: 40, minRaiseTo: 80 });
    act(h, 'call'); act(h, 'fold'); act(h, 'call'); act(h, 'call');
    expect(h.toAct).toBe(3);                    // straddler acts last and may check
    expect(legalActions(h)!.canCheck).toBe(true);
  });

  it('applies new blinds from one hand to the next (edge case 12)', () => {
    const a = mk(3, { sb: 10, bb: 20 });
    const b = mk(3, { sb: 50, bb: 100 });
    expect(legalActions(a)!.minRaiseTo).toBe(40);
    expect(legalActions(b)!.minRaiseTo).toBe(200);
  });

  it('rejects unsupported variants and bad boards (edge cases 19, 27)', () => {
    expect(() => createHand({ handId: 'x', buttonSeat: 0, smallBlind: 1, bigBlind: 2, variant: 'plo', seats: [{ seat: 0, playerId: 'a', stack: 100 }, { seat: 1, playerId: 'b', stack: 100 }] })).toThrow(UnsupportedGameError);
    const h = mk(2);
    act(h, 'call'); act(h, 'check');
    expect(() => dealBoard(h, parseCards('Ah Ah 2c'))).toThrow(IllegalActionError);
    expect(() => dealBoard(h, parseCards('Ah Kd'))).toThrow(IllegalActionError);
    const h3 = mk(2);
    expect(() => dealBoard(h3, parseCards('Ah Kd 2c'))).toThrow(/still open/);
  });
});

describe('pots (edge cases 5, 6, 7, 20, 21)', () => {
  it('builds a main pot and two side pots for three different all-in sizes', () => {
    const b = buildPots([
      { seat: 0, committed: 100, folded: false },
      { seat: 1, committed: 300, folded: false },
      { seat: 2, committed: 700, folded: false },
      { seat: 3, committed: 700, folded: false },
      { seat: 4, committed: 50, folded: true },
    ]);
    expect(b.uncalled).toBeNull();
    expect(b.pots).toEqual([
      { amount: 100 * 4 + 50, eligible: [0, 1, 2, 3] },
      { amount: 200 * 3, eligible: [1, 2, 3] },
      { amount: 400 * 2, eligible: [2, 3] },
    ]);
    // Seat 0 has the best hand: wins only the main pot. Seat 1 second best wins side pot 1.
    const paid = settlePots(b, (s) => [9, 8, 5, 7, 0][s], [0, 1, 2, 3]);
    expect(paid.get(0)).toBe(450);
    expect(paid.get(1)).toBe(600);
    expect(paid.get(3)).toBe(800);
    expect([...paid.values()].reduce((a, c) => a + c, 0)).toBe(1850);
  });

  it('returns an uncalled bet', () => {
    const b = buildPots([{ seat: 0, committed: 500, folded: false }, { seat: 1, committed: 200, folded: false }, { seat: 2, committed: 60, folded: true }]);
    expect(b.uncalled).toEqual({ seat: 0, amount: 300 });
    expect(b.pots).toEqual([{ amount: 460, eligible: [0, 1] }]);
  });

  it('splits ties and gives odd chips to the first seat left of the button', () => {
    const b = buildPots([{ seat: 0, committed: 25, folded: false }, { seat: 1, committed: 25, folded: false }, { seat: 2, committed: 25, folded: true }]);
    const paid = settlePots(b, () => 5, [1, 0]);
    expect(paid.get(1)).toBe(38);
    expect(paid.get(0)).toBe(37);
  });

  it('settles an engine hand with side pots end to end', () => {
    const h = mk(3, { stacks: [100, 1000, 1000] }); // BTN short
    act(h, 'raise', 100); act(h, 'call'); act(h, 'call');
    dealBoard(h, parseCards('2c 7d 9h'));
    act(h, 'bet', 300); act(h, 'call');
    dealBoard(h, parseCards('Jh')); act(h, 'check'); act(h, 'check');
    dealBoard(h, parseCards('Qs')); act(h, 'check'); act(h, 'check');
    expect(h.phase).toBe('showdown');
    expect(potBreakdown(h).pots).toEqual([{ amount: 300, eligible: [0, 1, 2] }, { amount: 600, eligible: [1, 2] }]);
    const before = totalChips(h);
    completeHand(h, (s) => [3, 1, 2][s]); // short stack best, then seat 2
    expect(seatOf(h, 0).stack).toBe(300);
    expect(seatOf(h, 2).stack).toBe(1200);
    expect(seatOf(h, 1).stack).toBe(600);
    expect(totalChips(h)).toBe(before);
    expect(h.wentToShowdown).toBe(true);
  });
});

describe('rules fuzz: random legal play conserves chips at every table size', () => {
  for (let n = 2; n <= 10; n++) {
    it(`${n} players, 150 random hands with uneven stacks`, async () => {
      const rng = new Rng(100 + n);
      for (let i = 0; i < 150; i++) {
        const res = await playHand({
          handId: `f${n}-${i}`, buttonSeat: i % n, smallBlind: 10, bigBlind: 20, ante: i % 3 === 0 ? 5 : 0, straddle: i % 7 === 0 ? 40 : 0,
          seats: Array.from({ length: n }, (_, s) => ({ seat: s, playerId: `p${s}`, policy: randomPolicy(), stack: 40 + rng.int(3000) })),
          deck: shuffledDeck(rng), seed: rng.int(1 << 30),
        });
        expect(res.illegal).toEqual([]);
        expect(res.h.phase).toBe('complete');
        let net = 0;
        for (const v of res.nets.values()) net += v;
        expect(Math.abs(net)).toBeLessThan(1e-6);
        for (const s of res.h.seats) expect(s.stack).toBeGreaterThanOrEqual(0);
        // Event ids are unique and sequential.
        expect(new Set(res.h.events.map((e) => e.id)).size).toBe(res.h.events.length);
      }
    });
  }
});
