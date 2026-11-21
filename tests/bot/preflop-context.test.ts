// Phase 3.1: classification of the preflop decision, the source recorded for it, legality under random action
// sequences at 2-10 players, the explicit fallbacks, chart precedence and the chart-stated sizes.
import { describe, expect, it } from 'vitest';
import { BotAgent } from '../../src/bot/agent';
import { CardId, parseCards, Rng, shuffledDeck } from '../../src/bot/cards';
import { classifyPreflop, PREFLOP_SITUATIONS, PreflopSituation } from '../../src/bot/strategy/preflop-context';
import { defaultLibrary } from '../../src/bot/strategy/library/builtin';
import { applyAction, createHand, HandState, legalActions, seatOf, validateAction } from '../../src/bot/table/engine';

const BB = 100;
type Step = 'f' | 'c' | 'k' | `r${number}` | 'j';

/** n players, button seat 0, every stack `stackBB`; steps are applied to whoever is to act, in order. */
function spot(n: number, steps: Step[], stackBB = 100, extra: { straddle?: number } = {}): HandState {
  const h = createHand({ handId: `ctx-${n}-${steps.join('')}-${stackBB}`, tableSeats: 10, buttonSeat: 0, smallBlind: BB / 2, bigBlind: BB, ...extra, seats: Array.from({ length: n }, (_, i) => ({ seat: i, playerId: `p${i}`, stack: stackBB * BB })) });
  for (const st of steps) {
    const seat = h.toAct!;
    const la = legalActions(h)!;
    if (st === 'f') applyAction(h, { seat, kind: 'fold' });
    else if (st === 'c' || st === 'k') applyAction(h, { seat, kind: la.canCheck ? 'check' : 'call' });
    else if (st === 'j') applyAction(h, { seat, kind: la.raiseKind, to: la.maxRaiseTo });
    else applyAction(h, { seat, kind: la.raiseKind, to: Math.min(la.maxRaiseTo, Math.max(la.minRaiseTo, Number(st.slice(1)) * BB)) });
  }
  return h;
}
const ctxOf = (h: HandState) => classifyPreflop(h, h.toAct!);

describe('classifyPreflop: every situation (6 players, 100bb unless stated)', () => {
  const cases: [string, HandState, PreflopSituation, Record<string, unknown>][] = [
    ['UTG first in', spot(6, []), 'unopened', { raises: 0, limpers: 0, toCallBB: 1 }],
    ['CO after a UTG limp', spot(6, ['c', 'f']), 'facing-limpers', { limpers: 1 }],
    ['BB option after two limps and the SB completing', spot(6, ['c', 'c', 'f', 'f', 'c']), 'limped-bb-option', { limpers: 3, toCallBB: 0 }],
    ['HJ facing a UTG open', spot(6, ['r2.5']), 'facing-open', { raises: 1, toCallBB: 2.5 }],
    ['BTN facing an open and a call (squeeze spot)', spot(6, ['r2.5', 'c', 'f']), 'facing-open-callers', { callersSinceLastRaise: 1 }],
    ['UTG limped, HJ isolates, back to UTG after folds', spot(6, ['c', 'r4', 'f', 'f', 'f', 'f']), 'facing-iso', { heroLimped: true }],
    ['UTG opened, BTN 3-bets, back to UTG', spot(6, ['r2.5', 'f', 'f', 'r8', 'f', 'f']), 'facing-3bet', { heroRaiseLevel: 1, raises: 2 }],
    ['UTG opened, HJ called, BTN squeezes, back to UTG', spot(6, ['r2.5', 'c', 'f', 'r11', 'f', 'f']), 'facing-squeeze', { heroRaiseLevel: 1, callersSinceLastRaise: 0, callersBeforeLastRaise: 1 }],
    ['HJ flat-called, BTN 3-bets, UTG folds, back to HJ', spot(6, ['r2.5', 'c', 'f', 'r11', 'f', 'f', 'f']), 'facing-squeeze', { heroCalledRaise: true, heroRaiseLevel: 0 }],
    ['BTN facing a raise and a 3-bet (cold)', spot(6, ['r2.5', 'r8', 'f']), 'cold-facing-3bet', { raises: 2, heroRaiseLevel: 0 }],
    ['HJ 3-bet, UTG 4-bets, back to HJ', spot(6, ['r2.5', 'r8', 'f', 'f', 'f', 'f', 'r20']), 'facing-4bet', { heroRaiseLevel: 2, raises: 3 }],
    ['UTG 4-bet, HJ 5-bets, back to UTG', spot(6, ['r2.5', 'r8', 'f', 'f', 'f', 'f', 'r20', 'r45']), 'facing-5bet-plus', { heroRaiseLevel: 3 }],
    ['BTN facing three raises (cold)', spot(6, ['r2.5', 'r8', 'r20']), 'cold-facing-4bet-plus', { raises: 3 }],
  ];
  for (const [name, h, want, fields] of cases) {
    it(name, () => {
      const c = ctxOf(h);
      expect(c.situation).toBe(want);
      expect(c).toMatchObject(fields);
      expect(c.sequence.length).toBe(h.events.filter((e) => !e.kind.startsWith('post')).length);
    });
  }

  it('records the opener, the size, the multiple, players behind and blind defence', () => {
    const c = ctxOf(spot(9, ['r3', 'f', 'f', 'f', 'f', 'f', 'f', 'f'])); // UTG opens at 9-handed, folds to the BB
    expect(c.hero.position).toBe('BB');
    expect(c.opener).toMatchObject({ position: 'UTG', behindPreflop: 8, toBB: 3, overLimpers: 0 });
    expect(c.lastRaiser!.multipleOfPrevious).toBeCloseTo(3);
    expect(c.blindDefense).toBe(true);
    expect(c.toActAfterHero).toBe(0);
    expect(c.counts).toMatchObject({ dealtIn: 9, inPot: 2 });
    const u = ctxOf(spot(9, []));
    expect(u).toMatchObject({ situation: 'unopened', unactedBehind: 8, toActAfterHero: 8 });
    expect(u.hero).toMatchObject({ position: 'UTG', behindPreflop: 8, chart6: null, group: 'early' });
  });

  it('short stacks and all-ins are flagged; a straddle is not a raise', () => {
    const j = ctxOf(spot(6, ['j'], 15));
    expect(j).toMatchObject({ situation: 'facing-open', facingAllIn: true, shortStack: true });
    const big = ctxOf(spot(6, ['r45'], 100)); // a 45bb raise of a 100bb stack: committed by the 40% rule
    expect(big.facingAllIn).toBe(true);
    const s = ctxOf(spot(6, [], 100, { straddle: 2 * BB }));
    expect(s).toMatchObject({ situation: 'unopened', raises: 0, straddleBB: 2 });
  });

  it('heads-up table: the button acts first unopened, the big blind faces the open or the limp', () => {
    expect(ctxOf(spot(2, []))).toMatchObject({ situation: 'unopened', headsUpTable: true, hero: { isButton: true, isSmallBlind: true } });
    expect(ctxOf(spot(2, ['r2.5']))).toMatchObject({ situation: 'facing-open', blindDefense: true, hero: { isBigBlind: true } });
    expect(ctxOf(spot(2, ['c']))).toMatchObject({ situation: 'limped-bb-option' });
  });
});

describe('random legal preflop sequences at 2-10 players: classification and legality', () => {
  it('never throws, stays consistent, and every decision (v2, and v2 with all corrections) is legal and has a recorded source', () => {
    const rng = new Rng(3102);
    const plain = new BotAgent({ engine: 'v2', seed: 1, exploitWeight: 0 });
    const corrected = new BotAgent({ engine: 'v2', seed: 1, exploitWeight: 0, preflopCorrections: { precedence: 'documented', consistentOpener: true, chartSizes: true } });
    const seen = new Set<string>();
    let decisions = 0;
    for (let t = 0; t < 120; t++) {
      const n = 2 + rng.int(9);
      const stacks = Array.from({ length: n }, () => (5 + rng.int(246)) * BB);
      const h = createHand({ handId: `fz${t}`, tableSeats: 10, buttonSeat: rng.int(n), smallBlind: BB / 2, bigBlind: BB, straddle: rng.next() < 0.15 && n >= 3 ? 2 * BB : undefined, seats: stacks.map((stack, i) => ({ seat: i, playerId: `p${i}`, stack })) });
      const deck = shuffledDeck(rng);
      const holes = new Map(h.seats.map((s, i) => [s.seat, [deck[2 * i], deck[2 * i + 1]] as [CardId, CardId]]));
      for (let guard = 0; guard < 40 && h.street === 'preflop' && h.toAct !== null; guard++) {
        const seat = h.toAct;
        const c = classifyPreflop(h, seat);
        expect(PREFLOP_SITUATIONS).toContain(c.situation);
        const raises = h.events.filter((e) => e.street === 'preflop' && e.kind === 'raise').length;
        expect(c.raises).toBe(raises);
        if (c.situation === 'unopened') expect(raises + c.limpers).toBe(0);
        expect(c.counts.canAct).toBeLessThanOrEqual(c.counts.inPot);
        expect(c.counts.inPot).toBeLessThanOrEqual(c.counts.dealtIn);
        seen.add(`${n === 2 ? 'hu' : 'ring'}:${c.situation}`);
        for (const agent of [plain, corrected]) {
          const d = agent.decideSync(h, seat, holes.get(seat)!, 50);
          expect(validateAction(h, { seat, kind: d.action, to: d.to })).toBeNull();
          expect(d.preflop?.situation).toBe(c.situation);
          expect(['chart', 'chart-approx', 'hu-chart', 'push-fold', 'computed', 'heuristic']).toContain(d.preflop!.source);
          decisions++;
        }
        // Continue the hand with a random legal action.
        const la = legalActions(h)!;
        const u = rng.next();
        if (u < 0.35 && la.canRaise) applyAction(h, { seat, kind: la.raiseKind, to: Math.min(la.maxRaiseTo, Math.max(la.minRaiseTo, Math.round(h.currentBet * (2 + 2 * rng.next())))) });
        else if (u < 0.75) applyAction(h, { seat, kind: la.canCheck ? 'check' : 'call' });
        else applyAction(h, { seat, kind: la.canCheck ? 'check' : 'fold' });
      }
    }
    expect(decisions).toBeGreaterThan(500);
    for (const s of ['ring:unopened', 'ring:facing-open', 'ring:facing-open-callers', 'ring:facing-3bet', 'ring:cold-facing-3bet', 'hu:unopened', 'hu:facing-open']) expect(seen).toContain(s);
  }, 120000);
});

describe('Phase 3.1 corrections (offline options; versions 2 and 3 do not use them)', () => {
  const cards = (s: string) => parseCards(s) as [CardId, CardId];

  it('without options, decisions are identical to an agent constructed without the option at all', () => {
    const a = new BotAgent({ engine: 'v2', seed: 4 }), b = new BotAgent({ engine: 'v2', seed: 4, preflopCorrections: {} });
    for (const steps of [[], ['r2.5'], ['r2.5', 'c', 'f'], ['c', 'f'], ['r2.5', 'r8', 'f']] as Step[][]) {
      for (const n of [6, 9]) {
        const h = spot(n, steps);
        for (const hc of ['As Kd', '7h 6h', 'Qc Jd', '2c 2d', '9s 4c']) {
          const x = a.decideSync(h, h.toAct!, cards(hc), 50), y = b.decideSync(h, h.toAct!, cards(hc), 50);
          expect(y.candidates).toEqual(x.candidates);
          expect([y.action, y.to]).toEqual([x.action, x.to]);
        }
      }
    }
  });

  it('consistentOpener: a 9-handed UTG open is answered from the opponent model\'s own UTG range, not the 6-max UTG chart', () => {
    const h = spot(9, ['r2.5', 'f', 'f', 'f', 'f', 'f', 'f']); // folds to the SB... then BB
    const hero = h.toAct!;
    const plain = new BotAgent({ engine: 'v2', seed: 2, exploitWeight: 0 }).decideSync(h, hero, cards('Kd Qs'), 50);
    const fixed = new BotAgent({ engine: 'v2', seed: 2, exploitWeight: 0, preflopCorrections: { consistentOpener: true } }).decideSync(h, hero, cards('Kd Qs'), 50);
    expect(plain.basis.join('\n')).toMatch(/nearest seat used/);
    expect(plain.preflop!.source).toBe('chart-approx');
    expect(fixed.basis.join('\n')).not.toMatch(/nearest seat used/);
    expect(fixed.basis.join('\n')).toMatch(/NOT used, because it assumes a wider range/);
    expect(fixed.basis.join('\n')).toMatch(/heuristic: vs UTG open \(est\. \d+% range\)/);
    expect(fixed.preflop!.source).toBe('heuristic');
    // At six players nothing changes (the opener is covered by the data).
    const h6 = spot(6, ['r2.5', 'f', 'f', 'f', 'f']);
    const a = new BotAgent({ engine: 'v2', seed: 2, exploitWeight: 0 }).decideSync(h6, h6.toAct!, cards('Kd Qs'), 50);
    const b = new BotAgent({ engine: 'v2', seed: 2, exploitWeight: 0, preflopCorrections: { consistentOpener: true } }).decideSync(h6, h6.toAct!, cards('Kd Qs'), 50);
    expect(b.candidates).toEqual(a.candidates);
  });

  it('precedence: registration order picks Greenline\'s opponent-conditional BTN vs CO chart; documented precedence picks Pekarstas', () => {
    const q = { scenario: 'vs-open' as const, players: 6, heroBehind: 2, villainBehind: 3, effStackBB: 100 };
    const reg = defaultLibrary('registration').find(q)!, doc = defaultLibrary('documented').find(q)!;
    expect(reg.pack.id).toBe('greenline-6max-100bb');
    expect(reg.spot.conditional).toMatch(/page 9/);
    expect(defaultLibrary('registration').cite(reg)).toMatch(/OPPONENT-CONDITIONAL/);
    expect(doc.pack.id).toBe('pekarstas-6max-100bb');
    // Unconditional Greenline spots (opens, big blind defence) still win under both rules.
    const rfi = { scenario: 'rfi' as const, players: 6, heroBehind: 5, effStackBB: 100 };
    expect(defaultLibrary('documented').find(rfi)!.pack.id).toBe('greenline-6max-100bb');
    const bbd = { scenario: 'vs-open' as const, players: 6, heroBehind: 0, villainBehind: 2, effStackBB: 100 };
    expect(defaultLibrary('documented').find(bbd)!.pack.id).toBe('greenline-6max-100bb');
  });

  it('the raise size faced is compared with the size the data assume, and stated', () => {
    const lib = defaultLibrary();
    const m = lib.find({ scenario: 'vs-open', players: 6, heroBehind: 0, villainBehind: 2, effStackBB: 100, sizeFacedBB: 4 })!;
    expect(m.quality).toBe('approximation');
    expect(m.departures.join(' ')).toMatch(/made for a 2.5bb open, the raise faced is to 4.0bb/);
    expect(lib.find({ scenario: 'vs-open', players: 6, heroBehind: 0, villainBehind: 2, effStackBB: 100, sizeFacedBB: 2.5 })!.quality).toBe('exact');
  });

  it('chartSizes: opens follow the sizes Greenline states (3bb UTG / MP / SB, 2.5bb CO / BTN), isolation 4bb+1 / 5bb+1, 3-bets 3.6x in position', () => {
    const opt = { engine: 'v2' as const, seed: 3, exploitWeight: 0, preflopCorrections: { chartSizes: true } };
    const agent = new BotAgent(opt), plain = new BotAgent({ ...opt, preflopCorrections: {} });
    const raiseTo = (a: BotAgent, h: HandState, hc: string) => a.decideSync(h, h.toAct!, cards(hc), 50).candidates.find((c) => c.action === 'raise' && c.label.startsWith('raise'))?.to;
    expect(raiseTo(agent, spot(6, []), 'As Ad')).toBe(300);          // UTG
    expect(raiseTo(plain, spot(6, []), 'As Ad')).toBe(250);
    expect(raiseTo(agent, spot(6, ['f', 'f']), 'As Ad')).toBe(250);  // CO
    expect(raiseTo(agent, spot(9, []), 'As Ad')).toBe(300);          // 9-handed UTG: earliest documented seat's size
    expect(raiseTo(agent, spot(6, ['c', 'f', 'f']), 'As Ad')).toBe(500); // BTN isolates one limper: 4 + 1
    const bb3 = spot(6, ['f', 'f', 'r2.5', 'f']); // BTN opens, SB 3-bets: 4x out of position (unchanged)
    expect(raiseTo(agent, bb3, 'As Ad')).toBe(1000);
    const ip = spot(6, ['f', 'r2.5']); // HJ opens, CO 3-bets in position: 3.6x = 9bb
    expect(raiseTo(agent, ip, 'As Ad')).toBe(900);
    expect(raiseTo(plain, ip, 'As Ad')).toBe(750);
    expect(agent.decideSync(ip, ip.toAct!, cards('As Ad'), 50).basis.join('\n')).toMatch(/3-bet size 3.6x/);
  });

  it('labels situations the chart was not made for instead of substituting silently', () => {
    const a = new BotAgent({ engine: 'v2', seed: 5, exploitWeight: 0 });
    const overLimp = spot(6, ['c', 'r4', 'f', 'f', 'f']); // UTG limps, HJ raises over it: BB to act after the SB folds
    expect(a.decideSync(overLimp, overLimp.toAct!, cards('Kh Qh'), 50).basis.join('\n')).toMatch(/the raise came over 1 limper\(s\)/);
    const iso = spot(6, ['c', 'r4', 'f', 'f', 'f', 'f']); // back to the limper: no chart covers it (explicit heuristic)
    const d = a.decideSync(iso, iso.toAct!, cards('Kh Qh'), 50);
    expect(d.preflop).toMatchObject({ situation: 'facing-iso', source: 'heuristic' });
    const sq = spot(6, ['r2.5', 'c', 'f', 'r11', 'f', 'f']); // UTG opened, HJ called, BTN squeezed
    expect(a.decideSync(sq, sq.toAct!, cards('Kh Qh'), 50).basis.join('\n')).toMatch(/called Hero's raise before the 3-bet \(a squeeze\)/);
    const caller = spot(6, ['r2.5', 'c', 'f', 'r11', 'f', 'f', 'f']);
    expect(a.decideSync(caller, caller.toAct!, cards('8s 8d'), 50).basis.join('\n')).toMatch(/Hero called the open and now faces a 3-bet/);
    expect(seatOf(caller, caller.toAct!).pos!.label).toBe('HJ');
  });
});
