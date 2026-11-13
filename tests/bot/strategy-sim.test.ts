import { describe, expect, it } from 'vitest';
import { CardId, parseCards } from '../../src/bot/cards';
import { BotAgent, DecisionCancelled } from '../../src/bot/agent';
import { emptyProfile } from '../../src/bot/opponents/profile';
import { opponentPreflopRange, openFraction, jamFraction } from '../../src/bot/ranges/preflop-model';
import { rangeFraction } from '../../src/bot/ranges/range';
import { archetypePolicy, botPolicy, callingStationPolicy, POLICY_FACTORIES, randomPolicy } from '../../src/bot/sim/policies';
import { bb100, pairedDiff, playSession } from '../../src/bot/sim/table';
import { dealBoard, HandState, validateAction } from '../../src/bot/table/engine';
import { planBudget, SAFETY_MARGIN_MS, shouldStop } from '../../src/bot/time/budget';
import { act, mk } from './helpers';

const c2 = (s: string) => parseCards(s) as [CardId, CardId];
const agent = () => new BotAgent({ seed: 7 });
/** Fold everyone until `seat` is to act. */
const foldTo = (h: HandState, seat: number) => { while (h.toAct !== seat) act(h, 'fold'); };

describe('preflop strategy across table sizes', () => {
  it('raises aces first-in from every seat at every table size and never folds for free', () => {
    for (let n = 2; n <= 10; n++) {
      for (let seat = 0; seat < n; seat++) {
        const h = mk(n);
        if (h.seats[seat].pos!.isBigBlind) continue;
        foldTo(h, seat);
        const d = agent().decideSync(h, seat, c2('Ah Ad'));
        expect(d.action, `n=${n} seat=${seat}`).toBe('raise');
        expect(validateAction(h, { seat, kind: d.action, to: d.to })).toBeNull();
      }
    }
  });

  it('folds 7-2 offsuit under the gun at a nine-handed table and explains the source', () => {
    const h = mk(9);
    const d = agent().decideSync(h, h.toAct!, c2('7h 2d'));
    expect(d.action).toBe('fold');
    expect(d.basis.join(' ')).toMatch(/heuristic: UTG opens top/);
    expect(d.mode).toBe('multiway');
    expect(d.counts.dealtIn).toBe(9);
  });

  it('uses 6-max charts for the last six seats and the heads-up chart only at a two-player table', () => {
    const h9 = mk(9);
    const co = h9.seats.find((s) => s.pos!.label === 'CO')!.seat;
    foldTo(h9, co);
    expect(agent().decideSync(h9, co, c2('Ah Kd')).basis.join(' ')).toMatch(/precomputed-chart: 6-max CO-RFI/);

    const hu = mk(2);
    const d = agent().decideSync(hu, 0, c2('9h 4h'));
    expect(d.mode).toBe('heads-up-table');
    expect(d.basis.join(' ')).toMatch(/heads-up table RFI/);
    expect(d.action).toBe('raise'); // the heads-up button opens very wide

    // Three-handed, button folds: heads-up POT but ring-game ranges (scenario C).
    const h3 = mk(3);
    act(h3, 'fold');
    const d3 = agent().decideSync(h3, 1, c2('9h 4h'));
    expect(d3.mode).toBe('heads-up-pot');
    expect(d3.basis.join(' ')).toMatch(/6-max SB-RFI/);
  });

  it('opens tighter with more players behind', () => {
    for (let b = 2; b < 9; b++) expect(openFraction(b + 1, false)).toBeLessThan(openFraction(b, false));
    expect(jamFraction(8)).toBeGreaterThan(jamFraction(20));
    // K9o: a button open, an early-position fold at ten-handed.
    const h = mk(10);
    expect(agent().decideSync(h, h.toAct!, c2('Kh 9d')).action).toBe('fold');
    const btn = mk(10);
    foldTo(btn, 0);
    expect(agent().decideSync(btn, 0, c2('Kh 9d')).action).toBe('raise');
  });

  it('short stacks jam or fold (edge case 23) and deep stacks do not (edge case 24)', () => {
    const short = mk(6, { stacks: [160, 160, 160, 160, 160, 160] }); // 8bb
    foldTo(short, 0);
    const d = agent().decideSync(short, 0, c2('Ah 8d'));
    expect(d.action).toBe('raise');
    expect(d.to).toBe(160);
    expect(d.basis.join(' ')).toMatch(/short-stack/);
    const trash = agent().decideSync(short, 0, c2('7h 2d'));
    expect(trash.action).toBe('fold');
    const deep = mk(6, { stacks: Array(6).fill(8000) }); // 400bb
    foldTo(deep, 0);
    const dd = agent().decideSync(deep, 0, c2('Ah 8d'));
    expect(dd.action).toBe('raise');
    expect(dd.to!).toBeLessThan(200);
  });

  it('calls an all-in by computed pot odds: aces yes, weak hands no', () => {
    const mkJam = () => { const h = mk(3); act(h, 'raise', 2000); act(h, 'fold'); return h; };
    const good = agent().decideSync(mkJam(), 2, c2('Ah Ad'));
    expect(good.action).toBe('call');
    expect(good.candidates.find((c) => c.action === 'call')!.ev!).toBeGreaterThan(0);
    expect(good.equity!.equity).toBeGreaterThan(0.75);
    const bad = agent().decideSync(mkJam(), 2, c2('9h 4d'));
    expect(bad.action).toBe('fold');
    expect(bad.basis.join(' ')).toMatch(/computed: all-in call by chip EV/);
  });

  it('estimates opponent ranges from the betting line', () => {
    const h = mk(6);
    act(h, 'raise', 50); act(h, 'fold'); act(h, 'fold'); act(h, 'raise', 160); act(h, 'fold'); act(h, 'fold');
    const opener = opponentPreflopRange(h, 3), threeBettor = opponentPreflopRange(h, 0);
    expect(opener.line.kind).toBe('open');
    expect(threeBettor.line.kind).toBe('3bet');
    expect(rangeFraction(threeBettor.range)).toBeLessThan(rangeFraction(opener.range));
    expect(opponentPreflopRange(h, 1).line.kind).toBe('unacted');
  });

  it('adds light 3-bets only against a demonstrated over-folder', () => {
    const run = (withRead: boolean) => {
      let raises = 0;
      for (let i = 0; i < 300; i++) {
        const a = new BotAgent({ seed: i });
        if (withRead) { const p = emptyProfile('p3'); p.stats.foldTo3Bet = { n: 36, d: 40 }; a.profiles.set('p3', p); }
        const h = mk(6, { id: `x${i}` });
        act(h, 'raise', 50); act(h, 'fold'); act(h, 'fold');
        const d = a.decideSync(h, 0, c2('Kh 8h'));
        if (d.action === 'raise') { raises++; expect(d.adjustments.join(' ')).toMatch(/learned: p3 folds to 3-bets too often/); }
      }
      return raises;
    };
    expect(run(false)).toBeLessThan(15);
    expect(run(true)).toBeGreaterThan(60);
  });
});

describe('postflop EV engine', () => {
  const river = (heroCards: string, board: string, betTo: number) => {
    const h = mk(3);
    act(h, 'raise', 60); act(h, 'fold'); act(h, 'call'); // BTN opens, BB (seat 2) calls
    const b = parseCards(board);
    dealBoard(h, b.slice(0, 3)); act(h, 'check'); act(h, 'check');
    dealBoard(h, [b[3]]); act(h, 'check'); act(h, 'check');
    dealBoard(h, [b[4]]); act(h, 'check'); act(h, 'bet', betTo);
    return { h, cards: c2(heroCards) };
  };

  it('never folds the nuts on the river and raises for value', () => {
    const { h, cards } = river('Ah Kh', 'Qh Jh 2c 7d Th', 150);
    const d = agent().decideSync(h, 2, cards, 1500);
    expect(d.action).toBe('raise');
    expect(d.equity!.equity).toBe(1);
    const fold = d.candidates.find((c) => c.action === 'fold')!, call = d.candidates.find((c) => c.action === 'call')!;
    expect(fold.ev).toBe(0);
    expect(call.ev!).toBeCloseTo(130 + 150, 6); // pot before the bet + the bet, won every time
    expect(d.mode).toBe('heads-up-pot');
  });

  it('folds a hopeless hand to a large river bet', () => {
    const { h, cards } = river('7s 2d', 'Ah Kd Qc Js 4h', 400);
    const d = agent().decideSync(h, 2, cards, 1500);
    expect(d.action).toBe('fold');
    expect(d.candidates.find((c) => c.action === 'call')!.ev!).toBeLessThan(0);
  });

  it('always returns a legal action with a complete explanation, heads-up and multiway', () => {
    const h = mk(6);
    act(h, 'raise', 60); act(h, 'call'); act(h, 'call'); act(h, 'fold'); act(h, 'fold'); act(h, 'call');
    dealBoard(h, parseCards('9h 8h 2c'));
    const seat = h.toAct!;
    const d = agent().decideSync(h, seat, c2('Ah Th'), 800);
    expect(validateAction(h, { seat, kind: d.action, to: d.to })).toBeNull();
    expect(d.mode).toBe('multiway');
    expect(d.counts.opponentsContesting).toBe(3);
    expect(d.ranges.length).toBe(3);
    expect(d.equity!.opponents).toBe(3);
    expect(d.candidates.length).toBeGreaterThanOrEqual(4);
    for (const c of d.candidates) { expect(Number.isFinite(c.ev!)).toBe(true); expect(c.evSe!).toBeGreaterThanOrEqual(0); }
    expect(d.candidates.reduce((a, c) => a + c.freq, 0)).toBeCloseTo(1, 9);
    expect(d.uncertainty.length).toBeGreaterThan(10);
    expect(d.basis.join(' ')).toMatch(/computed: Monte Carlo EV/);
    expect(d.samples).toBe(800);
  });

  it('multiway equity is lower than heads-up equity for the same hand and board', () => {
    const multi = mk(4);
    act(multi, 'call'); act(multi, 'call'); act(multi, 'call'); act(multi, 'check');
    dealBoard(multi, parseCards('Kh 8d 3c'));
    const hu = mk(4);
    act(hu, 'fold'); act(hu, 'fold'); act(hu, 'call'); act(hu, 'check');
    dealBoard(hu, parseCards('Kh 8d 3c'));
    const a = agent().decideSync(multi, multi.toAct!, c2('8h 7h'), 3000);
    const b = agent().decideSync(hu, hu.toAct!, c2('8h 7h'), 3000);
    expect(a.equity!.opponents).toBe(3);
    expect(b.equity!.opponents).toBe(1);
    expect(a.equity!.equity).toBeLessThan(b.equity!.equity - 0.1);
  });

  it('keeps an all-in opponent in the equity calculation (scenario E)', () => {
    const h = mk(5, { stacks: [2000, 2000, 2000, 300, 2000] });
    act(h, 'raise', 300); act(h, 'call'); act(h, 'call'); act(h, 'fold'); act(h, 'fold');
    dealBoard(h, parseCards('2c 7d 9h'));
    act(h, 'bet', 200);
    const d = agent().decideSync(h, 0, c2('9c 9d'), 800);
    expect(d.counts).toMatchObject({ contesting: 3, allIn: 1, canAct: 2 });
    expect(d.equity!.opponents).toBe(2);
    expect(d.action).not.toBe('fold');
  });

  it('is deterministic for a seed', () => {
    const { h, cards } = river('Kc Qc', 'Kh 9d 4c 2s 7h', 120);
    const a = new BotAgent({ seed: 3 }).decideSync(h, 2, cards, 700);
    const b = new BotAgent({ seed: 3 }).decideSync(h, 2, cards, 700);
    expect(a.action).toBe(b.action);
    expect(a.candidates.map((c) => c.ev)).toEqual(b.candidates.map((c) => c.ev));
  });
});

describe('decision-time controller', () => {
  const base = { timeRemainingMs: 20000, street: 'flop' as const, potBB: 10, effStackBB: 100, opponents: 1, candidates: 5, stateConfidence: 1 };
  it('never plans past the action clock and keeps a safety margin', () => {
    for (const t of [0, 500, 2000, 3000, 8000, 30000]) {
      const b = planBudget({ ...base, timeRemainingMs: t, potBB: 150 });
      expect(b.hardMs).toBeLessThanOrEqual(Math.max(0, t - SAFETY_MARGIN_MS));
      expect(b.softMs).toBeLessThanOrEqual(b.hardMs);
    }
  });
  it('gives complex, high-impact spots more time than trivial ones, but saturates with pot size', () => {
    const small = planBudget({ ...base, potBB: 2, candidates: 2 });
    const big = planBudget({ ...base, potBB: 60, opponents: 4, candidates: 7 });
    expect(big.hardMs).toBeGreaterThan(2 * small.hardMs);
    expect(planBudget({ ...base, street: 'preflop' }).hardMs).toBeLessThan(small.hardMs + 400);
    const huge = planBudget({ ...base, potBB: 5000, effStackBB: 100 });
    const large = planBudget({ ...base, potBB: 80, effStackBB: 100 });
    expect(huge.hardMs).toBe(large.hardMs); // capped by what can still be lost
  });
  it('stops early when the answer is clear and keeps refining when it is close', () => {
    const b = planBudget(base);
    const p = { elapsedMs: 5, samples: 400, potChips: 400, evGap: 50, evGapSe: 2, separated: true };
    expect(shouldStop(b, p).stop).toBe(true);
    expect(shouldStop(b, { ...p, separated: false, evGap: 3, evGapSe: 4 }).stop).toBe(false);
    expect(shouldStop(b, { ...p, separated: false, evGap: 3, evGapSe: 4, elapsedMs: b.hardMs + 1 })).toMatchObject({ stop: true, reason: 'hard deadline' });
    expect(shouldStop(b, { ...p, separated: false, evGap: 0.2, evGapSe: 0.3 })).toMatchObject({ stop: true, reason: 'candidates practically tied' });
    expect(shouldStop(b, { ...p, samples: 100 }).stop).toBe(false);
  });

  it('anytime decide: reports a provisional answer, respects the deadline, and can be cancelled', async () => {
    const h = mk(4);
    act(h, 'call'); act(h, 'call'); act(h, 'call'); act(h, 'check');
    dealBoard(h, parseCards('Kh 8d 3c'));
    let clock = 0;
    const a = new BotAgent({ seed: 1, now: () => (clock += 40) }); // every clock read costs 40 "ms"
    const seen: boolean[] = [];
    const d = await a.decide(h, h.toAct!, c2('8h 7h'), { timeRemainingMs: 4000, onProgress: (x) => seen.push(x.provisional) });
    expect(seen[0]).toBe(true);
    expect(seen[seen.length - 1]).toBe(false);
    expect(d.provisional).toBe(false);
    expect(d.computeMs).toBeLessThanOrEqual(4000 - SAFETY_MARGIN_MS + 200);
    expect(d.basis.join(' ')).toMatch(/time: stopped after \d+ samples/);
    let calls = 0;
    await expect(new BotAgent().decide(h, h.toAct!, c2('8h 7h'), { isCancelled: () => ++calls > 1, yieldFn: async () => {} })).rejects.toBeInstanceOf(DecisionCancelled);
    // No time at all (time bank expired, edge case 22): still returns a valid decision immediately.
    const rushed = await new BotAgent().decide(h, h.toAct!, c2('8h 7h'), { timeRemainingMs: 0 });
    expect(validateAction(h, { seat: h.toAct!, kind: rushed.action, to: rushed.to })).toBeNull();
    expect(rushed.samples).toBeLessThanOrEqual(400);
  });
});

describe('offline simulator', () => {
  it('plays complete sessions at every table size with zero illegal actions from any policy', async () => {
    const names = Object.keys(POLICY_FACTORIES);
    for (let n = 2; n <= 10; n++) {
      const players = Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, policy: i === 0 ? botPolicy({ samples: 120, seed: n }) : POLICY_FACTORIES[names[(i + n) % names.length]]() }));
      const res = await playSession({ players, hands: 60, seed: n, smallBlind: 10, bigBlind: 20, startStack: 2000 });
      expect(res.hands).toBe(60);
      expect(res.illegal).toEqual([]);
      let net = 0;
      for (const t of res.totals.values()) net += t.net;
      expect(Math.abs(net)).toBeLessThan(1e-6);
    }
  }, 120000);

  it('is reproducible: same seed, same result', async () => {
    const run = async () => {
      const res = await playSession({
        players: [{ playerId: 'bot', policy: botPolicy({ samples: 150, seed: 5 }) }, { playerId: 'lag', policy: archetypePolicy('loose-aggressive') }, { playerId: 'tp', policy: archetypePolicy('tight-passive') }],
        hands: 150, seed: 99, smallBlind: 10, bigBlind: 20, startStack: 2000,
      });
      return [...res.totals.values()].map((t) => t.net);
    };
    expect(await run()).toEqual(await run());
  }, 60000);

  it('handles uneven stacks, antes, straddles and a tournament that ends with one winner', async () => {
    const players = [0, 1, 2, 3].map((i) => ({ playerId: `p${i}`, policy: i ? randomPolicy() : botPolicy({ samples: 100 }) }));
    const cash = await playSession({ players, hands: 80, seed: 4, smallBlind: 10, bigBlind: 20, startStack: 2000, stacks: [300, 5000, 90, 1200], ante: 5, straddle: 40 });
    expect(cash.illegal).toEqual([]);
    const t = await playSession({
      players, hands: 3000, seed: 8, smallBlind: 10, bigBlind: 20, startStack: 1000, mode: 'tournament',
      levels: Array.from({ length: 10 }, (_, i) => ({ hands: 15, smallBlind: 10 * 2 ** i, bigBlind: 20 * 2 ** i })),
    });
    expect(t.winner).not.toBeNull();
    expect(t.bustOrder.length).toBe(3);
    expect(t.illegal).toEqual([]);
  }, 60000);

  it('duplicate rotation plays each deck from every seat and statistics helpers behave', async () => {
    const players = [{ playerId: 'bot', policy: botPolicy({ samples: 100 }) }, { playerId: 'cs', policy: callingStationPolicy() }, { playerId: 'r', policy: randomPolicy() }];
    const res = await playSession({ players, hands: 90, seed: 2, smallBlind: 10, bigBlind: 20, startStack: 2000, duplicate: true });
    expect(res.hands).toBe(90);
    expect(res.totals.get('bot')!.perDeal.length).toBe(30);
    const r = bb100([1, -1, 1, -1]);
    expect(r.bb100).toBe(0);
    expect(r.ci95).toBeGreaterThan(0);
    expect(pairedDiff([2, 3, 4], [1, 2, 3])).toMatchObject({ bb100: 100, ci95: 0 });
  }, 60000);

  it('the bot learns opponent statistics that match ground truth', async () => {
    const bot = botPolicy({ samples: 80 });
    const truth = { vpip: 0, pfr: 0, opp: 0 };
    await playSession({
      players: [{ playerId: 'bot', policy: bot }, { playerId: 'lp', policy: archetypePolicy('loose-passive') }, { playerId: 'tag', policy: archetypePolicy('tight-aggressive') }],
      hands: 600, seed: 21, smallBlind: 10, bigBlind: 20, startStack: 2000,
      onHand: (r) => {
        const seat = r.h.seats.find((s) => s.playerId === 'lp')!.seat;
        const acts = r.h.events.filter((e) => e.street === 'preflop' && e.seat === seat && !e.kind.startsWith('post'));
        if (!acts.some((e) => e.kind !== 'check')) return;
        truth.opp++;
        if (acts.some((e) => e.kind === 'call' || e.kind === 'raise')) truth.vpip++;
        if (acts.some((e) => e.kind === 'raise')) truth.pfr++;
      },
    });
    const p = bot.agent.profiles.get('lp')!;
    expect(p.hands).toBe(600);
    expect(p.stats.vpip).toEqual({ n: truth.vpip, d: truth.opp });
    expect(p.stats.pfr).toEqual({ n: truth.pfr, d: truth.opp });
    expect(p.stats.vpip.n / p.stats.vpip.d).toBeGreaterThan(bot.agent.profiles.get('tag')!.stats.vpip.n / bot.agent.profiles.get('tag')!.stats.vpip.d);
  }, 60000);
});
