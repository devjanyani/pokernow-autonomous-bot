// ============================================================
// Decision scenarios for the strategy engine.
//
// A scenario is a fully specified spot (table, action so far, board, Hero's
// cards, optionally an opponent profile). Two kinds of expectation exist:
//
//   property   something that follows from the rules of the game or from the
//              engine's own stated model, e.g. "checking is never worth less
//              than folding", "when a call closes the action on the river its
//              EV equals equity x pot - price", "the same hand is at least as
//              keen to bet with the betting lead and position as without".
//              These are asserted by tests/bot/scenarios.test.ts.
//   observation a comparison that is plausible poker but NOT a theorem (for
//              example "a bluff is no more attractive when leading into the
//              raiser than as a continuation bet"). Reported, never asserted.
//   reference  action frequencies from a solver for the same spot, imported
//              through a strategy pack (`references`). NONE ARE SHIPPED: no
//              authorised solver output was available. The comparison code
//              runs whenever a pack supplies them.
//
// Deliberately absent: expectations of the form "hand class X must check".
//
// `set`: 'design' scenarios were looked at while the engine was changed;
// 'held-out' scenarios were written afterwards and never used for tuning.
// ============================================================

import { BotAgent } from '../../src/bot/agent';
import { CardId, parseCards } from '../../src/bot/cards';
import { emptyProfile, PlayerProfile } from '../../src/bot/opponents/profile';
import { ActionKind, applyAction, awaitingBoard, createHand, dealBoard, HandState, potTotal, seatOf } from '../../src/bot/table/engine';
import type { Decision } from '../../src/bot/strategy/types';

export interface SpotDef {
  players: number;
  /** Stack in big blinds for everyone (default 100) or per position label. */
  stacks?: number | Record<string, number>;
  hero: string;
  cards: string;
  /**
   * One string per street. Preflop: "UTG r2.5, MP f, BTN c, SB f, BB c". Later streets start with the new
   * board cards: "Kh 9d 5h: BB x, UTG x". Actions: f fold, x check, c call, b<bb> bet, r<bb> raise-to (in big blinds).
   */
  lines: string[];
  /** Opponent statistics by position label, to test profile-dependent play. */
  profiles?: Record<string, (p: PlayerProfile) => void>;
}

export interface Built { h: HandState; heroSeat: number; heroCards: [CardId, CardId]; profiles: Map<string, PlayerProfile> }

const BB = 20;

export function buildSpot(def: SpotDef): Built {
  const n = def.players;
  const stackOf = (label: string): number => BB * (typeof def.stacks === 'number' ? def.stacks : def.stacks?.[label] ?? 100);
  // First pass with equal stacks to learn the labels, second with the requested stacks.
  const mk = (stacks: number[]) => createHand({
    handId: `scn-${def.hero}-${def.cards}-${def.lines.join('|')}`.replace(/\s+/g, ''), buttonSeat: 0, smallBlind: BB / 2, bigBlind: BB,
    seats: Array.from({ length: n }, (_, i) => ({ seat: i, playerId: `p${i}`, name: `P${i}`, stack: stacks[i] })),
  });
  const probe = mk(Array(n).fill(100 * BB));
  const labelOf = new Map(probe.seats.map((s) => [s.seat, s.pos!.label as string]));
  if (n === 2) { labelOf.set(probe.seats.find((s) => s.pos!.isButton)!.seat, 'BTN'); }
  const h = mk(probe.seats.map((s) => stackOf(labelOf.get(s.seat)!)));
  const seatBy = (label: string): number => {
    const hit = [...labelOf.entries()].find(([, l]) => l === label);
    if (!hit) throw new Error(`no position ${label} at a ${n}-handed table (have ${[...labelOf.values()].join(' ')})`);
    return hit[0];
  };
  for (const line of def.lines) {
    let body = line;
    const m = /^([^:]*):(.*)$/.exec(line);
    if (m) {
      const cards = parseCards(m[1]);
      if (!awaitingBoard(h)) throw new Error(`"${line}": the betting round is not finished`);
      dealBoard(h, cards);
      body = m[2];
    }
    for (const tok of body.split(',').map((t) => t.trim()).filter(Boolean)) {
      const [label, a] = tok.split(/\s+/);
      const seat = seatBy(label);
      if (h.toAct !== seat) throw new Error(`"${tok}": it is ${labelOf.get(h.toAct ?? -1)}'s turn, not ${label}'s`);
      const kind: ActionKind = a[0] === 'f' ? 'fold' : a[0] === 'x' ? 'check' : a[0] === 'c' ? 'call' : a[0] === 'b' ? 'bet' : 'raise';
      applyAction(h, { seat, kind, to: kind === 'bet' || kind === 'raise' ? Math.round(Number(a.slice(1)) * BB) : undefined });
    }
  }
  const heroSeat = seatBy(def.hero);
  if (h.toAct !== heroSeat) throw new Error(`scenario ends with ${labelOf.get(h.toAct ?? -1)} to act, not Hero (${def.hero})`);
  const profiles = new Map<string, PlayerProfile>();
  for (const [label, fill] of Object.entries(def.profiles ?? {})) {
    const s = seatOf(h, seatBy(label));
    const p = emptyProfile(s.playerId, s.name);
    fill(p);
    profiles.set(s.playerId, p);
  }
  const c = parseCards(def.cards);
  return { h, heroSeat, heroCards: [c[0], c[1]], profiles };
}

export function decide(b: Built, engine: 'v1' | 'v2' = 'v2', samples = 3000, seed = 11): Decision {
  const agent = new BotAgent({ engine, seed });
  for (const [id, p] of b.profiles) agent.profiles.set(id, p);
  return agent.decideSync(b.h, b.heroSeat, b.heroCards, samples);
}

// ---- helpers for checks ---------------------------------------------------------

export const evOf = (d: Decision, action: string): number | null => {
  const cs = d.candidates.filter((c) => c.action === action && c.ev !== null);
  return cs.length ? Math.max(...cs.map((c) => c.ev!)) : null;
};
/** Best aggressive EV minus the passive EV (check, or the better of call and fold). */
export const aggressionEdge = (d: Decision): number => {
  const agg = Math.max(evOf(d, 'bet') ?? -Infinity, evOf(d, 'raise') ?? -Infinity);
  const pas = Math.max(evOf(d, 'check') ?? -Infinity, evOf(d, 'call') ?? -Infinity, evOf(d, 'fold') ?? -Infinity);
  return agg - pas;
};
export const betFrequency = (d: Decision): number => d.candidates.filter((c) => c.action === 'bet' || c.action === 'raise').reduce((a, c) => a + c.freq, 0);

/** A stats filler: a player seen `n` times who did the thing `rate` of the time. */
export const seen = (stats: Partial<Record<string, [number, number]>>, hands = 200) => (p: PlayerProfile) => {
  p.hands = hands;
  for (const [k, v] of Object.entries(stats)) (p.stats as Record<string, { n: number; d: number }>)[k] = { n: v![0], d: v![1] };
};
const STATION = seen({ foldVsBetFlop: [10, 200], foldVsBetTurn: [10, 200], foldVsBetRiver: [10, 200], aggFreq: [20, 200] });
const NIT = seen({ foldVsBetFlop: [170, 200], foldVsBetTurn: [170, 200], foldVsBetRiver: [170, 200], aggFreq: [40, 200] });
const PASSIVE_RAISER = seen({ aggFreq: [4, 200], cbetFlop: [10, 200], foldVsBetFlop: [20, 200], foldVsBetTurn: [20, 200], foldVsBetRiver: [20, 200] });

export interface Check { kind: 'property' | 'observation'; text: string; pass: (d: Decision, all: Map<string, Decision>, b: Built) => boolean }

export interface Scenario {
  id: string;
  category: string;
  title: string;
  set: 'design' | 'held-out';
  spot: SpotDef;
  checks: Check[];
}

// ---- reusable properties -------------------------------------------------------------

const legal: Check = { kind: 'property', text: 'returns a legal action with frequencies summing to 1', pass: (d) => Math.abs(d.candidates.reduce((a, c) => a + c.freq, 0) - 1) < 1e-6 && d.candidates.some((c) => c.action === d.action) };
const checkNotBelowFold: Check = { kind: 'property', text: 'EV(check) >= 0: checking cannot be worth less than folding', pass: (d) => (evOf(d, 'check') ?? 0) >= -1e-9 };
const neverFoldsFree: Check = { kind: 'property', text: 'does not fold when checking is free', pass: (d) => d.action !== 'fold' };
/** When calling closes the action on the river (or is all-in with nobody behind), EV(call) = equity x final pot - price exactly. */
const callIsPotOdds: Check = {
  kind: 'property', text: 'closing call: EV(call) equals equity x (pot + call) - call within sampling error',
  pass: (d, _all, b) => {
    const c = d.candidates.find((x) => x.action === 'call');
    if (!c || c.ev === null || !d.equity) return false;
    const hero = seatOf(b.h, b.heroSeat);
    const price = Math.min(b.h.currentBet - hero.streetCommit, hero.stack);
    const exact = d.equity.equity * (potTotal(b.h) + price) - price;
    return Math.abs(c.ev - exact) <= 3 * d.equity.stdErr * (potTotal(b.h) + price) + 1e-6;
  },
};
const followsPotOdds: Check = {
  kind: 'property', text: 'closing call: calls when equity beats the price, folds when it does not (raising aside)',
  pass: (d, _all, b) => {
    const hero = seatOf(b.h, b.heroSeat);
    const price = Math.min(b.h.currentBet - hero.streetCommit, hero.stack);
    const need = price / (potTotal(b.h) + price), eq = d.equity!.equity, se = d.equity!.stdErr;
    if (Math.abs(eq - need) < 3 * se + 0.01) return true;                 // too close to call either way
    return eq > need ? d.action !== 'fold' : d.action !== 'call';
  },
};
const flagged = (re: RegExp, text: string): Check => ({ kind: 'property', text, pass: (d) => re.test(d.basis.join(' | ')) });
const moreAggressiveThan = (other: string, text: string, margin = 0, kind: Check['kind'] = 'property'): Check => ({
  kind, text, pass: (d, all) => aggressionEdge(d) >= aggressionEdge(all.get(other)!) - margin,
});
const bestEvAtLeast = (other: string, text: string): Check => ({
  kind: 'property', text, pass: (d, all) => Math.max(...d.candidates.map((c) => c.ev ?? -Infinity)) >= Math.max(...all.get(other)!.candidates.map((c) => c.ev ?? -Infinity)) - 1e-9,
});

// Common action strings (six-handed, 100bb).
const BTN_OPEN_BB_CALL = 'UTG f, HJ f, CO f, BTN r2.5, SB f, BB c';
const CO_OPEN_BTN_CALL = 'UTG f, HJ f, CO r2.5, BTN c, SB f, BB f';
const LIMPED_3WAY = 'UTG f, HJ f, CO c, BTN c, SB f, BB x';

export const SCENARIOS: Scenario[] = [
  // ---- 1. out of position caller against a late-position raiser ----
  {
    id: 'oop-caller-bottom-pair-dry', category: 'OOP caller vs late raiser', set: 'design',
    title: 'BB called a BTN open, flop K95 rainbow, bottom pair, first to act',
    spot: { players: 6, hero: 'BB', cards: '5c 4c', lines: [BTN_OPEN_BB_CALL, 'Kh 9d 5s:'] },
    checks: [legal, checkNotBelowFold, neverFoldsFree, flagged(/last preflop raiser P0.*P0 holds the betting lead.*out of position/, 'explanation names the raiser, the betting lead and Hero being out of position')],
  },
  {
    id: 'ip-raiser-bottom-pair-dry', category: 'OOP caller vs late raiser', set: 'design',
    title: 'Mirror: Hero is the BTN raiser with the same bottom pair, checked to',
    spot: { players: 6, hero: 'BTN', cards: '5c 4c', lines: [BTN_OPEN_BB_CALL, 'Kh 9d 5s: BB x'] },
    checks: [legal, checkNotBelowFold, moreAggressiveThan('oop-caller-bottom-pair-dry', 'betting is at least as attractive with the lead and position as leading into the raiser out of position', 0, 'observation')],
  },
  // ---- 2. bottom pair on different textures ----
  {
    id: 'bottom-pair-wet-multiway', category: 'Bottom pair by texture', set: 'design',
    title: 'Three-way single-raised pot, flop Kh 9h 5d, bottom pair in the big blind',
    spot: { players: 6, hero: 'BB', cards: '5c 4c', lines: ['UTG f, HJ f, CO r2.5, BTN c, SB f, BB c', 'Kh 9h 5d:'] },
    checks: [legal, checkNotBelowFold, neverFoldsFree],
  },
  {
    id: 'bottom-pair-limped-ip', category: 'Bottom pair by texture', set: 'design',
    title: 'Limped pot, checked to Hero on the button with bottom pair, flop K95 rainbow',
    spot: { players: 6, hero: 'BTN', cards: '5c 4c', lines: [LIMPED_3WAY, 'Kh 9d 5s: BB x, CO x'] },
    checks: [legal, checkNotBelowFold, moreAggressiveThan('oop-caller-bottom-pair-dry', 'bottom pair is at least as keen to bet in position in a limped pot (nobody has the lead) as into a raiser out of position', 0, 'observation')],
  },
  {
    id: 'recorded-bottom-pair-lead', category: 'Bottom pair by texture', set: 'design',
    title: 'The recorded hand rebuilt: UTG limp-called a MP raise with 5d 3h, BB also called; flop 5h 9d Kh; BB checks',
    spot: { players: 8, stacks: { UTG: 168, MP: 45, BB: 140 }, hero: 'UTG', cards: '3h 5d', lines: ['UTG c, UTG+1 f, MP r4.5, HJ f, CO f, BTN f, SB f, BB c, UTG c', '5h 9d Kh: BB x'] },
    checks: [legal, checkNotBelowFold, neverFoldsFree, flagged(/out-of-distribution/, 'flags that Hero\'s hand is outside the range of the line taken'),
      flagged(/MP|P\d+ holds the betting lead/, 'identifies the preflop raiser as holding the lead')],
  },
  // ---- 3. top pair, wet versus dry ----
  {
    id: 'top-pair-dry-ip', category: 'Top pair wet vs dry', set: 'design',
    title: 'BTN raiser, AQ on Q72 rainbow, checked to',
    spot: { players: 6, hero: 'BTN', cards: 'Ah Qd', lines: [BTN_OPEN_BB_CALL, 'Qs 7d 2c: BB x'] },
    checks: [legal, checkNotBelowFold, { kind: 'observation', text: 'betting top pair top kicker for value is worth more than checking it', pass: (d) => aggressionEdge(d) > 0 }],
  },
  {
    id: 'top-pair-wet-ip', category: 'Top pair wet vs dry', set: 'design',
    title: 'BTN raiser, AQ on Qh Jh 9c, checked to',
    spot: { players: 6, hero: 'BTN', cards: 'As Qd', lines: [BTN_OPEN_BB_CALL, 'Qh Jh 9c: BB x'] },
    checks: [legal, checkNotBelowFold],
  },
  // ---- 4. weak draw, bad price ----
  {
    id: 'gutshot-allin-bad-price', category: 'Weak draws, unfavourable odds', set: 'design',
    title: 'Turn, gutshot only, opponent moves all-in for more than half the pot (no implied odds exist)',
    spot: { players: 6, stacks: { BTN: 12, BB: 100 }, hero: 'BB', cards: '8c 7c', lines: [BTN_OPEN_BB_CALL, 'Ah Td 6s: BB x, BTN b3, BB c', 'Kd: BB x, BTN b6.5'] },
    checks: [legal, callIsPotOdds, followsPotOdds],
  },
  // ---- 5. strong draw with fold equity ----
  {
    id: 'combo-draw-facing-cbet', category: 'Strong draws with fold equity', set: 'design',
    title: 'BB with an open-ended straight flush draw facing a continuation bet',
    spot: { players: 6, hero: 'BB', cards: '8h 7h', lines: [BTN_OPEN_BB_CALL, '9h 6h 2c: BB x, BTN b3.5'] },
    checks: [legal, { kind: 'property', text: 'does not fold a 15-out draw getting better than 2 to 1', pass: (d) => d.action !== 'fold' }],
  },
  // ---- 6. multiway bottom and middle pairs ----
  {
    id: 'middle-pair-5way-limped', category: 'Multiway weak pairs', set: 'design',
    title: 'Five-way limped pot, BB with middle pair on T98 (the recorded 8d 3s hand, simplified)',
    spot: { players: 9, hero: 'BB', cards: '8d 3s', lines: ['UTG f, UTG+1 c, MP c, LJ f, HJ f, CO c, BTN f, SB c, BB x', '9d 8c Th: SB x'] },
    checks: [legal, checkNotBelowFold, neverFoldsFree],
  },
  // ---- 7 / 8. missed flop with and without the initiative ----
  {
    id: 'air-with-initiative', category: 'Missed flop', set: 'design',
    title: 'BTN raiser with J9 high on A72 rainbow, checked to (continuation bet spot)',
    spot: { players: 6, hero: 'BTN', cards: 'Jc 9c', lines: [BTN_OPEN_BB_CALL, 'Ah 7d 2s: BB x'] },
    checks: [legal, checkNotBelowFold, flagged(/Hero holds the betting lead/, 'explanation says Hero holds the lead')],
  },
  {
    id: 'air-without-initiative', category: 'Missed flop', set: 'design',
    title: 'BB caller with the same J9 high on A72 rainbow, first to act into the raiser',
    spot: { players: 6, hero: 'BB', cards: 'Jc 9c', lines: [BTN_OPEN_BB_CALL, 'Ah 7d 2s:'] },
    checks: [legal, checkNotBelowFold, { kind: 'observation', text: 'a pure bluff is no more attractive when leading into the raiser than as a continuation bet in position', pass: (d, all) => aggressionEdge(d) <= aggressionEdge(all.get('air-with-initiative')!) + 1e-9 }],
  },
  // ---- 9. turn barrels ----
  {
    id: 'turn-barrel-value', category: 'Turn barrels', set: 'design',
    title: 'CO raiser bet the flop with top pair and was called; blank turn; out of position against the button',
    spot: { players: 6, hero: 'CO', cards: 'Ac Kd', lines: [CO_OPEN_BTN_CALL, 'Kh 8d 3s: CO b3, BTN c', '2c:'] },
    checks: [legal, checkNotBelowFold, bestEvAtLeast('turn-barrel-air', 'top pair top kicker is worth at least as much as ace high in the same spot')],
  },
  {
    id: 'turn-barrel-air', category: 'Turn barrels', set: 'design',
    title: 'Same line with ace-queen high (missed)',
    spot: { players: 6, hero: 'CO', cards: 'Ac Qd', lines: [CO_OPEN_BTN_CALL, 'Kh 8d 3s: CO b3, BTN c', '2c:'] },
    checks: [legal, checkNotBelowFold],
  },
  // ---- 10. river bluff-catching ----
  {
    id: 'river-bluffcatch-halfpot', category: 'River bluff-catching', set: 'design',
    title: 'BB with second pair facing a half-pot river bet after two checked streets',
    spot: { players: 6, hero: 'BB', cards: 'Jd Th', lines: [BTN_OPEN_BB_CALL, 'Ks Jc 4d: BB x, BTN x', '7h: BB x, BTN x', '2s: BB x, BTN b3'] },
    checks: [legal, callIsPotOdds, followsPotOdds],
  },
  {
    id: 'river-nothing-overbet', category: 'River bluff-catching', set: 'design',
    title: 'Seven high facing a three-times-pot river bet after two checked streets',
    spot: { players: 3, hero: 'BB', cards: '7s 2d', lines: ['BTN r3, SB f, BB c', 'Ah Kd Qc: BB x, BTN x', 'Js: BB x, BTN x', '4h: BB x, BTN b20'] },
    checks: [legal, callIsPotOdds, followsPotOdds, { kind: 'property', text: 'does not bluff-raise on the strength of a range that the narrowing has collapsed', pass: (d) => d.action === 'fold' }],
  },
  // ---- 11. off-strategy preflop calls ----
  {
    id: 'off-range-call-hits-two-pair', category: 'Off-strategy preflop call', set: 'design',
    title: 'Hero cold-called a raise with 9s 2s (advice was fold) and flops two pair; facing a bet',
    spot: { players: 6, hero: 'BTN', cards: '9s 2s', lines: ['UTG f, HJ r2.5, CO f, BTN c, SB f, BB f', '9h Kh 2c: HJ b3'] },
    checks: [legal, flagged(/out-of-distribution/, 'flags the hand as outside the range of the line'), { kind: 'property', text: 'still plays the actual hand: does not fold two pair to a half-pot bet', pass: (d) => d.action !== 'fold' }],
  },
  {
    id: 'off-range-call-misses', category: 'Off-strategy preflop call', set: 'design',
    title: 'Same call with 9s 2s, flop A K 7 without a spade; facing a bet',
    spot: { players: 6, hero: 'BTN', cards: '9s 2s', lines: ['UTG f, HJ r2.5, CO f, BTN c, SB f, BB f', 'Ah Kd 7c: HJ b3'] },
    checks: [legal, flagged(/out-of-distribution/, 'flags the hand as outside the range of the line'), bestEvAtLeast('off-range-call-misses', 'self-consistent')],
  },
  // ---- 12. different modelled opponents ----
  {
    id: 'bluff-vs-station', category: 'Opponent models', set: 'design',
    title: 'Missed continuation-bet spot against a player who folds 5% of the time',
    spot: { players: 6, hero: 'BTN', cards: 'Jc 9c', lines: [BTN_OPEN_BB_CALL, 'Ah 7d 2s: BB x'], profiles: { BB: STATION } },
    checks: [legal, checkNotBelowFold],
  },
  {
    id: 'bluff-vs-nit', category: 'Opponent models', set: 'design',
    title: 'Same spot against a player who folds 85% of the time',
    spot: { players: 6, hero: 'BTN', cards: 'Jc 9c', lines: [BTN_OPEN_BB_CALL, 'Ah 7d 2s: BB x'], profiles: { BB: NIT } },
    checks: [legal, checkNotBelowFold, moreAggressiveThan('bluff-vs-station', 'a bluff is at least as attractive against the frequent folder as against the calling station', 1)],
  },
  {
    id: 'value-vs-station', category: 'Opponent models', set: 'design',
    title: 'Top pair top kicker on the river against the calling station',
    spot: { players: 6, hero: 'BTN', cards: 'Ah Qd', lines: [BTN_OPEN_BB_CALL, 'Qs 7d 2c: BB x, BTN b3, BB c', '4h: BB x, BTN b6, BB c', '9c: BB x'], profiles: { BB: STATION } },
    checks: [legal, checkNotBelowFold],
  },
  {
    id: 'value-vs-nit', category: 'Opponent models', set: 'design',
    title: 'Same river against the frequent folder',
    spot: { players: 6, hero: 'BTN', cards: 'Ah Qd', lines: [BTN_OPEN_BB_CALL, 'Qs 7d 2c: BB x, BTN b3, BB c', '4h: BB x, BTN b6, BB c', '9c: BB x'], profiles: { BB: NIT } },
    checks: [legal, checkNotBelowFold, { kind: 'property', text: 'the value bet earns no more against the folder than against the station', pass: (d, all) => (evOf(d, 'bet') ?? 0) <= (evOf(all.get('value-vs-station')!, 'bet') ?? 0) + 1e-9 }],
  },
  {
    id: 'lead-vs-passive-raiser', category: 'Opponent models', set: 'design',
    title: 'BB with top pair on a dry board against a raiser who has bet 5% of flops in 200 hands',
    spot: { players: 6, hero: 'BB', cards: 'Kc Jd', lines: [BTN_OPEN_BB_CALL, 'Kh 8d 3s:'], profiles: { BTN: PASSIVE_RAISER } },
    checks: [legal, checkNotBelowFold, moreAggressiveThan('lead-vs-default-raiser', 'leading is at least as attractive against a raiser who rarely bets as against the default raiser', 1)],
  },
  {
    id: 'lead-vs-default-raiser', category: 'Opponent models', set: 'design',
    title: 'Same spot against an unknown raiser',
    spot: { players: 6, hero: 'BB', cards: 'Kc Jd', lines: [BTN_OPEN_BB_CALL, 'Kh 8d 3s:'] },
    checks: [legal, checkNotBelowFold],
  },
  // ---- 13. heads-up versus multiway ----
  {
    id: 'cbet-air-heads-up', category: 'Heads-up vs multiway', set: 'design',
    title: 'CO raiser with ace-queen high on J72, one caller, out of position',
    spot: { players: 6, hero: 'CO', cards: 'Ac Qd', lines: [CO_OPEN_BTN_CALL, 'Jh 7d 2s:'] },
    checks: [legal, checkNotBelowFold],
  },
  {
    id: 'cbet-air-four-way', category: 'Heads-up vs multiway', set: 'design',
    title: 'Same hand and board with three callers',
    spot: { players: 6, hero: 'CO', cards: 'Ac Qd', lines: ['UTG f, HJ f, CO r2.5, BTN c, SB c, BB c', 'Jh 7d 2s: SB x, BB x'] },
    checks: [legal, checkNotBelowFold, { kind: 'observation', text: 'a continuation bet without a made hand is no more attractive against three opponents than against one (as a fraction of the pot)', pass: (d, all, b) => aggressionEdge(d) / potTotal(b.h) <= aggressionEdge(all.get('cbet-air-heads-up')!) / 110 + 0.02 }],
  },

  // ================= held-out: written after the engine changes, never used for tuning =================
  {
    id: 'ho-set-oop-vs-raiser', category: 'OOP caller vs late raiser', set: 'held-out',
    title: 'BB flops bottom set on K95 two-tone against a BTN raiser',
    spot: { players: 6, hero: 'BB', cards: '5c 5d', lines: [BTN_OPEN_BB_CALL, 'Kh 9h 5s:'] },
    checks: [legal, checkNotBelowFold, neverFoldsFree, bestEvAtLeast('ho-bottom-pair-same-board', 'a set is worth at least as much as bottom pair on the same board')],
  },
  {
    id: 'ho-bottom-pair-same-board', category: 'OOP caller vs late raiser', set: 'held-out',
    title: 'Same spot with bottom pair',
    spot: { players: 6, hero: 'BB', cards: '5c 4c', lines: [BTN_OPEN_BB_CALL, 'Kh 9h 5s:'] },
    checks: [legal, checkNotBelowFold, neverFoldsFree],
  },
  {
    id: 'ho-river-closing-call-nuts', category: 'River bluff-catching', set: 'held-out',
    title: 'Nut flush on the river facing a pot-sized bet',
    spot: { players: 6, hero: 'BB', cards: 'Ah 5h', lines: [BTN_OPEN_BB_CALL, 'Kh 9h 4s: BB x, BTN b3, BB c', '2c: BB x, BTN x', '7h: BB x, BTN b12'] },
    checks: [legal, callIsPotOdds, { kind: 'property', text: 'never folds the nuts', pass: (d) => d.action !== 'fold' }],
  },
  {
    id: 'ho-allin-flop-draw', category: 'Strong draws with fold equity', set: 'held-out',
    title: 'Nut flush draw facing an all-in on the flop from a short stack: a pure pot-odds decision',
    spot: { players: 6, stacks: { CO: 14 }, hero: 'BB', cards: 'As 4s', lines: ['UTG f, HJ f, CO r2.5, BTN f, SB f, BB c', 'Ks 9s 2d: BB x, CO b11.5'] },
    checks: [legal, callIsPotOdds, followsPotOdds],
  },
  {
    id: 'ho-probe-after-check-back', category: 'Missed flop', set: 'held-out',
    title: 'The raiser checked the flop back; BB on the turn with middle pair (probe spot)',
    spot: { players: 6, hero: 'BB', cards: 'Td 9d', lines: [BTN_OPEN_BB_CALL, 'Qs Th 4c: BB x, BTN x', '3d:'] },
    checks: [legal, checkNotBelowFold, flagged(/nobody holds the betting lead/, 'explanation says nobody holds the lead after the flop was checked through')],
  },
  {
    id: 'ho-delayed-cbet', category: 'Missed flop', set: 'held-out',
    title: 'Hero raised, checked the flop back, and is checked to again on the turn',
    spot: { players: 6, hero: 'BTN', cards: 'Ad Jd', lines: [BTN_OPEN_BB_CALL, 'Ks 8h 4c: BB x, BTN x', '3d: BB x'] },
    checks: [legal, checkNotBelowFold],
  },
  {
    id: 'ho-3bet-pot-overpair', category: 'Top pair wet vs dry', set: 'held-out',
    title: 'Three-bet pot, Hero (BB, the 3-bettor) with queens on J-high dry board',
    spot: { players: 6, hero: 'BB', cards: 'Qc Qd', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB r11, BTN c', 'Jh 6d 2s:'] },
    checks: [legal, checkNotBelowFold, flagged(/3-bet pot, Hero was the last preflop raiser/, 'recognises the three-bet pot and Hero as aggressor'), bestEvAtLeast('ho-3bet-pot-air', 'an overpair is worth at least as much as ace-king high in the same spot')],
  },
  {
    id: 'ho-3bet-pot-air', category: 'Missed flop', set: 'held-out',
    title: 'Same three-bet pot with ace-king high',
    spot: { players: 6, hero: 'BB', cards: 'Ac Kd', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB r11, BTN c', 'Jh 6d 2s:'] },
    checks: [legal, checkNotBelowFold],
  },
  {
    id: 'ho-multiway-middle-pair-facing-bet', category: 'Multiway weak pairs', set: 'held-out',
    title: 'Four-way pot, middle pair facing a bet and a call with one player behind',
    spot: { players: 6, hero: 'BTN', cards: '9c 8c', lines: ['UTG f, HJ r2.5, CO c, BTN c, SB f, BB c', 'Kd 9h 4s: BB x, HJ b6, CO c'] },
    checks: [legal],
  },
  {
    id: 'ho-heads-up-table-flop', category: 'Heads-up vs multiway', set: 'held-out',
    title: 'Two-player table: BB with top pair facing a continuation bet',
    spot: { players: 2, hero: 'BB', cards: 'Kc 7d', lines: ['BTN r2.5, BB c', 'Kh 8d 3s: BB x, BTN b3'] },
    checks: [legal, { kind: 'property', text: 'does not fold top pair to a half-pot bet heads-up', pass: (d) => d.action !== 'fold' }],
  },
];

export interface ScenarioResult { scenario: Scenario; decision: Decision; built: Built; checks: { kind: Check['kind']; text: string; pass: boolean }[] }

export function runScenarios(engine: 'v1' | 'v2', samples = 3000, seed = 11): ScenarioResult[] {
  const built = new Map(SCENARIOS.map((s) => [s.id, buildSpot(s.spot)]));
  const decisions = new Map(SCENARIOS.map((s) => [s.id, decide(built.get(s.id)!, engine, samples, seed)]));
  return SCENARIOS.map((s) => {
    const d = decisions.get(s.id)!, b = built.get(s.id)!;
    return { scenario: s, decision: d, built: b, checks: s.checks.map((c) => ({ kind: c.kind, text: c.text, pass: c.pass(d, decisions, b) })) };
  });
}
