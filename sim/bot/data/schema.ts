// ============================================================
// Common schema for external poker data (Phase 2.2, docs/bot/POKER_DATA_TRAINING_ROADMAP.md).
//
// Three kinds of material go through the same shape so that one validator, one replay and one provenance
// record cover all of them:
//   - solver-labelled decisions (PokerBench): a spot and the action a solver preferred there;
//   - hand histories of people or of other programs (PHH files, own PokerNow logs): what was done, nothing more;
//   - synthetic records written for tests.
//
// What a label MEANS is part of the schema, not left to the reader. A human or bot action is recorded as
// `human-action` / `program-action` and can never be used as a strategy target by this code
// (`usableAsStrategyTarget`). It can be used to measure how often players do things.
//
// Offline tooling: nothing here is imported by the extension.
// ============================================================

/** Where records came from and under what terms. One per imported source; every record points to it by id. */
export interface SourceInfo {
  /** Short stable id, e.g. "pokerbench-postflop-test". Lower case, digits, dashes. */
  id: string;
  name: string;
  kind: 'solver-labels' | 'human-hands' | 'program-hands' | 'own-logs' | 'synthetic';
  /** Where it was obtained (URL, or "local" for own logs and synthetic data). */
  origin: string;
  /** Licence as stated by the publisher, verbatim or by SPDX id. Required. */
  licence: string;
  /** Anything that qualifies the licence or the right to use the data (third-party scraping, commercial origin of labels, ...). */
  licenceNotes: string;
  /**
   * 'unrestricted': the user may use and keep it locally without further decision (own logs, synthetic).
   * 'needs-approval': the user must have approved this source explicitly; `approvedBy` and `approvedOn` are then required.
   */
  access: 'unrestricted' | 'needs-approval';
  approvedBy?: string;
  /** ISO date. */
  approvedOn?: string;
  /** ISO date the files were obtained. */
  retrieved: string;
  /** Who the players are and what game, in plain words (e.g. "2009 online cash, 25NL-1000NL, mixed table sizes"). */
  population: string;
  /** What a record's action stands for. */
  labelSemantics: 'solver-dominant-action' | 'human-action' | 'program-action' | 'none';
  /** Known limits that every user of the data must see (class balancing, showdown-only cards, ...). */
  caveats: string[];
  files: { path: string; sha256: string; bytes: number }[];
}

export type DataActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise';
export interface DataAction { seat: number; kind: DataActionKind; /** Street commitment after a bet or raise, in chips. */ to?: number }

/** One complete hand in a source-neutral form. Seats are 0..n-1 in table order. Chips in the source's own units. */
export interface HandHistory {
  source: string;
  handId: string;
  seats: { seat: number; name: string | null; stack: number }[];
  buttonSeat: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  /** Hole cards per seat, null when not known (never guessed). */
  holes: ([string, string] | null)[];
  /** Board cards in the order dealt, 0 to 5. */
  board: string[];
  /** Voluntary actions only, in order; blinds and antes follow from the fields above. */
  actions: DataAction[];
  /** Free-form facts kept from the source (stake name, date, site), never used for decisions. */
  meta: Record<string, string | number>;
}

/** One decision with the action that was taken or preferred there. */
export interface DecisionExample {
  source: string;
  id: string;
  street: 'preflop' | 'flop' | 'turn' | 'river';
  heroCards: [string, string];
  board: string[];
  /** Pot in the source's units, including chips already bet on this street when the source defines it so. */
  pot: number;
  /** Relative position after the flop when that is all the source gives; table position otherwise. */
  position: string;
  legal: { kind: DataActionKind; amount?: number }[];
  label: { kind: DataActionKind; amount?: number };
  /** Copied from the source so that nobody has to look it up to know what the label is. */
  labelSemantics: SourceInfo['labelSemantics'];
  /**
   * 'full': a complete action history is attached and replays through the rules engine.
   * 'partial': only what is listed here is known; the hand cannot be rebuilt from this record alone.
   */
  reconstruction: 'full' | 'partial';
  history?: HandHistory;
  /** Source fields kept verbatim for later, stricter parsing (e.g. the preflop action string). */
  raw: Record<string, string>;
}

/** Only a solver's preferred action may ever be treated as a target for what to do. */
export function usableAsStrategyTarget(s: Pick<SourceInfo, 'labelSemantics'>): boolean {
  return s.labelSemantics === 'solver-dominant-action';
}
/** Actions of people and programs are evidence of how players behave, which is what opponent calibration needs. */
export function usableForBehaviourFrequencies(s: Pick<SourceInfo, 'labelSemantics' | 'kind'>): boolean {
  return s.labelSemantics === 'human-action' || s.labelSemantics === 'program-action';
}

export interface Issue { level: 'error' | 'warning'; where: string; message: string }
export const errorsOf = (xs: readonly Issue[]) => xs.filter((x) => x.level === 'error');
