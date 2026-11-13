// ============================================================
// Multiway showdown equity with progressive refinement.
//
// Joint sampling is delegated to MultiwayDealSampler (src/core/equity/
// multiway-equity.ts): every opponent's holding is drawn from its own weighted
// range and the whole tuple is rejected if any card repeats, so the samples
// follow the true joint distribution (product of ranges restricted to
// disjoint deals). Multiway equity is NEVER built from heads-up equities.
//
// ProgressiveEquity returns an estimate after any number of samples and can be
// refined in slices, which is what the decision-time controller needs.
// ============================================================

import { CardId } from '../cards';
import { evaluateHand } from '../../core/equity/hand-eval';
import { MultiwayDealSampler } from '../../core/equity/multiway-equity';
import type { WeightedRange } from '../../core/ranges/weighted-range';

export interface EquityEstimate {
  /** Expected share of a pot every player is eligible for (ties split). */
  equity: number;
  /** Probability Hero holds the sole best hand. */
  win: number;
  /** Probability Hero ties for best. */
  tie: number;
  samples: number;
  /** Standard error of `equity` (Monte Carlo). */
  stdErr: number;
  opponents: number;
  /** Deals drawn with the approximate sequential fallback (heavy range overlap). */
  approxSamples: number;
}

/**
 * One participant's stake for side-pot aware payouts. `invest` is the total the
 * player has in the pot; `rank` < 0 marks a folded player (dead money).
 */
export function showdownPayout(heroIdx: number, invest: readonly number[], rank: readonly number[]): number {
  const n = invest.length;
  // Distinct investment levels of live players, ascending.
  let paid = 0;
  let prev = 0;
  for (;;) {
    let level = Infinity;
    for (let i = 0; i < n; i++) if (rank[i] >= 0 && invest[i] > prev && invest[i] < level) level = invest[i];
    if (level === Infinity) break;
    let amount = 0, best = -1, winners = 0, heroWins = false;
    for (let i = 0; i < n; i++) {
      const c = Math.min(invest[i], level) - Math.min(invest[i], prev);
      amount += c;
      if (rank[i] >= 0 && invest[i] >= level) {
        if (rank[i] > best) { best = rank[i]; winners = 1; heroWins = i === heroIdx; }
        else if (rank[i] === best) { winners++; if (i === heroIdx) heroWins = true; }
      }
    }
    if (heroWins) paid += amount / winners;
    prev = level;
  }
  // Dead money above the top live level goes to the winner(s) of the last pot;
  // it is rare (a folded player out-contributing every live player) and ignored here.
  return paid;
}

export class ProgressiveEquity {
  private readonly sampler: MultiwayDealSampler;
  private readonly n: number;
  private readonly hero: [CardId, CardId];
  private readonly boardLen: number;
  private readonly hand = [0, 0, 0, 0, 0, 0, 0];
  private readonly vhand = [0, 0, 0, 0, 0, 0, 0];
  private sum = 0; private sumSq = 0; private wins = 0; private ties = 0; private count = 0; private approx = 0;

  constructor(hero: [CardId, CardId], board: readonly CardId[], ranges: WeightedRange[], seed = 1) {
    this.sampler = new MultiwayDealSampler(hero, board.slice(), ranges, seed);
    this.n = ranges.length;
    this.hero = hero;
    this.boardLen = board.length;
    this.hand[0] = hero[0]; this.hand[1] = hero[1];
    for (let i = 0; i < board.length; i++) { this.hand[2 + i] = board[i]; this.vhand[2 + i] = board[i]; }
  }

  run(samples: number): void {
    const { sampler, n, hand, vhand, boardLen } = this;
    if (n === 0) { this.count += samples; this.sum += samples; this.sumSq += samples; this.wins += samples; return; }
    const toCome = 5 - boardLen;
    for (let s = 0; s < samples; s++) {
      if (sampler.next()) this.approx++;
      for (let j = 0; j < toCome; j++) { hand[2 + boardLen + j] = sampler.runout[j]; vhand[2 + boardLen + j] = sampler.runout[j]; }
      const hr = evaluateHand(hand);
      let better = false, tied = 0;
      for (let i = 0; i < n && !better; i++) {
        vhand[0] = sampler.villainCards[2 * i]; vhand[1] = sampler.villainCards[2 * i + 1];
        const vr = evaluateHand(vhand);
        if (vr > hr) better = true;
        else if (vr === hr) tied++;
      }
      const share = better ? 0 : 1 / (tied + 1);
      this.sum += share; this.sumSq += share * share;
      if (!better) { if (tied === 0) this.wins++; else this.ties++; }
      this.count++;
    }
  }

  estimate(): EquityEstimate {
    const c = Math.max(1, this.count);
    const mean = this.sum / c;
    const variance = Math.max(0, this.sumSq / c - mean * mean);
    return {
      equity: mean, win: this.wins / c, tie: this.ties / c, samples: this.count,
      stdErr: this.n === 0 ? 0 : Math.sqrt(variance / c), opponents: this.n, approxSamples: this.approx,
    };
  }
}

/** One-shot multiway equity. */
export function multiwayEquity(hero: [CardId, CardId], board: readonly CardId[], ranges: WeightedRange[], samples = 4000, seed = 1): EquityEstimate {
  const p = new ProgressiveEquity(hero, board, ranges, seed);
  p.run(samples);
  return p.estimate();
}
