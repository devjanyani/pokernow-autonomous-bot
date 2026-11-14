// ============================================================
// Strategy library: versioned, local, explicit strategy data.
//
// A PACK is one self-contained set of strategy data with its source and the
// assumptions it was produced under. The engine only ever reads packs that are
// bundled with the extension at build time; nothing is fetched at runtime.
//
// Three kinds of content can live in a pack:
//   spots       preflop decision tables: per starting hand (169 classes, with
//               optional per-combo overrides) the frequency of each action
//   references  postflop reference decisions for the scenario suite (a spot
//               description plus the action frequencies a solver gave for it)
//   principles  structured postflop notes with a source, shown in the docs and
//               checked by tests; they carry no numbers the engine acts on
//
// Every pack states HOW its numbers were obtained (`source.kind`):
//   'solver'      output of a solver run the pack author is entitled to use
//   'chart'       transcribed from a published chart
//   'calculated'  computed by this repository's own code
//   'heuristic'   hand-set
// and whether that claim has been verified by the person importing it.
// ============================================================

export const PACK_FORMAT = 'poker-bot-strategy-pack';
export const PACK_VERSION = 1;

export type Provenance = 'solver' | 'chart' | 'calculated' | 'heuristic';

export interface PackSource {
  kind: Provenance;
  /** Solver or publication name, e.g. "PioSOLVER 3", "GTO Wizard export". */
  tool?: string;
  author?: string;
  /** Licence or permission under which the data may be used here. Required for 'solver' and 'chart'. */
  license?: string;
  url?: string;
  /** Date the data was produced or obtained (ISO). */
  obtained?: string;
  notes?: string;
  /** True only when the importer has checked the data against its source. */
  verified: boolean;
}

export interface PackAssumptions {
  format: 'cash' | 'tournament';
  /** Players dealt in. */
  players: number;
  /** Effective stack range in big blinds the data was produced for. */
  stackBB: [number, number];
  /** Ante per player in big blinds (0 = none). */
  anteBB?: number;
  rake?: string;
  /** Standard open size in big blinds the tree assumed. */
  openSizeBB?: number;
  notes?: string;
}

export type MixAction = 'fold' | 'call' | 'raise' | 'allin';
/** Frequencies in 0..1. They may sum to less than 1: the remainder is a fold. */
export type HandMix = Partial<Record<MixAction, number>>;

export type PreflopScenario =
  | 'rfi'           // first in: nobody has entered the pot
  | 'vs-limp'       // one or more limpers, no raise: isolate / over-limp / fold
  | 'bb-vs-limp'    // big blind with a free option after limpers
  | 'vs-open'       // one raise, no caller in between: fold / call / 3-bet
  | 'vs-open-call'  // one raise and at least one caller: fold / overcall / squeeze
  | 'vs-3bet'       // Hero opened and was 3-bet
  | 'vs-squeeze'    // Hero opened or called and faces a 3-bet with callers in between
  | 'vs-4bet'       // Hero 3-bet and was 4-bet
  | 'cold-4bet'     // Hero has not acted and faces a raise and a 3-bet
  | 'push-fold';    // short stack: all-in or fold

export const SCENARIOS: readonly PreflopScenario[] = ['rfi', 'vs-limp', 'bb-vs-limp', 'vs-open', 'vs-open-call', 'vs-3bet', 'vs-squeeze', 'vs-4bet', 'cold-4bet', 'push-fold'];

export interface PreflopSpot {
  /** Unique within the pack. */
  id: string;
  scenario: PreflopScenario;
  /** Hero's position, one of the pack's `positions`. */
  hero: string;
  /** The opener (vs-open, vs-open-call), the 3-bettor (vs-3bet, vs-squeeze), the 4-bettor (vs-4bet). */
  villain?: string;
  /** Number of callers between the raise and Hero (vs-open-call, vs-squeeze). Omitted = any. */
  callers?: number;
  /** Number of limpers (vs-limp, bb-vs-limp). Omitted = any. */
  limpers?: number;
  /** Overrides the pack's stack range for this spot. */
  stackBB?: [number, number];
  /** Raise size the frequencies assume: an absolute size in big blinds or a multiple of the bet faced. */
  sizing?: { raiseToBB?: number; raiseMult?: number };
  /** Keys are hand classes ("AKs", "77", "T9o") or exact combos ("AhKh"). Absent hands fold. */
  hands: Record<string, HandMix>;
  notes?: string;
}

/** A postflop reference decision for the scenario suite. */
export interface PostflopReference {
  /** Matches a scenario id in sim/bot/scenarios.ts. */
  scenario: string;
  /** Action label -> frequency (labels: check, fold, call, bet-small, bet-medium, bet-large, bet-overbet, raise). */
  frequencies: Record<string, number>;
  /** Solver settings that matter for the comparison (ranges, sizes, rake). */
  setup: string;
}

export interface Principle {
  id: string;
  topic: string;
  statement: string;
  /** Where the engine implements or tests it, e.g. a file or a test name. */
  appliedIn?: string;
  source: string;
}

export interface StrategyPack {
  format: typeof PACK_FORMAT;
  version: typeof PACK_VERSION;
  id: string;
  name: string;
  /** Pack revision chosen by its author. */
  revision: string;
  source: PackSource;
  assumptions: PackAssumptions;
  /** Position names in preflop action order, first to act first, blinds last. Length = assumptions.players. */
  positions: string[];
  spots: PreflopSpot[];
  references?: PostflopReference[];
  principles?: Principle[];
}

export interface PackIssue { level: 'error' | 'warning'; where: string; message: string }
