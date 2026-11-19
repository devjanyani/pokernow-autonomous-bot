import type { ActionKind, Street, TableCounts } from '../table/engine';
import type { SpotInfo } from './spot';

/** How a number or choice was obtained. Shown in every decision explanation. */
export type Basis =
  | 'precomputed-chart'   // published / solved chart shipped in the repo
  | 'computed'            // calculated at decision time (Monte Carlo, arithmetic)
  | 'learned'             // from this opponent's observed statistics
  | 'heuristic';          // hand-set approximation

export interface Candidate {
  action: ActionKind;
  /** Street commitment after the action, for bet/raise. */
  to?: number;
  label: string;
  /** Estimated EV in chips relative to folding now (null when not estimated, e.g. chart frequencies). */
  ev: number | null;
  /** Standard error of the EV estimate (Monte Carlo noise only, not model error). */
  evSe: number | null;
  /** Probability the mixed strategy plays this candidate. */
  freq: number;
  /**
   * Bets and raises of the version 2 postflop engine only. `ev` is the lower of these two:
   * the EV under the modelled opponent responses, and the EV against opponents who fold less than modelled.
   * Their difference is sensitivity to the opponent model, which `evSe` (sampling noise) does not measure.
   */
  evModel?: number;
  evPessimistic?: number;
}

export interface EquitySummary { equity: number; win: number; tie: number; stdErr: number; samples: number; opponents: number }

export interface RangeNote { seat: number; name: string; line: string; summary: string; basis: Basis; /** Pack and spot (or rule) the preflop range came from. */ source?: string }

export interface Decision {
  action: ActionKind;
  to?: number;
  label: string;
  street: Street;
  candidates: Candidate[];
  equity: EquitySummary | null;
  ranges: RangeNote[];
  /** Opponent-specific adjustments that influenced the decision. */
  adjustments: string[];
  /** Where the strategy came from, e.g. "precomputed-chart: Greenline CO-vs-open-UTG". */
  basis: string[];
  /** Plain statement of how sure the engine is (close EVs, Monte Carlo noise, weak reads). */
  uncertainty: string;
  /** EV gap between the two best candidates and its standard error, when computed. */
  evGap: number | null;
  evGapSe: number | null;
  counts: TableCounts;
  /** 'heads-up-table' | 'heads-up-pot' | 'multiway' : which strategy branch was used. */
  mode: 'heads-up-table' | 'heads-up-pot' | 'multiway';
  samples: number;
  computeMs: number;
  /** True when a refinement pass could still change the answer. */
  provisional: boolean;
  /** Who raised before the flop, who holds the betting lead, Hero's position, bet type (version 2 engine). */
  spot?: SpotInfo;
  /** 'lower' when the decision is out-of-distribution or rests mainly on the heuristic fold model. */
  confidence?: 'normal' | 'lower';
  engine?: 'v2' | 'v3';
  /** Which engine was asked for, which one decided, and why they differ (set by BotAgent for every decision). */
  strategy?: StrategyNote;
}

export type EngineName = 'v1' | 'v2' | 'v3';
export type CalibrationUse = 'applied' | 'not applicable' | 'unavailable';
export interface StrategyNote {
  requested: EngineName;
  used: EngineName;
  /** Why the requested engine did not decide this spot (null when it did). */
  fallback: string | null;
  /** Version 3 decisions only: the opponent-response model and the fitted tables, with the reason when one was not used. */
  opponentModel?: string;
  calibration?: { population: CalibrationUse; river: CalibrationUse; notes: string[] };
}
