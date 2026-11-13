// ============================================================
// Decision-time controller.
//
// Turns "how much does this decision matter and how much time is left" into a
// computation budget for the anytime EV engine:
//
//   softMs      stop here if the best action is already clearly separated
//   hardMs      never compute past this (always leaves a safety margin before
//               the table's action clock)
//   minSamples  floor before any decision is trusted
//   maxSamples  ceiling (keeps memory/CPU bounded even with no clock)
//
// Refinement between softMs and hardMs continues only while more samples can
// still change the choice (see shouldStop): a large pot alone does not buy
// more time, an unresolved close decision in a pot that matters does.
// ============================================================

import type { Street } from '../table/engine';

export interface BudgetInput {
  /** Milliseconds left on the action clock, or null when unknown. */
  timeRemainingMs: number | null;
  street: Street;
  /** Pot and effective stack in big blinds. */
  potBB: number;
  effStackBB: number;
  opponents: number;
  candidates: number;
  /** 0..1 trust in the observed state; low trust shortens the budget (the caller will pause instead of acting). */
  stateConfidence: number;
  /** Optional extra think time requested by settings (bounded timing variation), ms. */
  jitterMs?: number;
}

export interface Budget { softMs: number; hardMs: number; minSamples: number; maxSamples: number; batch: number; importance: number }

/** Time always left unused before the action clock expires (click + network). */
export const SAFETY_MARGIN_MS = 2500;
const DEFAULT_CLOCK_MS = 12000;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function planBudget(i: BudgetInput): Budget {
  const clock = i.timeRemainingMs ?? DEFAULT_CLOCK_MS;
  const usable = Math.max(0, clock - SAFETY_MARGIN_MS);
  // Importance: chips at risk relative to a 100bb stack, saturating.
  const atRisk = Math.min(i.effStackBB, i.potBB * 2 + 2);
  const stakes = clamp(Math.log2(1 + atRisk) / Math.log2(101), 0.05, 1);
  const branching = clamp((i.candidates - 2) / 5, 0, 1);
  const multiway = clamp((i.opponents - 1) / 4, 0, 1);
  const streetW = i.street === 'preflop' ? 0.15 : i.street === 'flop' ? 1 : i.street === 'turn' ? 0.9 : 0.7;
  const importance = clamp(streetW * (0.45 * stakes + 0.3 * branching + 0.25 * multiway) * (0.5 + 0.5 * i.stateConfidence), 0.02, 1);

  const soft = Math.min(60 + 900 * importance, 0.35 * usable);
  const hard = Math.min(250 + 3200 * importance + (i.jitterMs ?? 0), usable);
  return {
    softMs: Math.max(0, Math.min(soft, hard)),
    hardMs: Math.max(0, hard),
    minSamples: i.street === 'preflop' ? 0 : 300,
    maxSamples: Math.round(4000 + 36000 * importance),
    batch: i.opponents >= 4 ? 150 : 250,
    importance,
  };
}

export interface Progress { elapsedMs: number; samples: number; separated: boolean; evGap: number | null; evGapSe: number | null; potChips: number }

/** Anytime stopping rule. */
export function shouldStop(b: Budget, p: Progress): { stop: boolean; reason: string } {
  if (p.samples >= b.maxSamples) return { stop: true, reason: 'sample ceiling' };
  if (p.elapsedMs >= b.hardMs && p.samples >= Math.min(b.minSamples, 100)) return { stop: true, reason: 'hard deadline' };
  if (p.samples < b.minSamples) return { stop: false, reason: 'below minimum samples' };
  if (p.separated) return { stop: true, reason: 'best action clearly separated' };
  // The remaining disagreement is worth less than 0.4% of the pot: more samples cannot matter.
  if (p.evGap !== null && p.evGapSe !== null && p.evGap + 2 * p.evGapSe < 0.004 * p.potChips) return { stop: true, reason: 'candidates practically tied' };
  if (p.elapsedMs >= b.softMs && p.evGapSe !== null && p.evGapSe < 0.003 * p.potChips) return { stop: true, reason: 'estimate precise enough' };
  if (p.elapsedMs >= b.hardMs) return { stop: true, reason: 'hard deadline' };
  return { stop: false, reason: 'refining' };
}
