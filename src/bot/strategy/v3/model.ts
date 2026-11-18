// ============================================================
// Version 3 opponent model: how the ONE remaining opponent acts at each point of a betting sequence.
//
// It is the version 2 behaviour model (ranges/range-model.ts: bet / continue / raise as functions of a
// holding's range-relative strength) made conditional on the betting history, because a player who faces a
// check-raise, or a re-raise, or whose bet was raised, does not respond like a player facing a first bet:
//
//   facing                       continue threshold                     raise
//   a bet                        version 2 (size, street, stickiness)   version 2 x player's raise tendency
//   a raise over its own bet     + foldVsRaise shift                    x 0.6 (a re-raise needs a stronger hand)
//   a check-raise                + foldToCheckRaise shift               x 0.6
//   a third raise or more        + reraise shift                        x 0.3
//   may bet first                version 2 bet probability x turn-barrel / river-bet tendency when it holds the lead
//
// What is history-dependent and what is not:
//   - the opponent's own cards decide its action through its strength s on the current board; the search
//     carries every sampled holding with its probability of having taken the actions so far (its reach), so
//     the range after "bet, raised, called" is exactly the holdings the model would play that way;
//   - the THRESHOLDS above depend on the sequence, so the same holding folds more to a check-raise than to a bet.
//
// STATUS: HEURISTIC. Every shift below is a hand-set number. Where a player's own statistics exist
// (opponents/profile.ts: foldToCheckRaise, foldVsRaise, reraiseVsRaise, raiseVsBet*, cbetTurn,
// betWhenCheckedToRiver, bet sizes) they move the knob, shrunk toward the population assumption by the
// number of observed opportunities: no adjustment from a handful of hands. `evidence` says which knobs moved
// and on how many observations.
// ============================================================

import { PlayerProfile, posterior, PRIORS, StatKey } from '../../opponents/profile';
import { BetRole, Tendencies } from '../../ranges/postflop-model';
import { betProb2, RANGE_MODEL, responseProbs2 } from '../../ranges/range-model';
import type { Street } from '../../table/engine';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** HEURISTIC population assumptions of the version 3 model (not measured; see the header). */
export const MODEL3 = {
  /** Continue threshold added when facing a check-raise (a check-raising range is strong). */
  checkRaiseShift: 0.06,
  /** Continue threshold added when a player's own bet or raise is raised. */
  raisedShift: 0.04,
  /** Continue threshold added at the third raise or more of a street. */
  reraiseShift: 0.08,
  /** Raise probability multiplier when facing a raise (re-raising needs more) and at the third raise or more. */
  reraiseMult: 0.6,
  thirdRaiseMult: 0.3,
  /** Share of bets made with the larger of the two sizes, before player evidence. */
  largeShare: 0.45,
  /** Opportunities at which a player's own statistic counts half. */
  halfWeightAt: 20,
  /**
   * Share of deals in which the opponent is NOT the modelled one but one of two plausible deviations (stickier,
   * or more aggressive), before any evidence about the player. It shrinks as the player's own responses to bets
   * are observed: uncertainty x halfWeightAt / (halfWeightAt + opportunities).
   */
  uncertainty: 0.4,
  /** The two deviations: stickiness added (folds less), and aggression added with raising doubled. */
  stickierBy: 0.4,
  aggressiveBy: 0.6,
};

/** Player-specific knobs on top of version 2's tendencies. 1 / 0 = population assumption. */
export interface Knobs {
  tend: Tendencies;
  /** Multiplier on raising when facing a bet. */
  raiseMult: number;
  /** Added to the continue threshold when facing a check-raise / when the player's own bet is raised. */
  checkRaiseShift: number;
  raisedShift: number;
  /** Multiplier on betting on the turn after holding the lead / on the river. */
  barrelMult: number;
  riverBetMult: number;
  /** Share of bets made with the larger size. */
  largeShare: number;
  /** Plain statements of what moved and on what evidence. Empty = population assumptions only. */
  evidence: string[];
  /** The player's observed responses to bets after the flop (opportunities), for the model-uncertainty weight. */
  observed: number;
}

export const defaultKnobs = (tend: Tendencies): Knobs => ({
  tend, raiseMult: 1, checkRaiseShift: MODEL3.checkRaiseShift, raisedShift: MODEL3.raisedShift, barrelMult: 1, riverBetMult: 1, largeShare: MODEL3.largeShare, evidence: [], observed: 0,
});

/** The modelled opponent and the two deviations Hero cannot rule out, with their weights. */
export function opponentMixture(k: Knobs, uncertainty = MODEL3.uncertainty): { knobs: Knobs; weight: number; name: string }[] {
  const a = uncertainty * MODEL3.halfWeightAt / (MODEL3.halfWeightAt + k.observed);
  return [
    { knobs: k, weight: 1 - a, name: 'as modelled' },
    { knobs: { ...k, tend: { ...k.tend, stickiness: k.tend.stickiness + MODEL3.stickierBy } }, weight: a / 2, name: 'folds less (stickier)' },
    { knobs: { ...k, raiseMult: k.raiseMult * 2, tend: { ...k.tend, aggression: k.tend.aggression + MODEL3.aggressiveBy } }, weight: a / 2, name: 'bets and raises more' },
  ];
}

/**
 * Knobs from a player's profile. Each statistic moves its knob by (observed - prior) scaled by d / (d + halfWeightAt),
 * using the Beta posterior mean (already shrunk toward the prior), so the movement is small until there are
 * dozens of opportunities. `exploitWeight` 0 returns the population assumptions.
 */
export function knobsFor(p: PlayerProfile | undefined, tend: Tendencies, exploitWeight = 1): Knobs {
  const k = defaultKnobs(tend);
  if (!p || exploitWeight <= 0) return k;
  k.observed = p.stats.foldVsBetFlop.d + p.stats.foldVsBetTurn.d + p.stats.foldVsBetRiver.d;
  const w = (d: number) => exploitWeight * d / (d + MODEL3.halfWeightAt);
  const stat = (key: StatKey) => { const q = posterior(p, key); return { q, prior: PRIORS[key].mean, wt: w(q.d) }; };
  const note = (name: string, key: StatKey, from: string, to: string) => { const q = posterior(p, key); k.evidence.push(`${name}: ${to} (was ${from}) from ${q.n} of ${q.d} observed, estimate ${(100 * q.mean).toFixed(0)}%`); };

  // Raising facing a bet: pooled over streets.
  const rk: StatKey[] = ['raiseVsBetFlop', 'raiseVsBetTurn', 'raiseVsBetRiver'];
  let rn = 0, rd = 0, rp = 0;
  for (const key of rk) { const c = p.stats[key]; rn += c.n; rd += c.d; rp += PRIORS[key].mean * PRIORS[key].k; }
  if (rd > 0) {
    const priorMean = rp / rk.reduce((a, key) => a + PRIORS[key].k, 0), kk = 12;
    const mean = (priorMean * kk + rn) / (kk + rd);
    const mult = clamp(1 + w(rd) * (mean / priorMean - 1), 0.3, 3);
    if (Math.abs(mult - 1) > 0.05) k.evidence.push(`raises facing a bet x${mult.toFixed(2)} from ${rn} raises in ${rd} spots`);
    k.raiseMult = mult;
  }
  const fcr = stat('foldToCheckRaise');
  if (fcr.q.d > 0) {
    const shift = clamp(MODEL3.checkRaiseShift + fcr.wt * (fcr.q.mean - fcr.prior) * 0.8, -0.2, 0.3);
    if (Math.abs(shift - MODEL3.checkRaiseShift) > 0.01) note('extra folding to a check-raise', 'foldToCheckRaise', MODEL3.checkRaiseShift.toFixed(2), shift.toFixed(2));
    k.checkRaiseShift = shift;
  }
  const fvr = stat('foldVsRaise');
  if (fvr.q.d > 0) {
    const shift = clamp(MODEL3.raisedShift + fvr.wt * (fvr.q.mean - fvr.prior) * 0.8, -0.2, 0.3);
    if (Math.abs(shift - MODEL3.raisedShift) > 0.01) note('extra folding when raised', 'foldVsRaise', MODEL3.raisedShift.toFixed(2), shift.toFixed(2));
    k.raisedShift = shift;
  }
  const barrel = stat('cbetTurn');
  if (barrel.q.d > 0) {
    k.barrelMult = clamp(1 + barrel.wt * (barrel.q.mean / barrel.prior - 1), 0.4, 2);
    if (Math.abs(k.barrelMult - 1) > 0.05) k.evidence.push(`turn barrel x${k.barrelMult.toFixed(2)} from ${barrel.q.n} of ${barrel.q.d}`);
  }
  const rb = stat('betWhenCheckedToRiver');
  if (rb.q.d > 0) {
    k.riverBetMult = clamp(1 + rb.wt * (rb.q.mean / rb.prior - 1), 0.4, 2);
    if (Math.abs(k.riverBetMult - 1) > 0.05) k.evidence.push(`river betting x${k.riverBetMult.toFixed(2)} from ${rb.q.n} of ${rb.q.d}`);
  }
  // Bet sizes: share of postflop bets at 70% of the pot or more, Beta(prior * 10) shrinkage.
  const large = p.betSizes[2] + p.betSizes[3], all = p.betSizes.reduce((a, b) => a + b, 0);
  if (all > 0) {
    const ls = clamp((MODEL3.largeShare * 10 + large) / (10 + all), 0.1, 0.9);
    const shift = MODEL3.largeShare + exploitWeight * (ls - MODEL3.largeShare);
    if (Math.abs(shift - MODEL3.largeShare) > 0.05) k.evidence.push(`bets large ${(100 * shift).toFixed(0)}% of the time from ${large} of ${all} sized bets`);
    k.largeShare = shift;
  }
  return k;
}

/** Where in a betting sequence the opponent acts. */
export interface Ctx3 {
  street: Street;
  /** Facing: the bet to call as a fraction of the pot before it. */
  betFrac: number;
  /** Bets and raises already made on this street (1 = facing a bet, 2 = facing a raise, ...). */
  level: number;
  /** The bet faced is a raise by a player who checked earlier on this street. */
  checkRaised: boolean;
  /** The player faces a raise of its own bet or raise. */
  ownRaised: boolean;
  /** May bet first: who holds the lead. */
  role: BetRole;
  /** The opponent can raise at all (legal, chips behind). */
  canRaise: boolean;
}

export interface Resp { fold: number; call: number; raise: number }

/** Response of a holding of strength s facing a bet or raise. Sums to 1; raise is 0 when raising is impossible. */
export function respond3(s: number, c: Ctx3, k: Knobs): Resp {
  let shift = 0;
  if (c.checkRaised) shift += k.checkRaiseShift;
  else if (c.ownRaised) shift += k.raisedShift;
  if (c.level >= 3) shift += MODEL3.reraiseShift;
  const tend = { ...k.tend, stickiness: k.tend.stickiness - shift / RANGE_MODEL.stickinessShift };
  const r = responseProbs2(s, { street: c.street, betFrac: c.betFrac, opponents: 1, isRaise: c.level >= 2, tend });
  if (!c.canRaise) return { fold: r.fold, call: r.call + r.raise, raise: 0 };
  const mult = k.raiseMult * (c.level >= 3 ? MODEL3.thirdRaiseMult : c.level >= 2 ? MODEL3.reraiseMult : 1);
  const raise = clamp(r.raise * mult, 0, r.raise + r.call);
  return { fold: r.fold, call: r.call + r.raise - raise, raise };
}

export interface BetDist { check: number; small: number; large: number }

/** First action of a holding that may bet: check, or bet with the smaller or the larger size. */
export function bet3(s: number, c: Pick<Ctx3, 'street' | 'role'> & { lateStreet: boolean }, k: Knobs): BetDist {
  let p = betProb2(s, { street: c.street, betFrac: 0.6, opponents: 1, isRaise: false, tend: k.tend, role: c.role });
  if (c.role === 'aggressor' && c.lateStreet) p *= k.barrelMult;
  if (c.street === 'river') p *= k.riverBetMult;
  p = clamp(p, 0.01, 0.97);
  // Size: strong hands and the weakest (bluffs) use the larger size somewhat more often; middling hands bet small.
  const tilt = s > 0.85 ? 0.15 : s < 0.3 ? 0.1 : s < 0.75 ? -0.1 : 0;
  const pl = clamp(k.largeShare + tilt, 0.05, 0.95);
  return { check: 1 - p, small: p * (1 - pl), large: p * pl };
}
