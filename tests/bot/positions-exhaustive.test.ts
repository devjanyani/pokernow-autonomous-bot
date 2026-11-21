// Phase 3.1: exhaustive position mapping and action order for 2-10 dealt-in players, every button seat, empty and
// sitting-out seats, dead small blind, dead button and straddle. Positions come from the seats DEALT IN to this hand,
// never from physical seat numbers.
import { describe, expect, it } from 'vitest';
import { assignPositions } from '../../src/bot/table/positions';
import { applyAction, createHand, dealBoard, HandState, legalActions, seatOf, tableCounts } from '../../src/bot/table/engine';
import { classifyPreflop, positionGroup } from '../../src/bot/strategy/preflop-context';
import { parseCards, Rng } from '../../src/bot/cards';

const EXPECTED_EARLY: Record<number, string[]> = {
  3: [], 4: ['CO'], 5: ['HJ', 'CO'], 6: ['UTG', 'HJ', 'CO'], 7: ['UTG', 'MP', 'HJ', 'CO'], 8: ['UTG', 'UTG+1', 'MP', 'HJ', 'CO'],
  9: ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'], 10: ['UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO'],
};

/** Random strictly increasing seat numbers (gaps = empty seats) of length n within 0..9. */
function seatsWithGaps(n: number, rng: Rng): number[] {
  const all = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = all.length - 1; i > 0; i--) { const j = rng.int(i + 1); [all[i], all[j]] = [all[j], all[i]]; }
  return all.slice(0, n).sort((a, b) => a - b);
}

describe('assignPositions: every table size, every button, with empty seats', () => {
  it('invariants hold for 2-10 players, all button seats, contiguous and gapped layouts, with and without a dead small blind', () => {
    const rng = new Rng(3101);
    let cases = 0;
    for (let n = 2; n <= 10; n++) {
      const layouts = [Array.from({ length: n }, (_, i) => i), ...Array.from({ length: 6 }, () => seatsWithGaps(n, rng))];
      for (const seats of layouts) {
        for (let b = 0; b < n; b++) {
          for (const dead of [false, true]) {
            const pos = assignPositions(seats, seats[b], { noSmallBlind: dead });
            cases++;
            const deadSb = dead && n > 2;
            // Every dealt seat gets exactly one position; orders are permutations of 0..n-1.
            expect(pos.map((p) => p.seat).sort((a, c) => a - c)).toEqual(seats);
            expect(pos.map((p) => p.preflopOrder).sort((a, c) => a - c)).toEqual([...Array(n).keys()]);
            expect(pos.map((p) => p.postflopOrder).sort((a, c) => a - c)).toEqual([...Array(n).keys()]);
            const btn = pos.filter((p) => p.isButton), sb = pos.filter((p) => p.isSmallBlind), bbs = pos.filter((p) => p.isBigBlind);
            expect(btn.map((p) => p.seat)).toEqual([seats[b]]);
            expect(bbs.length).toBe(1);
            expect(sb.length).toBe(deadSb ? 0 : 1);
            const next = (k: number) => seats[(b + k) % n];
            if (n === 2) {
              // Heads-up: the button posts the small blind, acts first preflop and last after the flop.
              expect(btn[0].isSmallBlind).toBe(true);
              expect(btn[0].preflopOrder).toBe(0);
              expect(btn[0].postflopOrder).toBe(1);
              expect(bbs[0].seat).toBe(next(1));
              expect(bbs[0].label).toBe('BB');
              expect(btn[0].label).toBe('BTN');
            } else {
              expect(deadSb ? bbs[0].seat : sb[0].seat).toBe(next(1));
              if (!deadSb) expect(bbs[0].seat).toBe(next(2));
              // Big blind last preflop, button last postflop, first postflop is the first seat left of the button.
              expect(bbs[0].preflopOrder).toBe(n - 1);
              expect(btn[0].postflopOrder).toBe(n - 1);
              expect(pos.find((p) => p.postflopOrder === 0)!.seat).toBe(next(1));
              // First to act preflop is the first seat after the big blind (the button when three are dealt in).
              const firstPre = pos.find((p) => p.preflopOrder === 0)!;
              expect(firstPre.seat).toBe(next(deadSb ? 2 : 3));
              // Labels: unique, the early labels in action order as documented.
              expect(new Set(pos.map((p) => p.label)).size).toBe(n);
              const early = pos.filter((p) => !p.isButton && !p.isSmallBlind && !p.isBigBlind).sort((a, c) => a.preflopOrder - c.preflopOrder).map((p) => p.label);
              if (!deadSb) expect(early).toEqual(EXPECTED_EARLY[n]);
              else expect(early.length).toBe(n - 2);
            }
            // behindPreflop = players acting after the seat in an unopened pot.
            for (const p of pos) expect(p.behindPreflop).toBe(n - 1 - p.preflopOrder);
            // chart6 by players behind (dead small blind: keyed as if it were there).
            for (const p of pos) {
              const behind = p.behindPreflop + (deadSb ? 1 : 0);
              const want = p.isBigBlind ? 'BB' : p.isSmallBlind ? 'SB' : p.isButton ? 'BTN' : behind === 3 ? 'CO' : behind === 4 ? 'MP' : behind === 5 ? 'UTG' : null;
              expect(p.chart6).toBe(want);
            }
          }
        }
      }
    }
    expect(cases).toBe(756);
  });

  it('dead button: the nearest dealt seat counter-clockwise of the button seat acts as the button', () => {
    for (let n = 3; n <= 9; n++) {
      const seats = Array.from({ length: n }, (_, i) => i + 1); // seat 0 empty and holds the (dead) button
      const pos = assignPositions(seats, 0);
      expect(pos.find((p) => p.isButton)!.seat).toBe(n); // seat n is counter-clockwise of seat 0 (wraps)
    }
  });

  it('a straddle acts last preflop; the order starts on the straddler\'s left', () => {
    for (let n = 3; n <= 10; n++) {
      const seats = [...Array(n).keys()];
      const base = assignPositions(seats, 0);
      const straddler = base.find((p) => p.preflopOrder === 0)!.seat;
      const pos = assignPositions(seats, 0, { straddleSeat: straddler });
      expect(pos.find((p) => p.seat === straddler)!.preflopOrder).toBe(n - 1);
      expect(pos.map((p) => p.preflopOrder).sort((a, c) => a - c)).toEqual([...Array(n).keys()]);
    }
  });

  it('labels 10 dealt in with a dead small blind without duplicates (0.9.2: "MP" was listed twice)', () => {
    const pos = assignPositions([...Array(10).keys()], 0, { noSmallBlind: true });
    expect(new Set(pos.map((p) => p.label)).size).toBe(10);
  });

  it('position groups: early / middle / late / blinds', () => {
    const pos = assignPositions([...Array(9).keys()], 0);
    const g = Object.fromEntries(pos.map((p) => [p.label, positionGroup(p)]));
    expect(g).toMatchObject({ UTG: 'early', 'UTG+1': 'early', MP: 'middle', LJ: 'middle', HJ: 'middle', CO: 'late', BTN: 'late', SB: 'blinds', BB: 'blinds' });
    const hu = assignPositions([0, 1], 0);
    expect(positionGroup(hu.find((p) => p.isButton)!)).toBe('late');
  });
});

function hand(seats: { seat: number; stack?: number; sittingOut?: boolean }[], button: number, extra: { noSmallBlind?: boolean; straddle?: number } = {}): HandState {
  return createHand({ handId: 'p', tableSeats: 10, buttonSeat: button, smallBlind: 50, bigBlind: 100, ...extra, seats: seats.map((s) => ({ seat: s.seat, playerId: `p${s.seat}`, stack: s.stack ?? 10000, sittingOut: s.sittingOut })) });
}

describe('rules engine action order and the four counts', () => {
  it('preflop and postflop order follow the positions for 2-10 players; folded and all-in players are skipped', () => {
    for (let n = 2; n <= 10; n++) {
      for (let b = 0; b < n; b++) {
        const h = hand([...Array(n).keys()].map((seat) => ({ seat })), b);
        const order = h.seats.slice().sort((x, y) => x.pos!.preflopOrder - y.pos!.preflopOrder).map((s) => s.seat);
        // Everyone calls (the big blind checks): the turn passes in preflop order exactly once around.
        const seen: number[] = [];
        while (h.street === 'preflop' && h.toAct !== null) {
          seen.push(h.toAct);
          const la = legalActions(h)!;
          applyAction(h, { seat: h.toAct, kind: la.canCheck ? 'check' : 'call' });
        }
        expect(seen).toEqual(order);
        if (n === 2) expect(seen[0]).toBe(b); // heads-up: the button acts first preflop
        // Flop: first to act is the first live seat left of the button (the big blind heads-up).
        dealBoard(h, parseCards('2c 7d Ks'));
        const post = h.seats.slice().sort((x, y) => x.pos!.postflopOrder - y.pos!.postflopOrder).map((s) => s.seat);
        expect(h.street).toBe('flop');
        expect(h.toAct).toBe(post[0]);
        if (n === 2) expect(h.toAct).not.toBe(b);
      }
    }
  });

  it('sitting-out players and empty seats get no position and are never asked to act; counts stay separate', () => {
    const h = hand([{ seat: 0 }, { seat: 2, sittingOut: true }, { seat: 3 }, { seat: 5 }, { seat: 6, stack: 0 }, { seat: 8 }], 0);
    const dealt = h.seats.filter((s) => s.dealtIn).map((s) => s.seat);
    expect(dealt).toEqual([0, 3, 5, 8]);
    expect(seatOf(h, 2).pos).toBeNull();
    expect(seatOf(h, 6).pos).toBeNull();
    // Button seat 0, small blind 3, big blind 5, first to act 8.
    expect(seatOf(h, 3).pos!.isSmallBlind).toBe(true);
    expect(seatOf(h, 5).pos!.isBigBlind).toBe(true);
    expect(h.toAct).toBe(8);
    const asked = new Set<number>();
    applyAction(h, { seat: 8, kind: 'raise', to: 300 }); asked.add(8);
    while (h.toAct !== null && h.street === 'preflop') { asked.add(h.toAct); applyAction(h, { seat: h.toAct, kind: h.toAct === 0 ? 'fold' : 'call' }); }
    expect([...asked].sort()).toEqual([0, 3, 5, 8]);
    const c = tableCounts(h, 3);
    expect(c).toMatchObject({ seatsAvailable: 10, seated: 6, dealtIn: 4, folded: 1, contesting: 3 });
  });

  it('players leaving and joining between hands: the next hand is positioned from its own dealt-in seats', () => {
    // Hand 1: six players, button seat 2.
    const h1 = hand([0, 1, 2, 3, 4, 5].map((seat) => ({ seat })), 2);
    expect(seatOf(h1, 3).pos!.isSmallBlind).toBe(true);
    // Hand 2: seat 3 left and seat 7 joined; the button moved to seat 3's place is not dealt: dead button rule.
    const h2 = hand([0, 1, 2, 4, 5, 7].map((seat) => ({ seat })), 3);
    expect(seatOf(h2, 2).pos!.isButton).toBe(true);
    expect(seatOf(h2, 4).pos!.isSmallBlind).toBe(true);
    expect(seatOf(h2, 5).pos!.isBigBlind).toBe(true);
    expect(h2.toAct).toBe(7);
  });

  it('classifyPreflop keeps seats, seated, dealt-in, in-pot and can-act counts apart', () => {
    const h = hand([{ seat: 0 }, { seat: 1, sittingOut: true }, { seat: 2 }, { seat: 3, stack: 150 }, { seat: 4 }, { seat: 5 }], 0);
    // Dealt: 0 (BTN), 2 (SB), 3 (BB, 150 chips), 4, 5. Seat 4 folds, seat 5 raises, button calls; small blind to act.
    applyAction(h, { seat: 4, kind: 'fold' });
    applyAction(h, { seat: 5, kind: 'raise', to: 300 });
    applyAction(h, { seat: 0, kind: 'call' });
    const c = classifyPreflop(h, 2);
    expect(c.counts).toEqual({ seats: 10, seated: 6, dealtIn: 5, inPot: 4, canAct: 4 });
    expect(c.situation).toBe('facing-open-callers');
    expect(c.callersSinceLastRaise).toBe(1);
    expect(c.toActAfterHero).toBe(1); // the big blind
    expect(c.blindDefense).toBe(true); // a blind facing one raise (with a caller: also the squeeze spot)
  });
});
