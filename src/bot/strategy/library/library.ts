// ============================================================
// Strategy library: registration and lookup.
//
// A lookup describes the ACTUAL situation (players dealt in, effective stack,
// antes, Hero's and the villain's seats as "players left to act behind", the
// scenario, callers and limpers). The library returns the best matching spot
// and says exactly how well it matches:
//
//   exact          every stated assumption of the pack holds
//   approximation  the spot is used outside its assumptions; each departure
//                  is listed and shown in the decision explanation
//
// It never returns a spot for a different scenario, a different hero seat or a
// different villain seat (measured in players behind), and never interpolates
// frequencies between spots.
// ============================================================

import { CardId, cardStr, handClass } from '../../cards';
import { HandMix, PackIssue, PreflopScenario, PreflopSpot, StrategyPack } from './types';
import { normaliseClass, normaliseCombo, packErrors, validatePack } from './validate';

export interface SpotQuery {
  scenario: PreflopScenario;
  /** Players dealt into the hand. */
  players: number;
  /** Players still to act after Hero in an unopened pot (BB = 0, SB = 1, BTN = 2, ...). */
  heroBehind: number;
  /** Same measure for the opener / 3-bettor / 4-bettor. */
  villainBehind?: number;
  callers?: number;
  limpers?: number;
  effStackBB: number;
  anteBB?: number;
  format?: 'cash' | 'tournament';
  /** Size of the raise Hero faces, in big blinds (vs-open / vs-open-call): compared with the size the data assumes. */
  sizeFacedBB?: number;
}

/**
 * How equally good matches are ranked (Phase 3.1).
 *   'registration'  (default, the behaviour of 0.6.0-0.9.1): exact before approximate, fewer departures, solver data,
 *                   verified data, then the pack registered FIRST. With the two built-in 6-max packs (same kind, both
 *                   unverified) this means Greenline wins every spot both packs have.
 *   'documented'    as 'registration', but a spot its own source marks as opponent-conditional (PreflopSpot.conditional)
 *                   ranks below an unconditional spot of the same quality. Registration order is only the last tie-break.
 */
export type Precedence = 'registration' | 'documented';

export interface Mix { fold: number; call: number; raise: number; allin: number }

export interface SpotMatch {
  pack: StrategyPack;
  spot: PreflopSpot;
  quality: 'exact' | 'approximation';
  /** Why the match is only an approximation (empty when exact). */
  departures: string[];
  /** Tag for the decision explanation, e.g. "precomputed-chart" or "solver". */
  basisTag: string;
}

interface Indexed { pack: StrategyPack; spot: PreflopSpot; heroBehind: number; villainBehind: number | null; classes: Map<string, HandMix>; combos: Map<string, HandMix>; order: number }

/** Players left to act behind a pack position: positions are listed first to act first, so the last one is the big blind. */
const behindOf = (pack: StrategyPack, pos: string): number => pack.positions.length - 1 - pack.positions.indexOf(pos);

const BASIS_TAG: Record<string, string> = { solver: 'solver', chart: 'precomputed-chart', calculated: 'computed', heuristic: 'heuristic' };

export function comboKey(a: CardId, b: CardId): string {
  const n = normaliseCombo(cardStr(a) + cardStr(b));
  return n ? n.combo : '';
}

export class StrategyLibrary {
  private readonly items: Indexed[] = [];
  readonly packs: StrategyPack[] = [];

  constructor(readonly precedence: Precedence = 'registration') {}

  /** Register a pack. Returns the validation issues; a pack with errors is NOT registered. */
  register(pack: StrategyPack): PackIssue[] {
    const issues = validatePack(pack);
    if (packErrors(issues).length) return issues;
    if (this.packs.some((p) => p.id === pack.id)) return [{ level: 'error', where: 'pack', message: `a pack with id "${pack.id}" is already registered` }];
    const order = this.packs.length;
    this.packs.push(pack);
    for (const spot of pack.spots) {
      const classes = new Map<string, HandMix>(), combos = new Map<string, HandMix>();
      for (const [k, mix] of Object.entries(spot.hands)) {
        const c = normaliseClass(k);
        if (c) classes.set(c, mix); else combos.set(normaliseCombo(k)!.combo, mix);
      }
      this.items.push({ pack, spot, heroBehind: behindOf(pack, spot.hero), villainBehind: spot.villain === undefined ? null : behindOf(pack, spot.villain), classes, combos, order });
    }
    return issues;
  }

  /** Best matching spot or null. Exact matches win; among equals, verified solver data, then the pack registered first. */
  find(q: SpotQuery): SpotMatch | null {
    let best: { m: SpotMatch; score: number } | null = null;
    for (const it of this.items) {
      const { pack, spot } = it;
      if (spot.scenario !== q.scenario || it.heroBehind !== q.heroBehind) continue;
      if (it.villainBehind !== null && it.villainBehind !== (q.villainBehind ?? -1)) continue;
      if (spot.callers !== undefined && spot.callers !== (q.callers ?? 0)) continue;
      if (spot.limpers !== undefined && spot.limpers !== (q.limpers ?? 0)) continue;
      const a = pack.assumptions;
      const departures: string[] = [];
      if (a.players !== q.players) {
        // Heads-up tables have their own blind structure: never borrow a ring chart, or lend a heads-up one.
        if (a.players === 2 || q.players === 2) continue;
        departures.push(`${a.players}-handed data used at a ${q.players}-handed table (same number of players left to act)`);
      }
      const [lo, hi] = spot.stackBB ?? a.stackBB;
      if (q.effStackBB < lo - 1e-9 || q.effStackBB > hi + 1e-9) departures.push(`made for ${lo}-${hi}bb, effective stack is ${q.effStackBB.toFixed(0)}bb`);
      if ((a.anteBB ?? 0) > 0 !== (q.anteBB ?? 0) > 0) departures.push((q.anteBB ?? 0) > 0 ? 'made without antes, this game has antes' : 'made with antes, this game has none');
      if (q.format && q.format !== a.format) departures.push(`made for ${a.format} play`);
      // The size faced against the size the data assumes (more than 25% apart). Same text for every pack that states
      // the same open size, so it never changes which spot is chosen; it makes the approximation visible.
      const assumedOpen = spot.sizing?.raiseToBB ?? (spot.scenario === 'vs-open' || spot.scenario === 'vs-open-call' ? a.openSizeBB : undefined);
      if (q.sizeFacedBB !== undefined && assumedOpen !== undefined && Math.abs(q.sizeFacedBB / assumedOpen - 1) > 0.25) departures.push(`made for a ${assumedOpen}bb open, the raise faced is to ${q.sizeFacedBB.toFixed(1)}bb`);
      const quality = departures.length ? 'approximation' as const : 'exact' as const;
      const conditionalPenalty = this.precedence === 'documented' && spot.conditional ? 50 : 0;
      const score = (quality === 'exact' ? 1000 : 0) - 10 * departures.length - conditionalPenalty + (pack.source.kind === 'solver' ? 5 : 0) + (pack.source.verified ? 3 : 0) - 0.001 * it.order;
      if (!best || score > best.score) best = { m: { pack, spot, quality, departures, basisTag: BASIS_TAG[pack.source.kind] }, score };
    }
    return best ? best.m : null;
  }

  /** Action frequencies for a holding in a matched spot. A combo entry overrides its class; an absent hand folds. */
  mixFor(m: SpotMatch, cards: [CardId, CardId]): Mix {
    const it = this.items.find((x) => x.spot === m.spot && x.pack === m.pack)!;
    const raw = it.combos.get(comboKey(cards[0], cards[1])) ?? it.classes.get(handClass(cards[0], cards[1])) ?? {};
    return toMix(raw);
  }

  /** Per-class weight of one action (or several) over the whole spot, for building an opponent's range. */
  classWeights(m: SpotMatch, actions: readonly (keyof Mix)[]): Map<string, number> {
    const it = this.items.find((x) => x.spot === m.spot && x.pack === m.pack)!;
    const out = new Map<string, number>();
    for (const [cls, raw] of it.classes) {
      const mix = toMix(raw);
      const w = actions.reduce((s, a) => s + mix[a], 0);
      if (w > 0) out.set(cls, Math.min(1, w));
    }
    return out;
  }

  /** Short citation for the decision explanation. */
  cite(m: SpotMatch): string {
    const s = m.pack.source;
    const src = `${m.pack.name}, ${m.spot.id}${s.verified ? '' : ' (source not verified)'}${m.spot.conditional ? `; OPPONENT-CONDITIONAL in its source: ${m.spot.conditional}` : ''}`;
    return m.quality === 'exact' ? src : `${src}; APPROXIMATION: ${m.departures.join('; ')}`;
  }
}

export function toMix(raw: HandMix): Mix {
  const call = raw.call ?? 0, raise = raw.raise ?? 0, allin = raw.allin ?? 0;
  return { fold: Math.max(0, 1 - call - raise - allin), call, raise, allin };
}
