// ============================================================
// Version 3 postflop engine (EXPERIMENTAL): bounded search over betting SEQUENCES, heads-up.
//
// Version 2 valued a first action with fixed follow-ups ("check, then fold or call a bet", "bet, then fold
// or call a raise") and a one-bet rollout of the next street. It could not value a check-raise, a re-raise,
// calling now to raise on the next street, or a bet sized to be raised. Version 3 builds the betting tree and
// lets Hero choose at every node it reaches.
//
// 1. PUBLIC TREE. The current street and (by default) the next street are expanded with the rules engine
//    itself (table/engine.ts): every node is a real HandState, so minimum raises, the re-open rule, all-ins
//    and uncalled bets are exactly the rules of the game. Sizes are a small discrete set per node (below),
//    and the number of bets and raises per street is capped. Nothing is expanded past the next street.
//
// 2. DEALS. Opponent holdings are sampled from its range (version 2's range estimate, unchanged) together
//    with the rest of the board. For each deal the opponent's strength on this street and on the next board
//    is computed once, and the showdown result is known.
//
// 3. OPPONENT NODES. The opponent acts by the history-conditional model of ./model.ts, using the strength of
//    the holding it was dealt. Each deal carries the probability that the opponent took every action on the
//    path so far (its reach), so after "check, bet, raise, call" the deals are weighted by how likely that
//    holding was to play exactly that way: the opponent's range is updated after every action, by the model.
//
// 4. HERO NODES. Hero does not see the opponent's cards, so Hero's choice at a node may depend only on what
//    Hero knows there: the public betting line and, on the next street, Hero's own strength on the new board.
//    At each Hero node the action with the highest reach-weighted value over all deals that reach it (on the
//    next street: within Hero's strength bucket) is taken: Hero plays a best response to the opponent model
//    on this tree. A check is therefore valued together with its best continuation (fold, call, raise of
//    each size), and a bet together with Hero's best answer to being raised.
//
// 5. LEAVES. Fold: exact. Showdown on the river or all-in: exact, with side-pot accounting. End of the next
//    street with cards still to come (decisions on the flop): the showdown share times version 2's
//    realization factor, because the river betting is not searched.
//
// Approximations, stated plainly:
//   - the opponent model is heuristic (./model.ts); the search is exactly as good as it is;
//   - sizes are discrete: Hero's first action uses version 2's sizes; later Hero raises use one size and
//     all-in; the opponent bets a third or three quarters of the pot and raises about pot;
//   - choices at next-street Hero nodes are made on the same sampled deals they are evaluated on, which
//     slightly favours lines that reach the next street; strength buckets keep that small;
//   - the opponent's strength on the next board is measured inside its starting range, not the range the
//     line has left it; the reach weights carry that information instead;
//   - heads-up only: with two or more opponents the agent uses version 2.
// ============================================================

import { CardId, comboIndex, Rng } from '../../cards';
import { evaluateHand } from '../../../core/equity/hand-eval';
import { MultiwayDealSampler } from '../../../core/equity/multiway-equity';
import { EquityEstimate, showdownPayout } from '../../equity/equity';
import { BetRole, BoardFeatures, computeFeatures } from '../../ranges/postflop-model';
import { heroStrength, strengthTable } from '../../ranges/range-model';
import { Range, removeDead, toWeighted } from '../../ranges/range';
import {
  ActionInput, applyAction, awaitingBoard, bettingClosed, cloneHand, dealBoard, HandState, legalActions, potTotal, seatOf, Street,
} from '../../table/engine';
import type { LineStats, PostflopResult } from '../postflop';
import { realizationFactor, sizeLabel } from '../postflop';
import { betRole, leadSeatFor } from '../spot';
import type { Candidate } from '../types';
import type { VillainModel } from '../villains';
import { bet3, Ctx3, Knobs, MODEL3, opponentMixture, respond3 } from './model';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const EPS = 1e-9;

export interface SearchConfig {
  /** 1: the current street only (later streets by realization factor); 2: also the next street. */
  streets: 1 | 2;
  /** Most bets and raises per street in the tree. */
  maxAggCurrent: number;
  maxAggNext: number;
  /** Hero strength buckets on the next street. */
  heroBuckets: number;
  /** Safety cap on the number of tree nodes. */
  maxNodes: number;
  /** Model uncertainty before evidence (model.ts MODEL3.uncertainty); 0 = trust the model fully. */
  modelUncertainty: number;
  /**
   * Choose Hero's actions below the root on one half of the deals and value them on the other. Removes the upward
   * selection bias of the values but makes the choices noisier: in sim/bot/v3-bias.ts it picked the action that a
   * 12,000-deal run picks less often (91 of 96 trials against 95 of 96), so it is off by default.
   */
  crossFit: boolean;
}
export const DEFAULT_V3: SearchConfig = { streets: 2, maxAggCurrent: 4, maxAggNext: 3, heroBuckets: 4, maxNodes: 6000, modelUncertainty: MODEL3.uncertainty, crossFit: false };

/** HEURISTIC discrete sizes (fractions of the pot; raises: of the pot after calling). */
export const SIZES3 = {
  rootBet: [0.33, 0.66, 1.0, 1.5],
  rootRaise: [0.55, 1.0],
  heroRaise: [0.45, 0.9],
  heroNextRaise: [0.8],
  heroNextBet: [0.33, 0.75],
  oppBet: { small: 0.33, large: 0.75 },
  oppRaise: 0.9,
};

type Kind = 'fold' | 'check' | 'call' | 'bet' | 'raise';
/** What the opponent model's output maps onto. */
type MKey = 'fold' | 'call' | 'raise' | 'check' | 'small' | 'large' | null;
export interface TAct { kind: Kind; to: number; label: string; allIn: boolean; mkeys: MKey[] }

export interface TNode {
  id: number;
  type: 'hero' | 'opp' | 'end';
  depth: 0 | 1;
  street: Street;
  line: string;
  acts: TAct[];
  kids: TNode[];
  /** Opponent decision context. */
  ctx: Ctx3 | null;
  facing: boolean;
  lateStreet: boolean;
  /** Leaf. */
  end: null | { kind: 'hero-fold' | 'opp-fold' | 'showdown' | 'realize'; win: number; tie: number; lose: number; heroIn: number; pot: number };
  /** Hero nodes, filled by evaluation: chosen action index per bucket (depth 0: one entry). */
  choice: number[];
  /** Filled by evaluation: total reach of the node (sum over deals), and of each child for opponent nodes. */
  reach: number;
}

interface Spec { action: Kind; to: number; label: string; allIn: boolean }

const OUTCOME_SHARE = [0, 0.5, 1];

export class PostflopSearchV3 {
  readonly specs: Spec[];
  readonly root: TNode;
  readonly nodes: number;
  private readonly heroSeat: number;
  private readonly oppSeat: number;
  private readonly sampler: MultiwayDealSampler;
  private readonly rng: Rng;
  private readonly S0: Float32Array;
  private readonly heroCombo: number;
  private readonly R: number;
  private readonly nextFeat = new Map<number, { hero: number; table: Float32Array }>();
  private readonly villainRange: Range;
  private readonly heroPerceived: Range;
  private readonly board: CardId[];
  private readonly hand: number[];
  private readonly vhand: number[];
  // per-deal data
  private n = 0;
  private cap = 0;
  private s0 = new Float32Array(0);
  private s1 = new Float32Array(0);
  private hb = new Uint8Array(0);
  private out = new Uint8Array(0);
  /** Which opponent (0 modelled, 1 stickier, 2 more aggressive) the deal is played against. Hero never sees it. */
  private typ = new Uint8Array(0);
  private readonly mix: { knobs: Knobs; weight: number; name: string }[];
  private approx = 0;
  private readonly bucketCuts: number[];
  /** Hero's made-hand percentile and draw outs on the current board (to say whether a raise is a semi-bluff). */
  private readonly heroHs: number;
  private readonly heroOuts: number;

  constructor(
    h: HandState,
    heroSeat: number,
    heroCards: [CardId, CardId],
    villain: VillainModel,
    private readonly knobs: Knobs,
    features: BoardFeatures,
    seed: number,
    heroPerceived: Range | undefined,
    readonly cfg: SearchConfig = DEFAULT_V3,
  ) {
    if (!legalActions(h, heroSeat)) throw new Error('PostflopSearchV3: Hero is not to act');
    if (h.board.length < 3) throw new Error('PostflopSearchV3: needs a flop');
    const live = h.seats.filter((s) => s.dealtIn && !s.folded);
    if (live.length !== 2 || !live.some((s) => s.seat === villain.seat)) throw new Error('PostflopSearchV3: heads-up pots only');
    this.heroSeat = heroSeat;
    this.oppSeat = villain.seat;
    this.rng = new Rng(seed ^ 0x51ed270b);
    this.board = h.board.slice();
    this.heroCombo = comboIndex(heroCards[0], heroCards[1]);
    this.villainRange = villain.range;
    this.heroPerceived = heroPerceived ?? removeDead(new Float64Array(1326).fill(1), h.board);
    this.S0 = strengthTable(villain.range, this.heroPerceived, features);
    const hero = seatOf(h, heroSeat), opp = seatOf(h, villain.seat);
    const heroHs = features.hs[this.heroCombo];
    this.heroHs = heroHs;
    this.heroOuts = features.outs[this.heroCombo];
    const inPosition = opp.pos!.postflopOrder < hero.pos!.postflopOrder;
    this.R = realizationFactor(h.street === 'flop' ? 'turn' : 'river', inPosition, 1, heroHs);
    this.sampler = new MultiwayDealSampler(heroCards, h.board.slice(), [toWeighted(villain.range, [...heroCards, ...h.board]).range], seed);
    this.hand = [heroCards[0], heroCards[1], ...h.board, 0, 0].slice(0, 7);
    this.vhand = [0, 0, ...h.board, 0, 0].slice(0, 7);
    this.mix = opponentMixture(knobs, cfg.modelUncertainty);
    this.bucketCuts = cfg.heroBuckets <= 1 ? [] : Array.from({ length: cfg.heroBuckets - 1 }, (_, i) => 0.35 + (0.45 * (i + 1)) / cfg.heroBuckets);

    // ---- tree ----
    let id = 0;
    const heroTotal0 = hero.totalCommit;
    const dummy = (() => { const used = new Set<number>([...heroCards, ...h.board]); for (let c = 0; c < 52; c++) if (!used.has(c)) return c; return 0; })();
    const deadSeats = h.seats.filter((s) => s.dealtIn && s.folded && s.totalCommit > 0).map((s) => s.seat);
    const leaf = (st: HandState, depth: 0 | 1, line: string, kind: 'hero-fold' | 'opp-fold' | 'showdown' | 'realize'): TNode => {
      const hs = seatOf(st, heroSeat), os = seatOf(st, villain.seat);
      const heroIn = hs.totalCommit - heroTotal0;
      const invest = [hs.totalCommit, os.totalCommit, ...deadSeats.map((s) => seatOf(st, s).totalCommit)];
      const pot = invest.reduce((a, b) => a + b, 0);
      const pay = (rh: number, ro: number) => showdownPayout(0, invest, [rh, ro, ...deadSeats.map(() => -1)]);
      return {
        id: id++, type: 'end', depth, street: st.street, line, acts: [], kids: [], ctx: null, facing: false, lateStreet: false, choice: [], reach: 0,
        end: { kind, win: pay(2, 1), tie: pay(1, 1), lose: pay(1, 2), heroIn, pot },
      };
    };
    const build = (st: HandState, depth: 0 | 1, line: string, first: boolean): TNode => {
      if (id > cfg.maxNodes) throw new Error('PostflopSearchV3: tree too large');
      const hs = seatOf(st, heroSeat), os = seatOf(st, villain.seat);
      if (hs.folded) return leaf(st, depth, line, 'hero-fold');
      if (os.folded) return leaf(st, depth, line, 'opp-fold');
      if (st.toAct === null) {
        if (st.phase === 'showdown' || bettingClosed(st)) return leaf(st, depth, line, 'showdown');
        if (awaitingBoard(st)) {
          if (depth === 0 && cfg.streets === 2) {
            const nx = cloneHand(st);
            dealBoard(nx, [dummy]);
            if (nx.toAct === null) return leaf(nx, 1, `${line} /`, 'showdown');
            return build(nx, 1, `${line} /`, false);
          }
          return leaf(st, depth, line, 'realize');
        }
        return leaf(st, depth, line, 'showdown');
      }
      const actor = st.toAct;
      const la = legalActions(st)!;
      const isHero = actor === heroSeat;
      const me = seatOf(st, actor), other = isHero ? os : hs;
      const pot = potTotal(st);
      const facing = la.callAmount > EPS;
      const maxAgg = depth === 0 ? cfg.maxAggCurrent : cfg.maxAggNext;
      const canRaise = la.canRaise && st.raisesThisStreet < maxAgg;
      const capTo = Math.min(la.maxRaiseTo, Math.max(other.streetCommit + other.stack, la.minRaiseTo));
      const unit = st.bigBlind >= 2 ? 1 : 0.01;
      const sizesTo = (fracs: number[], withAllIn: boolean): number[] => {
        if (!canRaise) return [];
        const base = facing ? pot + la.callAmount : pot;
        const from = facing ? st.currentBet : me.streetCommit;
        const out: number[] = [];
        for (const f of fracs) {
          // Whole chips at stakes of 2 or more per big blind, cents below (PokerNow tables at 0.25 / 0.50 use cents).
          let to = unit === 1 ? Math.round(from + f * base) : Math.round((from + f * base) * 100) / 100;
          to = clamp(to, la.minRaiseTo, capTo);
          if (to >= 0.75 * capTo) to = capTo;
          out.push(to);
        }
        if (withAllIn && capTo - from <= 2.5 * base) out.push(capTo);
        return [...new Set(out)].sort((a, b) => a - b);
      };
      const acts: TAct[] = [];
      const kind: Kind = la.raiseKind;
      const label = (to: number) => { const base = facing ? pot + la.callAmount : pot; const from = facing ? st.currentBet : me.streetCommit; return `${kind} ${sizeLabel((to - from) / Math.max(EPS, base), to >= la.maxRaiseTo - EPS)} (${to})`; };
      if (isHero) {
        if (facing) { acts.push({ kind: 'fold', to: 0, label: 'fold', allIn: false, mkeys: [] }); if (la.canCall) acts.push({ kind: 'call', to: 0, label: la.callAmount >= me.stack - EPS ? 'call all-in' : 'call', allIn: la.callAmount >= me.stack - EPS, mkeys: [] }); }
        else acts.push({ kind: 'check', to: 0, label: 'check', allIn: false, mkeys: [] });
        const tos = first ? sizesTo(facing ? SIZES3.rootRaise : SIZES3.rootBet, true)
          : depth === 0 ? sizesTo(facing ? SIZES3.heroRaise : SIZES3.rootBet.slice(1, 3), true)
            : sizesTo(facing ? SIZES3.heroNextRaise : SIZES3.heroNextBet, true);
        for (const to of tos) acts.push({ kind, to, label: label(to), allIn: to >= la.maxRaiseTo - EPS, mkeys: [] });
      } else if (facing) {
        acts.push({ kind: 'fold', to: 0, label: 'fold', allIn: false, mkeys: ['fold'] });
        acts.push({ kind: 'call', to: 0, label: 'call', allIn: la.callAmount >= me.stack - EPS, mkeys: ['call'] });
        const tos = sizesTo([st.raisesThisStreet >= 2 ? 99 : SIZES3.oppRaise], false);
        if (tos.length) acts.push({ kind, to: tos[0], label: label(tos[0]), allIn: tos[0] >= la.maxRaiseTo - EPS, mkeys: ['raise'] });
      } else {
        acts.push({ kind: 'check', to: 0, label: 'check', allIn: false, mkeys: ['check'] });
        const small = sizesTo([SIZES3.oppBet.small], false)[0], large = sizesTo([SIZES3.oppBet.large], false)[0];
        if (small !== undefined && large !== undefined && small === large) acts.push({ kind, to: small, label: label(small), allIn: small >= la.maxRaiseTo - EPS, mkeys: ['small', 'large'] });
        else {
          if (small !== undefined) acts.push({ kind, to: small, label: label(small), allIn: small >= la.maxRaiseTo - EPS, mkeys: ['small'] });
          if (large !== undefined) acts.push({ kind, to: large, label: label(large), allIn: large >= la.maxRaiseTo - EPS, mkeys: ['large'] });
        }
      }
      // Opponent context.
      const evs = st.events.filter((e) => e.street === st.street && !e.kind.startsWith('post'));
      const heroChecked = evs.some((e) => e.seat === heroSeat && e.kind === 'check');
      const lastAgg = st.aggressor[st.street];
      const lead = leadSeatFor(st, st.street);
      const acted = new Set(evs.map((e) => e.seat));
      const role: BetRole = isHero ? 'neutral' : betRole(st, actor, lead, acted);
      const ctx: Ctx3 = {
        street: st.street, betFrac: facing ? la.callAmount / Math.max(EPS, pot - la.callAmount) : 0, level: st.raisesThisStreet,
        checkRaised: facing && lastAgg === heroSeat && heroChecked, ownRaised: facing && evs.some((e) => e.seat === actor && (e.kind === 'bet' || e.kind === 'raise')),
        role, canRaise,
      };
      const node: TNode = { id: id++, type: isHero ? 'hero' : 'opp', depth, street: st.street, line, acts, kids: [], ctx, facing, lateStreet: depth > 0 || st.street !== 'flop', end: null, choice: [], reach: 0 };
      for (const a of acts) {
        const nx = cloneHand(st);
        const input: ActionInput = { seat: actor, kind: a.kind, to: a.kind === 'bet' || a.kind === 'raise' ? a.to : undefined };
        applyAction(nx, input);
        node.kids.push(build(nx, depth, `${line} ${isHero ? 'H' : 'V'}:${a.kind}${a.kind === 'bet' || a.kind === 'raise' ? a.to : ''}`, false));
      }
      return node;
    };
    this.root = build(cloneHand(h), 0, '', true);
    this.nodes = id;
    this.specs = this.root.acts.map((a) => ({ action: a.kind, to: a.to, label: a.label, allIn: a.allIn }));
  }

  private nextFeatures(card: number): { hero: number; table: Float32Array } {
    let f = this.nextFeat.get(card);
    if (!f) {
      const bf = computeFeatures([...this.board, card]);
      f = { hero: heroStrength(this.villainRange, bf, this.heroCombo), table: strengthTable(this.villainRange, this.heroPerceived, bf) };
      this.nextFeat.set(card, f);
    }
    return f;
  }

  private grow(need: number): void {
    if (need <= this.cap) return;
    const cap = Math.max(need, 2 * this.cap, 256);
    const g = <T extends Float32Array | Uint8Array>(a: T, mk: (n: number) => T): T => { const b = mk(cap); b.set(a); return b; };
    this.s0 = g(this.s0, (n) => new Float32Array(n)); this.s1 = g(this.s1, (n) => new Float32Array(n));
    this.hb = g(this.hb, (n) => new Uint8Array(n)); this.out = g(this.out, (n) => new Uint8Array(n)); this.typ = g(this.typ, (n) => new Uint8Array(n));
    this.cap = cap;
  }

  /** Add sampled deals. Safe to call repeatedly. */
  run(samples: number): void {
    this.grow(this.n + samples);
    const toCome = 5 - this.board.length;
    const bl = this.board.length;
    for (let s = 0; s < samples; s++) {
      if (this.sampler.next()) this.approx++;
      const a = this.sampler.villainCards[0], b = this.sampler.villainCards[1];
      for (let j = 0; j < toCome; j++) { this.hand[2 + bl + j] = this.sampler.runout[j]; this.vhand[2 + bl + j] = this.sampler.runout[j]; }
      this.vhand[0] = a; this.vhand[1] = b;
      const hr = evaluateHand(this.hand), vr = evaluateHand(this.vhand);
      const i = this.n++;
      this.out[i] = hr > vr ? 2 : hr === vr ? 1 : 0;
      const k = comboIndex(a, b);
      this.s0[i] = this.S0[k];
      if (toCome > 0) {
        const nf = this.nextFeatures(this.sampler.runout[0]);
        this.s1[i] = nf.table[k];
        let bucket = 0;
        while (bucket < this.bucketCuts.length && nf.hero >= this.bucketCuts[bucket]) bucket++;
        this.hb[i] = bucket;
      } else { this.s1[i] = this.s0[i]; this.hb[i] = 0; }
      const u = this.rng.next();
      this.typ[i] = u < this.mix[0].weight ? 0 : u < this.mix[0].weight + this.mix[1].weight ? 1 : 2;
    }
  }

  get samples(): number { return this.n; }

  // ---- evaluation ----------------------------------------------------------------------------

  /** Model probabilities of each act at an opponent node for one deal. */
  private oppProbs(node: TNode, d: number, force: Knobs | null, out: Float64Array): void {
    const k = force ?? this.mix[this.typ[d]].knobs;
    const s = node.depth === 0 ? this.s0[d] : this.s1[d];
    const c = node.ctx!;
    let r: Record<string, number>;
    if (node.facing) r = respond3(s, c, k) as unknown as Record<string, number>;
    else r = bet3(s, { street: c.street, role: c.role, lateStreet: node.lateStreet }, k) as unknown as Record<string, number>;
    let tot = 0;
    for (let a = 0; a < node.acts.length; a++) { let p = 0; for (const m of node.acts[a].mkeys) if (m) p += r[m] ?? 0; out[a] = p; tot += p; }
    // A size the tree does not offer (e.g. raising when raising is capped) is folded into the passive option.
    if (tot < 1 - 1e-9) out[node.facing ? 1 : 0] += 1 - tot;
  }

  private leafValue(e: NonNullable<TNode['end']>, d: number): number {
    switch (e.kind) {
      case 'hero-fold': return -e.heroIn;
      case 'opp-fold': return e.pot - e.heroIn;
      case 'showdown': { const o = this.out[d]; return (o === 2 ? e.win : o === 1 ? e.tie : e.lose) - e.heroIn; }
      case 'realize': { const o = this.out[d]; return this.R * (o === 2 ? e.win : o === 1 ? e.tie : e.lose) - e.heroIn; }
    }
  }

  /** Backward induction for the deals so far under knobs k. Returns the value vector of `node`. */
  private evalNode(node: TNode, reach: Float64Array, k: Knobs | null, record: boolean, isRoot = false): Float64Array {
    const N = this.n;
    const V = new Float64Array(N);
    if (record) { let r = 0; for (let d = 0; d < N; d++) r += reach[d]; node.reach = r; }
    if (node.end) { for (let d = 0; d < N; d++) V[d] = this.leafValue(node.end, d); return V; }
    const A = node.acts.length;
    if (node.type === 'opp') {
      const P = Array.from({ length: A }, () => new Float64Array(N));
      const tmp = new Float64Array(A);
      for (let d = 0; d < N; d++) { this.oppProbs(node, d, k, tmp); for (let a = 0; a < A; a++) P[a][d] = tmp[a]; }
      for (let a = 0; a < A; a++) {
        const cr = new Float64Array(N);
        let any = false;
        for (let d = 0; d < N; d++) { cr[d] = reach[d] * P[a][d]; if (cr[d] > 0) any = true; }
        if (!any && !record) continue;
        const Vc = this.evalNode(node.kids[a], cr, k, record);
        for (let d = 0; d < N; d++) V[d] += P[a][d] * Vc[d];
      }
      return V;
    }
    // Hero: best action per information set (depth 0: the node; depth 1: the node and Hero's strength bucket).
    const kids = node.kids.map((kid) => this.evalNode(kid, reach, k, record));
    const B = node.depth === 0 ? 1 : this.cfg.heroBuckets;
    // Scores per half of the deals (even / odd index) and per strength bucket.
    const score = Array.from({ length: 2 * B }, () => new Float64Array(A));
    const mass = new Float64Array(2 * B);
    for (let d = 0; d < N; d++) {
      const r = reach[d]; if (r === 0) continue;
      const slot = 2 * (node.depth === 0 ? 0 : this.hb[d]) + (d & 1);
      mass[slot] += r;
      for (let a = 0; a < A; a++) score[slot][a] += r * kids[a][d];
    }
    // Ties (e.g. a node no deal reaches) go to the first action that is not a fold.
    const start = Math.max(0, node.acts.findIndex((x) => x.kind !== 'fold'));
    const argmax = (sc: Float64Array) => { let best = start; for (let a = 0; a < A; a++) if (sc[a] > sc[best] + 1e-12) best = a; return best; };
    const both = Array.from({ length: B }, (_, b) => { const sc = new Float64Array(A); for (let a = 0; a < A; a++) sc[a] = score[2 * b][a] + score[2 * b + 1][a]; return argmax(sc); });
    if (record) node.choice = both;
    // CROSS-FITTING. A choice made and valued on the same deals is biased upward (the best of several noisy means).
    // Below the root, the action for each half of the deals is chosen on the OTHER half and valued on its own,
    // so the value of a line reflects a choice Hero could have made without seeing these deals. A half that
    // has no deals at the node uses the choice made on all deals.
    const cross = this.cfg.crossFit && !isRoot;
    for (let d = 0; d < N; d++) {
      const b = node.depth === 0 ? 0 : this.hb[d];
      const other = 2 * b + (1 - (d & 1));
      const a = cross && mass[other] > 0 ? argmax(score[other]) : both[b];
      V[d] = kids[a][d];
    }
    return V;
  }

  /** Root candidate value vectors (one per root action) under knobs k. */
  private rootValues(k: Knobs | null, record: boolean): Float64Array[] {
    const N = this.n, reach = new Float64Array(N).fill(1);
    return this.root.kids.map((kid) => this.evalNode(kid, reach, k, record));
  }

  /** Probability, averaged over deals, of each act at a root child's opponent node; and the equity of the deals that continue. */
  private childStats(kid: TNode): { probs: number[]; eqCalled: number | null; eqContinue: number | null; foldValue: number } {
    const N = this.n, A = kid.acts.length;
    const probs = new Array<number>(A).fill(0);
    const tmp = new Float64Array(A);
    let callW = 0, callEq = 0, contW = 0, contEq = 0;
    for (let d = 0; d < N; d++) {
      this.oppProbs(kid, d, null, tmp);
      for (let a = 0; a < A; a++) probs[a] += tmp[a];
      const sh = OUTCOME_SHARE[this.out[d]];
      if (kid.facing) { const pc = tmp[1]; callW += pc; callEq += pc * sh; const pk = 1 - tmp[0]; contW += pk; contEq += pk * sh; }
    }
    return { probs: probs.map((p) => p / Math.max(1, N)), eqCalled: callW > 0 ? callEq / callW : null, eqContinue: contW > 0 ? contEq / contW : null, foldValue: 0 };
  }

  /** The plan Hero follows after a root action, in words. */
  private planOf(kid: TNode): string[] {
    const out: string[] = [];
    const word = (c: string, raiseWord: string) => (c === 'fold' ? 'fold' : c.startsWith('call') ? 'call' : c.replace(/^raise/, raiseWord));
    if (kid.type === 'opp') {
      const where = kid.depth === 1 ? `on the ${kid.street}, ` : '';
      kid.acts.forEach((a, i) => {
        const nx = kid.kids[i];
        if (nx.type !== 'hero' || a.kind === 'fold' || a.kind === 'check' || a.kind === 'call' || !nx.choice.length) return;
        const what = this.choiceText(nx, (c) => word(c, kid.facing ? 're-raise' : 'raise'));
        out.push(kid.facing ? `${where}if raised (${a.label.replace(/^raise /, '')}): ${what}`
          : `${where}if the opponent bets ${a.label.replace(/^bet /, '')}: ${what}${kid.depth === 0 && /raise/.test(what) ? ' (check-raise)' : ''}`);
      });
    }
    return out;
  }

  /** Hero's choice at a node in words; on the next street one per strength bucket where they differ. */
  private choiceText(n: TNode, fmt: (label: string) => string): string {
    const labels = n.choice.map((c) => fmt(n.acts[c].label));
    if (new Set(labels).size === 1) return labels[0];
    const names = this.cfg.heroBuckets === 4 ? ['weakest', 'weak', 'strong', 'strongest'] : labels.map((_, i) => `bucket ${i + 1}`);
    return labels.map((l, i) => `${l} with Hero's ${names[i]} holdings on that card`).join(', ');
  }

  result(z = 2.5, scenarios = true): PostflopResult & { v3: V3Detail } {
    const N = Math.max(1, this.n);
    const vals = this.rootValues(null, true);
    const K = vals.length;
    const ev = vals.map((v) => v.reduce((a, b) => a + b, 0) / N);
    const variance = (v: Float64Array, m: number) => v.reduce((a, b) => a + (b - m) * (b - m), 0) / N;
    const se = vals.map((v, c) => Math.sqrt(variance(v, ev[c]) / N));
    let best = 0;
    for (let c = 1; c < K; c++) if (ev[c] > ev[best]) best = c;
    let second = -1;
    for (let c = 0; c < K; c++) if (c !== best && (second < 0 || ev[c] > ev[second])) second = c;
    const gapSe = (c: number) => { const d = new Float64Array(this.n); for (let i = 0; i < this.n; i++) d[i] = vals[best][i] - vals[c][i]; const m = d.reduce((a, b) => a + b, 0) / N; return Math.sqrt(variance(d, m) / N); };
    const evGap = second >= 0 ? ev[best] - ev[second] : null;
    const evGapSe = second >= 0 ? gapSe(second) : null;
    const pot = this.root.kids[0]?.end?.pot ?? 0;
    const potNow = Math.max(1, this.potAtRoot());
    const tolBase = 0.012 * potNow;
    const w = ev.map((e, c) => { if (c === best) return 1; const tol = Math.max(tolBase, gapSe(c)); const gap = ev[best] - e; return gap > 1.5 * tol ? 0 : Math.exp(-gap / (0.5 * tol)); });
    const tot = w.reduce((a, b) => a + b, 0);
    void pot;
    const candidates: Candidate[] = this.specs.map((sp, c) => ({ action: sp.action, to: sp.action === 'bet' || sp.action === 'raise' ? sp.to : undefined, label: sp.label, ev: ev[c], evSe: se[c], freq: w[c] / tot }));

    // Line statistics in version 2's format, plus version 3's plans and decompositions.
    const lines: LineStats[] = [];
    const detail: V3Detail = { nodes: this.nodes, deals: this.n, plans: [], decomposition: [], checkOptions: null, sensitivity: [], mixture: this.mix.map((m) => ({ name: m.name, weight: m.weight })) };
    for (let c = 0; c < K; c++) {
      const kid = this.root.kids[c], sp = this.specs[c];
      const st: LineStats = { foldAll: 0, raised: 0, called: 0, equityWhenCalled: null, betBehind: 0, plan: null };
      const plan = this.planOf(kid);
      detail.plans.push(plan);
      if (kid.type === 'opp') {
        const cs = this.childStats(kid);
        if (kid.facing) {
          st.foldAll = cs.probs[0]; st.called = cs.probs[1]; st.raised = cs.probs[2] ?? 0; st.equityWhenCalled = cs.eqCalled;
          // Where the value of the bet comes from: the three opponent responses, each weighted by its probability.
          const parts = this.decompose(kid, vals[c]);
          detail.decomposition.push({ fromFolds: parts[0], fromCalls: parts[1], fromRaises: parts[2] ?? 0, eqContinue: cs.eqContinue });
        } else {
          st.betBehind = 1 - cs.probs[0];
          detail.decomposition.push(null);
        }
        st.plan = plan.length ? plan.join('; ') : null;
      } else detail.decomposition.push(null);
      lines.push(st);
      if (sp.action === 'check' && kid.type === 'opp' && !kid.facing) detail.checkOptions = this.checkOptions(kid);
    }

    // Sensitivity: the same deals and tree under two other opponents.
    if (scenarios) {
      const alt: [string, Knobs][] = this.mix.map((m) => [m.name, m.knobs]);
      for (const [name, kk] of alt) {
        const v = this.rootValues(kk, false).map((x) => x.reduce((a, b) => a + b, 0) / N);
        let b2 = 0;
        for (let c = 1; c < K; c++) if (v[c] > v[b2]) b2 = c;
        detail.sensitivity.push({ scenario: name, evOfChosen: v[best], best: this.specs[b2].label, evBest: v[b2] });
      }
      this.rootValues(null, true); // restore the recorded choices of the decision itself
    }

    const m = Array.from(this.out.subarray(0, this.n)).reduce((a, o) => a + OUTCOME_SHARE[o], 0) / N;
    const sq = Array.from(this.out.subarray(0, this.n)).reduce((a, o) => a + OUTCOME_SHARE[o] ** 2, 0) / N;
    const equity: EquityEstimate = {
      equity: m, win: Array.from(this.out.subarray(0, this.n)).filter((o) => o === 2).length / N, tie: Array.from(this.out.subarray(0, this.n)).filter((o) => o === 1).length / N,
      samples: this.n, stdErr: Math.sqrt(Math.max(0, sq - m * m) / N), opponents: 1, approxSamples: this.approx,
    };
    return {
      candidates, best, bestModel: best, evGap, evGapSe, samples: this.n, lines, equity,
      separated: evGap === null || (evGapSe !== null && evGap > z * evGapSe && evGap > 0.005 * potNow),
      v3: detail,
    };
  }

  private potAtRoot(): number {
    const e = this.root.kids.find((k) => k.end)?.end;
    if (e) return e.pot - e.heroIn;
    // No leaf directly below the root: walk to any leaf on the passive branch.
    let n = this.root.kids[0];
    while (!n.end) n = n.kids[0];
    return n.end!.pot - n.end!.heroIn;
  }

  /** Contribution of each opponent response to a bet's value (chips, averaged over deals). */
  private decompose(kid: TNode, total: Float64Array): number[] {
    const N = this.n, A = kid.acts.length;
    const parts = new Array<number>(A).fill(0);
    const tmp = new Float64Array(A);
    const reach = new Float64Array(N).fill(1);
    const Vk = kid.kids.map((c, a) => { const cr = new Float64Array(N); for (let d = 0; d < N; d++) { this.oppProbs(kid, d, null, tmp); cr[d] = reach[d] * tmp[a]; } return this.evalNode(c, cr, null, false); });
    for (let d = 0; d < N; d++) { this.oppProbs(kid, d, null, tmp); for (let a = 0; a < A; a++) parts[a] += tmp[a] * Vk[a][d]; }
    void total;
    return parts.map((p) => p / Math.max(1, N));
  }

  /** After Hero checks and the opponent bets: the value of each of Hero's answers, per bet size, and what each would mean. */
  private checkOptions(kid: TNode): CheckOption[] {
    const N = this.n;
    const out: CheckOption[] = [];
    const tmp = new Float64Array(kid.acts.length);
    for (let a = 0; a < kid.acts.length; a++) {
      const bet = kid.acts[a];
      const hn = kid.kids[a];
      if (bet.kind === 'check' || hn.type !== 'hero') continue;
      const reach = new Float64Array(N);
      let mass = 0;
      for (let d = 0; d < N; d++) { this.oppProbs(kid, d, null, tmp); reach[d] = tmp[a]; mass += tmp[a]; }
      if (mass <= 1e-9) continue;
      const opts = hn.acts.map((x, j) => {
        const v = this.evalNode(hn.kids[j], reach, null, false);
        let s = 0; for (let d = 0; d < N; d++) s += reach[d] * v[d];
        let purpose: string | null = null;
        if (x.kind === 'raise') {
          // Equity against the hands that continue against the check-raise, and the share that folds.
          const vn = hn.kids[j];
          if (vn.type === 'opp') {
            const t2 = new Float64Array(vn.acts.length);
            let cw = 0, ce = 0, fw = 0;
            for (let d = 0; d < N; d++) { if (!reach[d]) continue; this.oppProbs(vn, d, null, t2); fw += reach[d] * t2[0]; const pc = reach[d] * (1 - t2[0]); cw += pc; ce += pc * OUTCOME_SHARE[this.out[d]]; }
            const eqc = cw > 0 ? ce / cw : 0, foldShare = fw / mass;
            // A hand whose equity comes mostly from cards still to come is a semi-bluff whatever its equity.
            const drawing = this.board.length < 5 && this.heroOuts >= 8 && this.heroHs < 0.6;
            purpose = drawing ? `semi-bluff check-raise: a draw (${this.heroOuts} outs) that wins ${(100 * eqc).toFixed(0)}% against the hands that continue, plus the hands that fold`
              : eqc >= 0.55 ? 'value check-raise: ahead of the hands that continue'
              : eqc >= 0.4 && foldShare >= 0.3 ? 'protection / thin value check-raise: about even against the hands that continue, and folds out hands with equity'
                : eqc >= 0.25 ? 'semi-bluff check-raise: behind the hands that continue, with equity to improve, profit partly from folds'
                  : 'bluff check-raise: profit comes from folds';
            purpose += ` (continues ${(100 * (1 - foldShare)).toFixed(0)}%, Hero wins ${(100 * eqc).toFixed(0)}% at showdown against them)`;
          }
        }
        return { label: x.label, ev: s / mass, purpose };
      });
      out.push({ facing: bet.label, street: kid.street, nextStreet: kid.depth === 1, probability: mass / N, options: opts, chosen: hn.choice.length ? this.choiceText(hn, (c) => c) : null });
    }
    return out;
  }
}

export interface CheckOption {
  /** The opponent's bet after Hero's check. */
  facing: string;
  /** Street of that bet; nextStreet: Hero's check closed this street and the bet comes on the next card. */
  street: string;
  nextStreet: boolean;
  /** How often the opponent bets this size after Hero checks. */
  probability: number;
  /** Hero's answers with their value given that bet (chips). */
  options: { label: string; ev: number; purpose: string | null }[];
  chosen: string | null;
}

export interface V3Detail {
  nodes: number;
  deals: number;
  /** Per root candidate: what Hero does next in each case. */
  plans: string[][];
  /** Per root bet / raise: value contributed by each opponent response (chips, sums to the candidate's value). */
  decomposition: ({ fromFolds: number; fromCalls: number; fromRaises: number; eqContinue: number | null } | null)[];
  /** When checking is possible: Hero's options after each opponent bet. */
  checkOptions: CheckOption[] | null;
  /** The chosen action under each opponent of the mixture on its own (same deals). */
  sensitivity: { scenario: string; evOfChosen: number; best: string; evBest: number }[];
  /** The opponents Hero's decision is a best response to, with their weights. */
  mixture: { name: string; weight: number }[];
}
