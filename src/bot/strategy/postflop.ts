// ============================================================
// Postflop decision engine: Monte Carlo EV of every candidate action.
//
// For each sampled deal (one holding per opponent drawn jointly from the
// narrowed ranges, plus a runout) every candidate action is played forward one
// decision round:
//
//   * opponents respond to Hero's action with fold / call / raise probabilities
//     that depend on THEIR sampled holding (ranges/postflop-model.ts),
//   * if Hero is raised, Hero continues only when its hand strength covers the
//     pot odds, otherwise the bet is lost,
//   * surviving players go to showdown on the sampled runout, paid through
//     exact main-pot / side-pot accounting,
//   * on the flop and turn the showdown payout is multiplied by a realization
//     factor (< 1 out of position / multiway) because later betting is not
//     simulated.
//
// EV is in chips relative to folding now. The same random numbers are used for
// every candidate (common random numbers), which makes EV DIFFERENCES much less
// noisy than the individual EVs.
//
// STATUS: computed under a HEURISTIC opponent model. It is a one-round
// look-ahead with rollouts, not a game-tree solve; EV standard errors cover
// Monte Carlo noise only, not model error.
// ============================================================

import { CardId, comboIndex, Rng } from '../cards';
import { evaluateHand } from '../../core/equity/hand-eval';
import { MultiwayDealSampler } from '../../core/equity/multiway-equity';
import { HandState, LegalActions, legalActions, potTotal, seatOf, Street } from '../table/engine';
import { showdownPayout, EquityEstimate } from '../equity/equity';
import { BoardFeatures, betProb, continueThreshold, responseProbs, NEUTRAL } from '../ranges/postflop-model';
import { toWeighted } from '../ranges/range';
import { VillainModel } from './villains';
import { Candidate } from './types';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** HEURISTIC: extra stickiness of the pessimistic response scenario (lowers continue thresholds by ~0.05). */
export const ROBUST_STICKINESS = 0.4;

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

export interface PostflopResult {
  candidates: Candidate[];
  best: number;
  evGap: number | null;
  evGapSe: number | null;
  equity: EquityEstimate;
  samples: number;
  /** True when the best action is separated from the runner-up by more than `z` standard errors. */
  separated: boolean;
}

export class PostflopSolver {
  readonly specs: CandSpec[] = [];
  private readonly la: LegalActions;
  private readonly sampler: MultiwayDealSampler;
  private readonly rng: Rng;
  private readonly pot: number;
  private readonly heroEs: number;
  private readonly heroHs: number;
  private readonly inPosition: boolean;
  private readonly R: number;
  private readonly nV: number;
  private readonly sum: Float64Array;
  private readonly cross: Float64Array;
  /** Sum of aggressive-candidate values under the stickier-opponent scenario. */
  private readonly sumRobust: Float64Array;
  private count = 0;
  private eqSum = 0; private eqSq = 0; private wins = 0; private ties = 0; private approx = 0;
  // scratch
  private readonly invest: number[];
  private readonly rank: number[];
  private readonly baseInvest: number[];
  private readonly vEs: Float64Array;
  private readonly u: Float64Array;
  private readonly u2: Float64Array;
  private readonly hand = [0, 0, 0, 0, 0, 0, 0];
  private readonly vhand = [0, 0, 0, 0, 0, 0, 0];
  private readonly vals: Float64Array;

  constructor(
    private readonly h: HandState,
    private readonly heroSeat: number,
    private readonly heroCards: [CardId, CardId],
    private readonly villains: VillainModel[],
    private readonly features: BoardFeatures,
    seed: number,
  ) {
    const la = legalActions(h, heroSeat);
    if (!la) throw new Error('PostflopSolver: Hero is not to act');
    if (h.board.length < 3) throw new Error('PostflopSolver: needs a flop');
    this.la = la;
    this.rng = new Rng(seed ^ 0x9e3779b9);
    this.pot = potTotal(h);
    const hero = seatOf(h, heroSeat);
    const ci = comboIndex(heroCards[0], heroCards[1]);
    this.heroEs = features.es[ci];
    this.heroHs = features.hs[ci];
    this.inPosition = villains.every((v) => seatOf(h, v.seat).pos!.postflopOrder < hero.pos!.postflopOrder);
    this.nV = villains.length;
    this.R = realizationFactor(h.street, this.inPosition, this.nV, this.heroHs);
    const dead = [...heroCards, ...h.board];
    this.sampler = new MultiwayDealSampler(heroCards, h.board.slice(), villains.map((v) => toWeighted(v.range, dead).range), seed);

    // Participants: [hero, villains..., folded seats (dead money)].
    const folded = h.seats.filter((s) => s.dealtIn && s.folded && s.totalCommit > 0);
    this.baseInvest = [hero.totalCommit, ...villains.map((v) => v.totalCommit), ...folded.map((s) => s.totalCommit)];
    this.invest = this.baseInvest.slice();
    this.rank = this.baseInvest.map(() => -1);
    this.vEs = new Float64Array(this.nV);
    this.u = new Float64Array(this.nV);
    this.u2 = new Float64Array(this.nV);
    for (let i = 0; i < h.board.length; i++) { this.hand[2 + i] = h.board[i]; this.vhand[2 + i] = h.board[i]; }
    this.hand[0] = heroCards[0]; this.hand[1] = heroCards[1];

    this.buildCandidates();
    const C = this.specs.length;
    this.sum = new Float64Array(C);
    this.cross = new Float64Array(C * C);
    this.sumRobust = new Float64Array(C);
    this.vals = new Float64Array(C);
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
      let to = Math.round((facing ? h.currentBet : hero.streetCommit) + f * base);
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

  /** Add Monte Carlo samples. Safe to call repeatedly (anytime refinement). */
  run(samples: number): void {
    const { sampler, nV, villains, features, h, la, pot, specs, hand, vhand, invest, rank, baseInvest, vEs, u, u2, vals } = this;
    const C = specs.length;
    const hero = seatOf(h, this.heroSeat);
    const boardLen = h.board.length;
    const toCome = 5 - boardLen;
    const street = h.street;
    const river = street === 'river';
    const heroTotal = hero.totalCommit;
    const heroMaxAdd = hero.stack;

    for (let s = 0; s < samples; s++) {
      if (sampler.next()) this.approx++;
      for (let j = 0; j < toCome; j++) { hand[2 + boardLen + j] = sampler.runout[j]; vhand[2 + boardLen + j] = sampler.runout[j]; }
      const hr = evaluateHand(hand);
      let better = false, tied = 0;
      const vRank: number[] = [];
      for (let i = 0; i < nV; i++) {
        const a = sampler.villainCards[2 * i], b = sampler.villainCards[2 * i + 1];
        vhand[0] = a; vhand[1] = b;
        const r = evaluateHand(vhand);
        vRank.push(r);
        if (r > hr) better = true; else if (r === hr) tied++;
        vEs[i] = features.es[comboIndex(a, b)];
        u[i] = this.rng.next();
        u2[i] = this.rng.next();
      }
      const share = better ? 0 : 1 / (tied + 1);
      this.eqSum += share; this.eqSq += share * share;
      if (!better) { if (tied === 0) this.wins++; else this.ties++; }

      for (let c = 0; c < C; c++) {
        const spec = specs[c];
        if (spec.action === 'fold') { vals[c] = 0; continue; }
        for (let i = 0; i < invest.length; i++) { invest[i] = baseInvest[i]; rank[i] = -1; }
        rank[0] = hr;
        let add = 0;
        let allInShowdown = river;

        if (spec.action === 'check' || spec.action === 'call') {
          add = la.callAmount;
          if (add >= heroMaxAdd - 1e-9) allInShowdown = true;
          if (spec.action === 'call') {
            // Opponents still to act behind respond to the bet Hero is calling.
            for (let i = 0; i < nV; i++) {
              const v = villains[i];
              rank[1 + i] = vRank[i];
              if (v.allIn || !v.actsBehind) continue;
              const need = Math.min(h.currentBet - v.streetCommit, v.stack);
              if (need <= 0) continue;
              const resp = responseProbs(vEs[i], { street, betFrac: need / Math.max(1, pot), opponents: nV, isRaise: h.raisesThisStreet >= 2, tend: v.tend });
              if (u[i] < resp.fold) rank[1 + i] = -1; else invest[1 + i] += need;
            }
            invest[0] = heroTotal + add;
            vals[c] = (allInShowdown ? 1 : this.R) * showdownPayout(0, invest, rank) - add;
          } else {
            // Check: an opponent behind may bet; Hero then continues only with enough strength.
            let bettor = -1;
            for (let i = 0; i < nV; i++) {
              const v = villains[i];
              rank[1 + i] = vRank[i];
              if (bettor >= 0 || v.allIn || !v.actsBehind) continue;
              if (u[i] < betProb(vEs[i], { street, betFrac: 0.6, opponents: nV, isRaise: false, tend: v.tend })) bettor = i;
            }
            if (bettor < 0) {
              vals[c] = this.R * showdownPayout(0, invest, rank);
            } else {
              const v = villains[bettor];
              const bet = Math.min(Math.max(h.bigBlind, 0.6 * pot), v.stack);
              const heroCont = this.heroEs >= continueThreshold({ street, betFrac: bet / Math.max(1, pot), opponents: nV, isRaise: false, tend: NEUTRAL });
              if (!heroCont) { vals[c] = 0; }
              else {
                const pay = Math.min(bet, heroMaxAdd);
                invest[1 + bettor] += bet;
                invest[0] = heroTotal + pay;
                for (let i = 0; i < nV; i++) {
                  if (i === bettor || villains[i].allIn) continue;
                  const resp = responseProbs(vEs[i], { street, betFrac: bet / Math.max(1, pot), opponents: nV, isRaise: false, tend: villains[i].tend });
                  if (u2[i] < resp.fold) rank[1 + i] = -1; else invest[1 + i] += Math.min(bet, villains[i].stack);
                }
                vals[c] = (river || pay >= heroMaxAdd ? 1 : this.R) * showdownPayout(0, invest, rank) - pay;
              }
            }
          }
          continue;
        }

        // Bet or raise to spec.to. Evaluated twice with the same random draws: once under the
        // modelled responses and once against a "stickier" opponent (continues more). The
        // candidate is later scored by the LOWER of the two EVs, so a bluff has to survive an
        // opponent who folds less than the model says, and a value bet one who folds more.
        const T = spec.to;
        add = T - hero.streetCommit;
        const heroAllIn = add >= heroMaxAdd - 1e-9;
        for (let pass = 0; pass < 2; pass++) {
          if (pass === 1) for (let i = 0; i < invest.length; i++) { invest[i] = baseInvest[i]; rank[i] = -1; }
          rank[0] = hr;
          let val = 0;
          compute: {
            let raiser = -1, live = 0, liveWithChips = 0;
            for (let i = 0; i < nV; i++) {
              const v = villains[i];
              if (v.allIn) { rank[1 + i] = vRank[i]; live++; continue; }
              const need = Math.min(T - v.streetCommit, v.stack);
              if (need <= 0) { rank[1 + i] = vRank[i]; live++; continue; }
              const potBefore = Math.max(1, pot + add - need);
              const tend = pass === 0 ? v.tend : { ...v.tend, stickiness: v.tend.stickiness + ROBUST_STICKINESS };
              const resp = responseProbs(vEs[i], { street, betFrac: need / potBefore, opponents: nV, isRaise: la.raiseKind === 'raise', tend });
              if (u[i] < resp.fold) continue;
              rank[1 + i] = vRank[i];
              invest[1 + i] += need;
              live++;
              if (v.stack - need > 1e-9) liveWithChips++;
              if (raiser < 0 && u[i] >= resp.fold + resp.call && v.stack - need > 1e-9 && !heroAllIn) raiser = i;
            }
            invest[0] = heroTotal + add;
            if (live === 0) { val = showdownPayout(0, invest, rank) - add; break compute; }
            if (raiser >= 0) {
              const v = villains[raiser];
              const potNow = pot + add + (T - v.streetCommit);
              const raiseTo = Math.min(Math.max(2.5 * T, T + potNow), v.streetCommit + v.stack);
              const add2 = Math.min(raiseTo, hero.streetCommit + hero.stack) - T;
              const required = add2 / Math.max(1, potNow + (raiseTo - T) + add2);
              const heroVsRaise = clamp((this.heroEs - 0.78) / 0.2, 0, 1);
              if (heroVsRaise < required) { val = -add; break compute; }
              // Hero continues against the raiser; other callers are assumed to give up (their chips stay in).
              for (let i = 0; i < nV; i++) if (i !== raiser && !villains[i].allIn) rank[1 + i] = -1;
              invest[1 + raiser] = v.totalCommit - v.streetCommit + raiseTo;
              invest[0] = heroTotal + add + add2;
              const closedR = river || add + add2 >= heroMaxAdd - 1e-9 || raiseTo >= v.streetCommit + v.stack - 1e-9;
              val = (closedR ? 1 : this.R) * showdownPayout(0, invest, rank) - (add + add2);
              break compute;
            }
            const closed = river || heroAllIn || liveWithChips === 0;
            val = (closed ? 1 : Math.min(1.03, this.R + 0.03)) * showdownPayout(0, invest, rank) - add;
          }
          if (pass === 0) vals[c] = val; else this.sumRobust[c] += val;
        }
      }

      for (let c = 0; c < C; c++) {
        this.sum[c] += vals[c];
        for (let d = c; d < C; d++) this.cross[c * C + d] += vals[c] * vals[d];
      }
      this.count++;
    }
  }

  get samples(): number { return this.count; }

  result(z = 2.5): PostflopResult {
    const C = this.specs.length;
    const n = Math.max(1, this.count);
    // Aggressive candidates are scored by the worse of the two response scenarios.
    const ev = Array.from(this.sum, (x, c) => (this.specs[c].action === 'bet' || this.specs[c].action === 'raise' ? Math.min(x, this.sumRobust[c]) / n : x / n));
    const evMain = Array.from(this.sum, (x) => x / n);
    const cov = (a: number, b: number) => this.cross[Math.min(a, b) * C + Math.max(a, b)] / n - evMain[a] * evMain[b];
    const se = ev.map((_, c) => Math.sqrt(Math.max(0, cov(c, c)) / n));
    let best = 0;
    for (let c = 1; c < C; c++) if (ev[c] > ev[best]) best = c;
    let second = -1;
    for (let c = 0; c < C; c++) if (c !== best && (second < 0 || ev[c] > ev[second])) second = c;
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
    }));
    return {
      candidates, best, evGap, evGapSe, samples: this.count,
      separated: evGap === null || (evGapSe !== null && evGap > z * evGapSe && evGap > 0.005 * this.pot),
      equity: {
        equity: m, win: this.wins / n, tie: this.ties / n, samples: this.count,
        stdErr: Math.sqrt(Math.max(0, this.eqSq / n - m * m) / n), opponents: this.nV, approxSamples: this.approx,
      },
    };
  }
}
