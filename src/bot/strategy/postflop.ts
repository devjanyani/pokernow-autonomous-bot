// ============================================================
// Postflop decision engine, version 2: Monte Carlo EV of every candidate action
// with the CURRENT betting round and the NEXT street's betting round played out.
//
// For each sampled deal (one holding per opponent drawn jointly from the
// narrowed ranges, plus a runout) every candidate action is played forward:
//
//   1. This street. Opponents respond to Hero's action with fold / call / raise
//      probabilities that depend on THEIR sampled holding and on who holds the
//      betting lead (ranges/postflop-model.ts).
//   2. Hero's follow-up is a PLAN, not a per-deal reaction. "Check, then call a
//      bet" and "check, then fold to a bet" are evaluated as two separate lines
//      over all deals and the better one is the value of checking; the same for
//      "bet, then fold to a raise" versus "bet, then call a raise". Hero cannot
//      see the opponents' cards, so the plan is chosen on the average, never on
//      the sampled holding. Checking can therefore never be worth less than
//      folding.
//   3. Next street (flop -> turn, turn -> river). The sampled next card is
//      dealt and one more betting round is played with every remaining player,
//      Hero included, following the behaviour model for their hand on the new
//      board: the first willing player bets 60% of the pot, the others fold or
//      call. The player who bet last on this street holds the lead. Hero's
//      answer to a bet on that street is again a plan: every line is valued
//      both with Hero following the behaviour model and with Hero giving up to
//      any bet, and the better of the two counts. This is
//      what charges a weak hand for building a pot it cannot comfortably
//      continue in, and pays a draw when it gets there.
//   4. Showdown on the sampled runout, through exact main-pot / side-pot
//      accounting. After a flop decision the river betting is still not
//      simulated, so the payout is multiplied by a realization factor (< 1 out
//      of position / multiway).
//
// EV is in chips relative to folding now. The same random numbers are used for
// every candidate (common random numbers), which makes EV DIFFERENCES much less
// noisy than the individual EVs.
//
// UNCERTAINTY. Two different things are reported and must not be confused:
//   sampling error   evSe / evGapSe: Monte Carlo noise of the reported value. It is taken from the
//                    same per-deal series as the value (for a bet or raise: whichever of the two
//                    response scenarios gave the lower mean).
//   model sensitivity evModel versus evPessimistic on each bet or raise, and `bestModel`: how much
//                    the value moves when the opponents' responses are changed. More samples do
//                    not reduce it.
//
// STATUS: a CALCULATED APPROXIMATION under a HEURISTIC opponent model. It is a
// two-round look-ahead with rollouts, not a game-tree solve. Hero's own play on
// the next street follows the same heuristic model as the opponents'. Standard
// errors cover Monte Carlo noise only, not model error.
// ============================================================

import { CardId, comboIndex, Rng } from '../cards';
import { evaluateHand } from '../../core/equity/hand-eval';
import { MultiwayDealSampler } from '../../core/equity/multiway-equity';
import { HandState, LegalActions, legalActions, potTotal, seatOf, Street } from '../table/engine';
import { showdownPayout, EquityEstimate } from '../equity/equity';
import { BetRole, BoardFeatures, computeFeatures, NEUTRAL, SpotContext, Tendencies } from '../ranges/postflop-model';
import { betProb2 as betProb, continueThreshold2 as continueThreshold, conditionOnContinue, heroStrength, mixRanges, responseProbs2 as responseProbs, strengthTable } from '../ranges/range-model';
import { Range, removeDead, toWeighted } from '../ranges/range';
import { VillainModel } from './villains';
import { betRole, leadSeatFor } from './spot';
import { Candidate } from './types';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const EPS = 1e-9;

/**
 * HEURISTIC: extra stickiness of the pessimistic response scenario. 0.4 lowers every continue threshold by
 * 0.10, i.e. opponents fold roughly ten percentage points less often than the model says.
 */
export let ROBUST_STICKINESS = 0.4;
/** For experiments only (sim/bot): change the pessimistic scenario. */
export function setRobustStickiness(x: number): void { ROBUST_STICKINESS = x; }
/** HEURISTIC: size, as a fraction of the pot, of bets made by anyone on a simulated later decision. */
export const ROLLOUT_BET = 0.5;
/**
 * Hero's own simulated play on the next street bets for value but hardly ever as a bluff (bluff rate x0.2):
 * the value of an action today must not rest on bluffs the engine has not actually decided to make.
 */
export const HERO_ROLLOUT: Tendencies = { ...NEUTRAL, aggression: -1 };

interface CandSpec { action: 'fold' | 'check' | 'call' | 'bet' | 'raise'; to: number; label: string; allIn: boolean }

/** HEURISTIC share of showdown equity realised when later betting is not simulated. */
export function realizationFactor(street: Street, inPosition: boolean, opponents: number, heroHs: number): number {
  if (street === 'river') return 1;
  let r = street === 'flop' ? 0.92 : 0.96;
  if (!inPosition) r -= street === 'flop' ? 0.07 : 0.04;
  r -= 0.02 * Math.max(0, opponents - 1);
  if (heroHs > 0.85) r += 0.06;
  return clamp(r, 0.7, 1.03);
}

export function sizeLabel(fracOfPot: number, allIn: boolean): string {
  if (allIn) return 'all-in';
  if (fracOfPot <= 0.45) return 'small';
  if (fracOfPot <= 0.85) return 'medium';
  if (fracOfPot <= 1.25) return 'large';
  return 'overbet';
}

/** What the simulation saw happen after one candidate (modelled responses, first scenario). */
export interface LineStats {
  /** Bet / raise: share of deals where every opponent folded at once. */
  foldAll: number;
  /** Bet / raise: share of deals where at least one opponent raised. */
  raised: number;
  /** Bet / raise: share of deals where it was called and not raised. */
  called: number;
  /** Bet / raise: Hero's showdown share against the hands that called, null when it was never called. */
  equityWhenCalled: number | null;
  /** Check: share of deals where an opponent bet behind Hero. */
  betBehind: number;
  /** The follow-up the EV assumes: e.g. 'fold to a bet', 'call a raise'. */
  plan: string | null;
}

export interface PostflopResult {
  candidates: Candidate[];
  best: number;
  /**
   * The best candidate when only the modelled responses are used. If it differs from `best`, the choice
   * depends on which opponent-response assumption is right; no amount of extra sampling settles that.
   */
  bestModel: number;
  evGap: number | null;
  evGapSe: number | null;
  equity: EquityEstimate;
  samples: number;
  /** True when the best action is separated from the runner-up by more than `z` standard errors. */
  separated: boolean;
  lines: LineStats[];
}

export class PostflopSolver {
  readonly specs: CandSpec[] = [];
  private readonly la: LegalActions;
  private readonly sampler: MultiwayDealSampler;
  private readonly rng: Rng;
  private readonly pot: number;
  private readonly heroHs: number;
  private readonly heroEs: number;
  private readonly inPosition: boolean;
  private readonly nV: number;
  private readonly P: number;
  private readonly river: boolean;
  private readonly nextStreet: Street;
  /** Realization factor for the betting that is still not simulated after the next street. */
  private readonly Rnext: number;
  // per player (0 = Hero, 1.. = opponents)
  private readonly stack0: number[];
  private readonly total0: number[];
  private readonly order: number[];
  private readonly byOrder: number[];
  private readonly tend: Tendencies[];
  /** Lead of each opponent if Hero checks and it may bet. */
  private readonly vRole: BetRole[];
  /** Player index of this street's current aggressor (the bet Hero is facing), or -1. */
  private readonly streetAgg: number;
  // internal EV columns: one per (candidate, follow-up plan)
  private readonly colOf: number[][] = [];
  private nCols = 0;
  // Per-deal values are kept for BOTH response scenarios: index k (k < nCols) is column k under the modelled
  // responses, index nCols + k the same column against the pessimistic (stickier) opponents. For a column that
  // is not a bet or raise the two are the same number. Sums and cross-products cover all 2 * nCols series, so
  // the standard error of a value is always taken from the series the value itself came from.
  private sum!: Float64Array;
  private cross!: Float64Array;
  private vals!: Float64Array;
  private readonly stat: { foldAll: number; raised: number; called: number; shareCalled: number; betBehind: number }[] = [];
  private count = 0;
  private eqSum = 0; private eqSq = 0; private wins = 0; private ties = 0; private approx = 0;
  // scratch
  private readonly invest: number[];
  private readonly rank: number[];
  private readonly baseInvest: number[];
  private readonly es0: Float64Array;
  private readonly es1: Float64Array;
  private readonly u: Float64Array;
  private readonly u2: Float64Array;
  private readonly ro: Float64Array;
  private readonly sNext: Float64Array;
  private readonly hand = [0, 0, 0, 0, 0, 0, 0];
  private readonly vhand = [0, 0, 0, 0, 0, 0, 0];
  private readonly nextFeat = new Map<number, { hero: number; tables: Float32Array[] }>();
  /** Strength of every holding inside each opponent's range on the current board. */
  private readonly S0: Float32Array[];
  /** Fold threshold each player's range was filtered through by continuing against a bet on this street (0: none). */
  private readonly cond: Float64Array;
  private readonly heroPerceived: Range;
  private readonly oppMix: Range[];
  private readonly villainMix: Range;
  /** Value of the last settle() call under the alternative plan "fold to any bet on the next street". */
  private alt = 0;
  private readonly heroCombo: number;

  constructor(
    private readonly h: HandState,
    private readonly heroSeat: number,
    private readonly heroCards: [CardId, CardId],
    private readonly villains: VillainModel[],
    private readonly features: BoardFeatures,
    seed: number,
    /** The range the opponents can put Hero on from Hero's line (not Hero's actual cards). Default: any two cards. */
    heroPerceived?: Range,
  ) {
    const la = legalActions(h, heroSeat);
    if (!la) throw new Error('PostflopSolver: Hero is not to act');
    if (h.board.length < 3) throw new Error('PostflopSolver: needs a flop');
    this.la = la;
    this.rng = new Rng(seed ^ 0x9e3779b9);
    this.pot = potTotal(h);
    const hero = seatOf(h, heroSeat);
    this.heroCombo = comboIndex(heroCards[0], heroCards[1]);
    this.heroEs = features.es[this.heroCombo];
    this.heroHs = features.hs[this.heroCombo];
    this.inPosition = villains.every((v) => seatOf(h, v.seat).pos!.postflopOrder < hero.pos!.postflopOrder);
    this.nV = villains.length;
    this.P = 1 + this.nV;
    this.river = h.street === 'river';
    this.nextStreet = h.street === 'flop' ? 'turn' : 'river';
    this.Rnext = h.street === 'flop' ? realizationFactor('turn', this.inPosition, this.nV, this.heroHs) : 1;
    const dead = [...heroCards, ...h.board];
    this.sampler = new MultiwayDealSampler(heroCards, h.board.slice(), villains.map((v) => toWeighted(v.range, dead).range), seed);

    this.stack0 = [hero.stack, ...villains.map((v) => v.stack)];
    this.total0 = [hero.totalCommit, ...villains.map((v) => v.totalCommit)];
    this.order = [hero.pos!.postflopOrder, ...villains.map((v) => seatOf(h, v.seat).pos!.postflopOrder)];
    this.byOrder = this.order.map((_, p) => p).sort((a, b) => this.order[a] - this.order[b]);
    this.tend = [HERO_ROLLOUT, ...villains.map((v) => v.tend)];
    const lead = leadSeatFor(h, h.street);
    const acted = new Set(h.events.filter((e) => e.street === h.street && !e.kind.startsWith('post')).map((e) => e.seat));
    acted.add(heroSeat);
    this.vRole = villains.map((v) => betRole(h, v.seat, lead, acted));
    const aggSeat = h.aggressor[h.street];
    this.streetAgg = aggSeat === null ? -1 : aggSeat === heroSeat ? 0 : 1 + villains.findIndex((v) => v.seat === aggSeat);

    // Participants: [hero, villains..., folded seats (dead money)].
    const folded = h.seats.filter((s) => s.dealtIn && s.folded && s.totalCommit > 0);
    this.baseInvest = [...this.total0, ...folded.map((s) => s.totalCommit)];
    this.invest = this.baseInvest.slice();
    this.rank = this.baseInvest.map(() => -1);
    this.heroPerceived = heroPerceived ?? removeDead(new Float64Array(1326).fill(1), h.board);
    // Each opponent's hands are measured inside its own range and against everybody else's (Hero's perceived range included).
    this.oppMix = villains.map((_, i) => mixRanges([this.heroPerceived, ...villains.filter((_, j) => j !== i).map((v) => v.range)]));
    this.villainMix = mixRanges(villains.map((v) => v.range));
    this.S0 = villains.map((v, i) => strengthTable(v.range, this.oppMix[i], features));
    this.cond = new Float64Array(this.P);
    this.es0 = new Float64Array(this.P);
    this.es1 = new Float64Array(this.P);
    this.u = new Float64Array(this.nV);
    this.u2 = new Float64Array(this.nV);
    this.ro = new Float64Array(2 * this.P);
    this.sNext = new Float64Array(this.P);
    for (let i = 0; i < h.board.length; i++) { this.hand[2 + i] = h.board[i]; this.vhand[2 + i] = h.board[i]; }
    this.hand[0] = heroCards[0]; this.hand[1] = heroCards[1];

    this.buildCandidates();
    for (const sp of this.specs) {
      // Columns come in pairs: [plan with the model's next-street play, same plan giving up to a next-street bet].
      const n = sp.action === 'fold' ? 1 : sp.action === 'call' ? 2 : 4;
      const cols: number[] = [];
      for (let k = 0; k < n; k++) cols.push(this.nCols++);
      this.colOf.push(cols);
      this.stat.push({ foldAll: 0, raised: 0, called: 0, shareCalled: 0, betBehind: 0 });
    }
    const C2 = 2 * this.nCols;
    this.sum = new Float64Array(C2);
    this.cross = new Float64Array(C2 * C2);
    this.vals = new Float64Array(C2);
  }

  private buildCandidates(): void {
    const { la, h, pot } = this;
    const hero = seatOf(h, this.heroSeat);
    if (la.canCheck) this.specs.push({ action: 'check', to: 0, label: 'check', allIn: false });
    else {
      this.specs.push({ action: 'fold', to: 0, label: 'fold', allIn: false });
      if (la.canCall) this.specs.push({ action: 'call', to: 0, label: la.callAmount >= hero.stack ? 'call all-in' : 'call', allIn: la.callAmount >= hero.stack });
    }
    if (!la.canRaise) return;
    // Betting more than the deepest opponent can call is pointless: the excess comes back.
    const deepest = Math.max(...this.villains.filter((v) => !v.allIn).map((v) => v.streetCommit + v.stack), 0);
    const cap = Math.min(la.maxRaiseTo, Math.max(deepest, la.minRaiseTo));
    const facing = h.currentBet > hero.streetCommit;
    const base = facing ? pot + la.callAmount : pot;
    const fracs = facing ? [0.55, 1.0] : [0.33, 0.66, 1.0, 1.5];
    const tos: number[] = [];
    for (const f of fracs) {
      // Whole chips at stakes of 2 or more per big blind; cents below (at 0.25 / 0.50 a whole chip is 2 big blinds,
      // which made the three smaller sizes collapse into one in small pots).
      const raw = (facing ? h.currentBet : hero.streetCommit) + f * base;
      let to = h.bigBlind >= 2 ? Math.round(raw) : Math.round(raw * 100) / 100;
      to = clamp(to, la.minRaiseTo, cap);
      if (to >= 0.75 * cap) to = cap;
      tos.push(to);
    }
    if (cap - (facing ? h.currentBet : hero.streetCommit) <= 2.5 * base) tos.push(cap);
    const seen = new Set<number>();
    for (const to of tos.sort((a, b) => a - b)) {
      if (seen.has(to)) continue;
      seen.add(to);
      const allIn = to >= la.maxRaiseTo - 1e-9 || to >= cap;
      const frac = (to - (facing ? h.currentBet : hero.streetCommit)) / Math.max(1, base);
      const size = sizeLabel(frac, to >= la.maxRaiseTo - 1e-9);
      this.specs.push({ action: la.raiseKind, to, label: `${la.raiseKind} ${size} (${to})`, allIn });
    }
  }

  /** Range-relative strengths on the board after `card`: one table per opponent, and Hero's hand against their ranges. */
  private featuresAfter(card: number): { hero: number; tables: Float32Array[] } {
    let f = this.nextFeat.get(card);
    if (!f) {
      const bf = computeFeatures([...this.h.board, card]);
      f = { hero: heroStrength(this.villainMix, bf, this.heroCombo), tables: this.villains.map((v, i) => strengthTable(v.range, this.oppMix[i], bf)) };
      this.nextFeat.set(card, f);
    }
    return f;
  }

  private reset(): void {
    const { invest, rank, baseInvest } = this;
    for (let i = 0; i < invest.length; i++) { invest[i] = baseInvest[i]; rank[i] = -1; }
    this.cond.fill(0);
  }

  /** Response of opponent i to a bet this street; a continue is remembered so its range can be re-read next street. */
  private respond(i: number, ctx: SpotContext, draw: number): 'fold' | 'call' | 'raise' {
    const r = responseProbs(this.es0[1 + i], ctx);
    if (draw < r.fold) return 'fold';
    this.cond[1 + i] = continueThreshold(ctx);
    return draw < r.fold + r.call ? 'call' : 'raise';
  }

  private rem(p: number): number { return this.stack0[p] - (this.invest[p] - this.total0[p]); }

  /**
   * Finish the hand from the end of the current betting round: play the next street's betting round
   * (if any betting is still possible) and pay the showdown. `agg` is the player index who bet or
   * raised last on the current street (-1: checked through). Returns chips relative to folding now.
   */
  private settle(agg: number): number {
    const { invest, rank, P, es1, ro, order, tend } = this;
    const heroIn = invest[0] - this.total0[0];
    const done = (v: number): number => { this.alt = v; return v; };
    if (this.river) return done(showdownPayout(0, invest, rank) - heroIn);
    let live = 0, withChips = 0, pot = 0;
    for (let i = 0; i < invest.length; i++) pot += invest[i];
    for (let p = 0; p < P; p++) if (rank[p] >= 0) { live++; if (this.rem(p) > EPS) withChips++; }
    if (live <= 1 || withChips < 2) return done(showdownPayout(0, invest, rank) - heroIn);

    const street = this.nextStreet;
    // Strength on the next board, re-read inside the range that continued this street.
    const sv = this.sNext;
    let tSum = 0, tN = 0;
    for (let p = 1; p < P; p++) {
      sv[p] = conditionOnContinue(es1[p], this.cond[p]);
      if (rank[p] >= 0) { tSum += this.cond[p]; tN++; }
    }
    sv[0] = conditionOnContinue(es1[0], tN ? tSum / tN : 0);
    const aggCanAct = agg >= 0 && rank[agg] >= 0 && this.rem(agg) > EPS;
    let bettor = -1;
    for (const p of this.byOrder) {
      if (rank[p] < 0 || this.rem(p) <= EPS) continue;
      const role: BetRole = !aggCanAct ? 'neutral' : p === agg ? 'aggressor' : order[agg] > order[p] ? 'into-aggressor' : 'neutral';
      if (ro[2 * p] < betProb(sv[p], { street, betFrac: ROLLOUT_BET, opponents: live - 1, isRaise: false, tend: tend[p], role })) { bettor = p; break; }
    }
    if (bettor >= 0) {
      const bet = Math.min(Math.max(this.h.bigBlind, ROLLOUT_BET * pot), this.rem(bettor));
      const frac = bet / Math.max(1, pot);
      invest[bettor] += bet;
      for (let p = 0; p < P; p++) {
        if (p === bettor || rank[p] < 0) continue;
        const left = this.rem(p);
        if (left <= EPS) continue;
        const resp = responseProbs(sv[p], { street, betFrac: frac, opponents: live - 1, isRaise: false, tend: tend[p] });
        if (ro[2 * p + 1] < resp.fold) rank[p] = -1; else invest[p] += Math.min(bet, left);
      }
      if (rank[0] < 0) return done(-heroIn);
    }
    const heroFacedBet = bettor > 0 && invest[0] - this.total0[0] > heroIn + EPS;
    let chips = 0;
    for (let p = 0; p < P; p++) if (rank[p] >= 0 && this.rem(p) > EPS) chips++;
    const closed = street === 'river' || this.rem(0) <= EPS || chips < 2;
    const v = (closed ? 1 : this.Rnext) * showdownPayout(0, invest, rank) - (invest[0] - this.total0[0]);
    this.alt = heroFacedBet ? -heroIn : v;
    return v;
  }

  /** Add Monte Carlo samples. Safe to call repeatedly (anytime refinement). */
  run(samples: number): void {
    const { sampler, nV, villains, h, la, pot, specs, hand, vhand, invest, rank, es0, es1, u, u2, ro, vals, colOf, total0 } = this;
    const C = this.nCols;
    const hero = seatOf(h, this.heroSeat);
    const boardLen = h.board.length;
    const toCome = 5 - boardLen;
    const street = h.street;
    const heroMaxAdd = hero.stack;
    const vRank: number[] = new Array(nV).fill(0);
    es0[0] = this.heroEs;

    for (let s = 0; s < samples; s++) {
      if (sampler.next()) this.approx++;
      for (let j = 0; j < toCome; j++) { hand[2 + boardLen + j] = sampler.runout[j]; vhand[2 + boardLen + j] = sampler.runout[j]; }
      const hr = evaluateHand(hand);
      const next = this.river ? null : this.featuresAfter(sampler.runout[0]);
      if (next) es1[0] = next.hero;
      let better = false, tied = 0;
      for (let i = 0; i < nV; i++) {
        const a = sampler.villainCards[2 * i], b = sampler.villainCards[2 * i + 1];
        vhand[0] = a; vhand[1] = b;
        const r = evaluateHand(vhand);
        vRank[i] = r;
        if (r > hr) better = true; else if (r === hr) tied++;
        const k = comboIndex(a, b);
        es0[1 + i] = this.S0[i][k];
        if (next) es1[1 + i] = next.tables[i][k];
        u[i] = this.rng.next();
        u2[i] = this.rng.next();
      }
      for (let p = 0; p < 2 * this.P; p++) ro[p] = this.rng.next();
      const share = better ? 0 : 1 / (tied + 1);
      this.eqSum += share; this.eqSq += share * share;
      if (!better) { if (tied === 0) this.wins++; else this.ties++; }

      for (let c = 0; c < specs.length; c++) {
        const spec = specs[c];
        const cols = colOf[c];
        if (spec.action === 'fold') { vals[cols[0]] = 0; continue; }

        if (spec.action === 'call') {
          this.reset();
          rank[0] = hr;
          const add = la.callAmount;
          // Opponents still to act behind respond to the bet Hero is calling.
          for (let i = 0; i < nV; i++) {
            const v = villains[i];
            rank[1 + i] = vRank[i];
            if (v.allIn || !v.actsBehind) continue;
            const need = Math.min(h.currentBet - v.streetCommit, v.stack);
            if (need <= 0) continue;
            if (this.respond(i, { street, betFrac: need / Math.max(1, pot), opponents: nV, isRaise: h.raisesThisStreet >= 2, tend: v.tend }, u[i]) === 'fold') rank[1 + i] = -1; else invest[1 + i] += need;
          }
          invest[0] = total0[0] + add;
          vals[cols[0]] = this.settle(this.streetAgg);
          vals[cols[1]] = this.alt;
          continue;
        }

        if (spec.action === 'check') {
          this.reset();
          rank[0] = hr;
          // The first opponent behind (in action order) willing to bet does so.
          let bettor = -1;
          for (let i = 0; i < nV; i++) rank[1 + i] = vRank[i];
          for (const p of this.byOrder) {
            if (p === 0) continue;
            const i = p - 1, v = villains[i];
            if (v.allIn || !v.actsBehind) continue;
            if (u[i] < betProb(es0[p], { street, betFrac: ROLLOUT_BET, opponents: nV, isRaise: false, tend: v.tend, role: this.vRole[i] })) { bettor = i; break; }
          }
          if (bettor < 0) {
            const v0 = this.settle(-1);
            vals[cols[0]] = v0; vals[cols[2]] = v0;
            vals[cols[1]] = this.alt; vals[cols[3]] = this.alt;
          } else {
            this.stat[c].betBehind++;
            vals[cols[0]] = 0; vals[cols[1]] = 0;                // plan: fold to a bet
            const v = villains[bettor];
            const bet = Math.min(Math.max(h.bigBlind, ROLLOUT_BET * pot), v.stack);
            const pay = Math.min(bet, heroMaxAdd);
            invest[1 + bettor] += bet;
            invest[0] = total0[0] + pay;
            for (let i = 0; i < nV; i++) {
              if (i === bettor || villains[i].allIn) continue;
              if (this.respond(i, { street, betFrac: bet / Math.max(1, pot), opponents: nV, isRaise: false, tend: villains[i].tend }, u2[i]) === 'fold') rank[1 + i] = -1; else invest[1 + i] += Math.min(bet, villains[i].stack);
            }
            vals[cols[2]] = this.settle(1 + bettor);             // plan: call a bet
            vals[cols[3]] = this.alt;
          }
          continue;
        }

        // Bet or raise to spec.to. Evaluated twice with the same random draws: once under the
        // modelled responses and once against a "stickier" opponent (continues more). The
        // candidate is later scored by the LOWER of the two EVs, so a bluff has to survive an
        // opponent who folds less than the model says. The scenario is ONE-SIDED: there is no
        // pass against an opponent who folds MORE or raises more, so a value bet is never tested
        // against the responses that would hurt it (docs/bot/STRATEGY_V2_DIAGNOSIS.md, section 3).
        const T = spec.to;
        const add = T - hero.streetCommit;
        const heroAllIn = add >= heroMaxAdd - 1e-9;
        for (let pass = 0; pass < 2; pass++) {
          this.reset();
          rank[0] = hr;
          let vFold: number, vCont: number, aFold: number, aCont: number;
          let raiser = -1, live = 0;
          for (let i = 0; i < nV; i++) {
            const v = villains[i];
            if (v.allIn) { rank[1 + i] = vRank[i]; live++; continue; }
            const need = Math.min(T - v.streetCommit, v.stack);
            if (need <= 0) { rank[1 + i] = vRank[i]; live++; continue; }
            const potBefore = Math.max(1, pot + add - need);
            const tend = pass === 0 ? v.tend : { ...v.tend, stickiness: v.tend.stickiness + ROBUST_STICKINESS };
            const act = this.respond(i, { street, betFrac: need / potBefore, opponents: nV, isRaise: la.raiseKind === 'raise', tend }, u[i]);
            if (act === 'fold') continue;
            rank[1 + i] = vRank[i];
            invest[1 + i] += need;
            live++;
            if (raiser < 0 && act === 'raise' && v.stack - need > 1e-9 && !heroAllIn) raiser = i;
          }
          invest[0] = total0[0] + add;
          if (live === 0) {
            vFold = vCont = aFold = aCont = showdownPayout(0, invest, rank) - add;
            if (pass === 0) this.stat[c].foldAll++;
          } else if (raiser >= 0) {
            if (pass === 0) this.stat[c].raised++;
            vFold = aFold = -add;                                // plan: fold to a raise
            const v = villains[raiser];
            const potNow = pot + add + (T - v.streetCommit);
            const raiseTo = Math.min(Math.max(2.5 * T, T + potNow), v.streetCommit + v.stack);
            const add2 = Math.min(raiseTo, hero.streetCommit + hero.stack) - T;
            // Plan: call the raise. Other callers are assumed to give up (their chips stay in).
            for (let i = 0; i < nV; i++) if (i !== raiser && !villains[i].allIn) rank[1 + i] = -1;
            invest[1 + raiser] = v.totalCommit - v.streetCommit + raiseTo;
            this.cond[1 + raiser] = 0;                           // a raising range is value plus bluffs, not "the top of the range"
            invest[0] = total0[0] + add + add2;
            vCont = this.settle(1 + raiser);
            aCont = this.alt;
          } else {
            if (pass === 0) {
              this.stat[c].called++;
              let lose = false, tie = 0;
              for (let i = 0; i < nV; i++) if (rank[1 + i] >= 0) { if (vRank[i] > hr) lose = true; else if (vRank[i] === hr) tie++; }
              this.stat[c].shareCalled += lose ? 0 : 1 / (tie + 1);
            }
            vFold = vCont = this.settle(0);
            aFold = aCont = this.alt;
          }
          const o = pass === 0 ? 0 : C;
          vals[o + cols[0]] = vFold; vals[o + cols[1]] = aFold; vals[o + cols[2]] = vCont; vals[o + cols[3]] = aCont;
        }
      }

      // Columns that are not bets or raises have one scenario only: mirror them.
      for (let c = 0; c < specs.length; c++) {
        const a = specs[c].action;
        if (a === 'bet' || a === 'raise') continue;
        for (const k of colOf[c]) vals[C + k] = vals[k];
      }
      const C2 = 2 * C;
      for (let c = 0; c < C2; c++) {
        const vc = vals[c];
        this.sum[c] += vc;
        const row = c * C2;
        for (let d = c; d < C2; d++) this.cross[row + d] += vc * vals[d];
      }
      this.count++;
    }
  }

  get samples(): number { return this.count; }

  result(z = 2.5): PostflopResult {
    const C = this.nCols, C2 = 2 * C;
    const n = Math.max(1, this.count);
    const K = this.specs.length;
    // Value of each candidate = value of its best follow-up plan. Aggressive candidates are scored
    // by the worse of the two response scenarios. `col[c]` is the SERIES the value came from (k: modelled
    // responses, C + k: pessimistic), so every variance and covariance below belongs to the reported value.
    const col: number[] = [], ev: number[] = [], lines: LineStats[] = [];
    const evModel: (number | null)[] = [], evPess: (number | null)[] = [];
    for (let c = 0; c < K; c++) {
      const sp = this.specs[c], cols = this.colOf[c], st = this.stat[c];
      const aggressive = sp.action === 'bet' || sp.action === 'raise';
      const series = (k: number) => (aggressive && this.sum[C + k] < this.sum[k] ? C + k : k);
      const score = (k: number) => this.sum[series(k)] / n;
      let pick = cols[0];
      for (const k of cols) if (score(k) > score(pick)) pick = k;
      col.push(series(pick)); ev.push(score(pick));
      // Each scenario on its own, with the plan that is best inside that scenario.
      evModel.push(aggressive ? Math.max(...cols.map((k) => this.sum[k])) / n : null);
      evPess.push(aggressive ? Math.max(...cols.map((k) => this.sum[C + k])) / n : null);
      const second = cols.length === 4 && (pick === cols[2] || pick === cols[3]);
      lines.push({
        foldAll: st.foldAll / n, raised: st.raised / n, called: st.called / n,
        equityWhenCalled: st.called > 0 ? st.shareCalled / st.called : null, betBehind: st.betBehind / n,
        plan: sp.action === 'check' ? (st.betBehind === 0 ? null : second ? 'call if an opponent bets' : 'fold if an opponent bets')
          : aggressive ? (st.raised === 0 ? null : second ? 'continue if raised' : 'fold if raised') : null,
      });
    }
    const mean = (k: number) => this.sum[k] / n;
    const cov = (a: number, b: number) => { const x = col[a], y = col[b]; return this.cross[Math.min(x, y) * C2 + Math.max(x, y)] / n - mean(x) * mean(y); };
    const se = ev.map((_, c) => Math.sqrt(Math.max(0, cov(c, c)) / n));
    let best = 0;
    for (let c = 1; c < K; c++) if (ev[c] > ev[best]) best = c;
    let second = -1;
    for (let c = 0; c < K; c++) if (c !== best && (second < 0 || ev[c] > ev[second])) second = c;
    const gapSeOf = (c: number) => Math.sqrt(Math.max(0, cov(best, best) + cov(c, c) - 2 * cov(best, c)) / n);
    const evGap = second >= 0 ? ev[best] - ev[second] : null;
    const evGapSe = second >= 0 ? gapSeOf(second) : null;

    // Controlled mixing: only among actions statistically and practically tied with the best.
    const tolBase = 0.012 * this.pot;
    const w = ev.map((e, c) => {
      if (c === best) return 1;
      const tol = Math.max(tolBase, gapSeOf(c));
      const gap = ev[best] - e;
      return gap > 1.5 * tol ? 0 : Math.exp(-gap / (0.5 * tol));
    });
    const tot = w.reduce((a, b) => a + b, 0);
    const m = this.eqSum / n;
    const candidates: Candidate[] = this.specs.map((sp, c) => ({
      action: sp.action, to: sp.action === 'bet' || sp.action === 'raise' ? sp.to : undefined,
      label: sp.label, ev: ev[c], evSe: se[c], freq: w[c] / tot,
      ...(evModel[c] !== null ? { evModel: evModel[c] as number, evPessimistic: evPess[c] as number } : {}),
    }));
    // Which action would be best if only the modelled responses counted (no pessimistic scenario)?
    let bestModel = 0;
    const m1 = (c: number) => evModel[c] ?? ev[c];
    for (let c = 1; c < K; c++) if (m1(c) > m1(bestModel)) bestModel = c;
    return {
      candidates, best, bestModel, evGap, evGapSe, samples: this.count, lines,
      separated: evGap === null || (evGapSe !== null && evGap > z * evGapSe && evGap > 0.005 * this.pot),
      equity: {
        equity: m, win: this.wins / n, tie: this.ties / n, samples: this.count,
        stdErr: Math.sqrt(Math.max(0, this.eqSq / n - m * m) / n), opponents: this.nV, approxSamples: this.approx,
      },
    };
  }
}
