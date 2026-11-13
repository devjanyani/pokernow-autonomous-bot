// ============================================================
// Seat the repository's ORIGINAL DecisionEngine (src/core/engine.ts) in the
// new simulator, for 2-6 players. This is the verified-baseline opponent: it
// lets the new agent be measured against the engine that existed before this
// work, on the same deals.
//
// The legacy engine consumes the scraper-shaped GameState, so this adapter
// rebuilds one from the rules engine's HandState exactly the way sim/ring.ts
// does (players in seat order, 6-max position template, per-street history).
// ============================================================

import '../fake-idb';
import { DecisionEngine } from '../../src/core/engine';
import { idToCard } from '../../src/core/cfr/card-utils';
import type { Action, ActionType, GameState, Player, Position, Street } from '../../src/types/poker';
import { HandState, potTotal } from '../../src/bot/table/engine';
import type { Policy, PolicyView } from '../../src/bot/sim/table';

const TEMPLATES: Record<number, Position[]> = {
  2: ['SB', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'CO'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'MP', 'CO'],
};

export function toLegacyState(h: HandState, heroSeat: number, hole: [number, number]): GameState {
  const dealt = h.seats.filter((s) => s.dealtIn);
  const n = dealt.length;
  if (n > 6) throw new Error('legacy engine supports at most 6 players');
  const btnIdx = dealt.findIndex((s) => s.pos!.isButton);
  const players: Player[] = dealt.map((s, i) => ({
    name: s.playerId, stack: s.stack, position: TEMPLATES[n][(i - btnIdx + n) % n], isDealer: i === btnIdx,
    isSittingOut: false, seatIndex: i, isHero: s.seat === heroSeat, currentBet: s.streetCommit, hasActed: false,
    ...({ folded: s.folded } as object),
  }));
  const actionHistory: Record<Street, Action[]> = { preflop: [], flop: [], turn: [], river: [] };
  for (const e of h.events) {
    if (e.kind.startsWith('post')) continue;
    const name = h.seats.find((s) => s.seat === e.seat)!.playerId;
    const type = e.kind as ActionType;
    if (type === 'bet' || type === 'raise') actionHistory[e.street].push({ type, amount: e.to, playerName: name });
    else if (type === 'call') actionHistory[e.street].push({ type, amount: e.amount, playerName: name });
    else actionHistory[e.street].push({ type, playerName: name });
  }
  const heroIndex = dealt.findIndex((s) => s.seat === heroSeat);
  return {
    tableId: 'sim', handNumber: Number(h.handId.replace(/\D/g, '').slice(-9)) || 1, street: h.street, pot: potTotal(h), sidePots: [],
    heroCards: [idToCard(hole[0]), idToCard(hole[1])], communityCards: h.board.map(idToCard), players, heroIndex,
    dealerIndex: btnIdx, activePlayerIndex: heroIndex, currentBet: h.currentBet, minRaise: h.currentBet + h.lastRaiseSize,
    bigBlind: h.bigBlind, smallBlind: h.smallBlind, actionHistory, isOurTurn: true, timestamp: 0,
  };
}

export function legacyEnginePolicy(name = 'legacy-engine'): Policy {
  const engine = new DecisionEngine();
  // Disable the legacy IndexedDB-backed tracker (no opponent stats: pure baseline strategy).
  const tr = (engine as unknown as { tracker?: { loadStats: () => Promise<void> } }).tracker;
  if (tr) tr.loadStats = async () => {};
  return {
    name,
    async act(view: PolicyView) {
      const { h, seat, hole, la } = view;
      const log = console.log; console.log = () => {};
      let d;
      try { d = await engine.decide(toLegacyState(h, seat, hole)); } finally { console.log = log; }
      switch (d.action) {
        case 'fold': return { kind: la.canCheck ? 'check' : 'fold' };
        case 'check': return { kind: la.canCheck ? 'check' : la.canCall ? 'call' : 'fold' };
        case 'call': return { kind: la.canCall ? 'call' : 'check' };
        case 'allin': return la.canRaise ? { kind: la.raiseKind, to: la.maxRaiseTo } : { kind: la.canCall ? 'call' : 'check' };
        default: {
          if (!la.canRaise) return { kind: la.canCall ? 'call' : 'check' };
          const to = Math.max(la.minRaiseTo, Math.min(la.maxRaiseTo, Math.round(d.amount ?? la.minRaiseTo)));
          return { kind: la.raiseKind, to };
        }
      }
    },
  };
}
