// ============================================================
// Site-neutral observation of a poker table: exactly what a player can see.
// The PokerNow DOM adapter (pokernow/dom.ts) produces these; the tracker
// (tracker.ts) consumes them. Nothing here knows about the DOM, so an
// interface change only touches the adapter.
// ============================================================

import type { CardId } from '../cards';

export interface SeatObs {
  /** Physical seat number as shown by the site (stable within a session). */
  seat: number;
  name: string;
  /** Site-provided stable player id when available; otherwise null. */
  playerId: string | null;
  /** Chips behind, or null when it could not be read. */
  stack: number | null;
  /** Chips in front of the player on the current street (0 when none). */
  bet: number;
  folded: boolean;
  sittingOut: boolean;
  isHero: boolean;
  /** Face-down or face-up hole cards are rendered for this seat. */
  hasCards: boolean;
  /** Cards shown at showdown (opponents) when visible. */
  shownCards: CardId[] | null;
  /** Marked offline / away by the site. Says nothing about whether the player was dealt in. */
  disconnected?: boolean;
  /** Raw class list of the seat element (diagnostics only: shows how the site marks fold, away ...). */
  cls?: string;
}

export interface ControlsObs {
  fold: boolean;
  check: boolean;
  /** Call amount shown on the call button, or null when there is no call button. */
  call: number | null;
  /** A bet / raise control is available. */
  raise: boolean;
  /** Bounds shown by the bet input, when readable. */
  minRaiseTo: number | null;
  maxRaiseTo: number | null;
}

export interface TableObs {
  /** Monotonic timestamp of the read (ms). */
  ts: number;
  tableId: string;
  /** Game type text as displayed (e.g. "NLH", "PLO"), or null if not found. */
  gameType: string | null;
  /** Hand number / id as displayed, or null. */
  handLabel: string | null;
  seats: SeatObs[];
  dealerSeat: number | null;
  board: CardId[];
  heroCards: [CardId, CardId] | null;
  /** Total pot as displayed (all chips in the middle plus current bets), or null. */
  pot: number | null;
  smallBlind: number | null;
  bigBlind: number | null;
  ante: number | null;
  /** Seat currently highlighted as the one to act, or null when unknown. */
  toActSeat: number | null;
  heroToAct: boolean;
  controls: ControlsObs;
  /** Milliseconds left on Hero's action clock, or null when unknown. */
  timeRemainingMs: number | null;
  /** Problems found while reading (unparseable card, missing element ...). */
  problems: string[];
  /** Raw visible texts kept for diagnostics only (never used for decisions). */
  raw?: { buttons: string[]; signal: string | null; pot: string | null; timer: string | null };
}

export function emptyControls(): ControlsObs {
  return { fold: false, check: false, call: null, raise: false, minRaiseTo: null, maxRaiseTo: null };
}
