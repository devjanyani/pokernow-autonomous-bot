// ============================================================
// Game-state reconstruction from successive table observations.
//
// The tracker keeps ONE rules-engine hand (table/engine.ts) and explains each
// new observation as zero or more legal actions applied to it. Every action
// carries the evidence it came from (EventMeta.source):
//
//   bet-display       the seat's chips in front grew           -> call / bet / raise
//   fold-display      the seat is drawn as folded              -> fold
//   cards-removed     the seat's cards disappeared mid-hand    -> fold
//   turn-passed       the action moved past the seat with no chips added:
//                       a check when checking was free,
//                       a FOLD when the seat faced a bet (the only zero-chip option),
//                       confirmed by an unchanged stack
//   stack-change      the next street is out and the stack fell by exactly the call
//   street-advanced   the next street is out and the seat's stack is unchanged
//   showdown-evidence opponents' cards are face up on the river
//   hand-ended        the next hand began before the last action was seen
//
// Two views of "whose turn" are kept apart and compared on every observation:
//   observed actor   what the page shows (highlighted seat, Hero's turn signal + buttons)
//   predicted actor  what the rules engine expects after the reconstructed history
//
// Nothing is invented to make them agree. Deductions are applied only when the
// rules leave one explanation, they are marked as inferred, and they are rolled
// back if the result contradicts the observed actor or Hero's visible buttons.
// What cannot be explained becomes a blocker ("reconciliation required") that
// suspends decisions and is recorded for the debug bundle.
// ============================================================

import { CardId, cardsAreDistinct } from '../cards';
import { evaluateHand } from '../../core/equity/hand-eval';
import {
  ActionInput, applyAction, awaitingBoard, cloneHand, completeHand, createHand, dealBoard, HandState, LegalActions, legalActions, potTotal, seatOf,
} from '../table/engine';
import { SeatObs, TableObs } from './observation';

export type EventSource =
  | 'forced-post' | 'bet-display' | 'fold-display' | 'cards-removed' | 'turn-passed'
  | 'stack-change' | 'street-advanced' | 'showdown-evidence' | 'hand-ended';

/** Evidence for one engine event; `meta[i]` describes `hand.events[i]`. */
export interface EventMeta {
  seq: number;
  /** Observation timestamp at which the event was applied. */
  ts: number;
  source: EventSource;
  /** True when the action was deduced rather than displayed. */
  inferred: boolean;
  /** True when the deduction could not be confirmed (for example the seat was no longer visible). */
  uncertain: boolean;
  note: string | null;
  stackAfter: number;
  streetCommit: number;
  totalCommit: number;
}

export type DiscrepancyKind = 'turn' | 'legal' | 'stack' | 'bet' | 'pot' | 'cards' | 'chips' | 'reconcile' | 'read';
export interface Discrepancy { ts: number; kind: DiscrepancyKind; message: string; street: string; eventCount: number; blocking: boolean }

export type HeroStatus =
  | 'no-hand' | 'not-dealt-in' | 'folded' | 'all-in' | 'to-act' | 'waiting-for-opponent' | 'awaiting-board' | 'showdown' | 'hand-over';

/** Independent facts about one seat. Physical presence, dealing, betting and pot eligibility are separate. */
export interface SeatParticipation {
  seat: number;
  name: string;
  playerId: string | null;
  isHero: boolean;
  /** Visible at the table in the latest observation. */
  present: boolean;
  /** Was part of this hand's seat map but is no longer visible. Its last known state is kept. */
  left: boolean;
  disconnected: boolean;
  sittingOut: boolean;
  dealtIn: boolean;
  /** Seated (and not sitting out) but not dealt into this hand. */
  waitingForNextHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** Still contests the pot (all-in players included). */
  eligibleForPot: boolean;
  /** Can still make betting decisions this hand. */
  canAct: boolean;
  position: string | null;
  stack: number | null;
  streetCommit: number;
  totalCommit: number;
}

export interface TrackerState {
  hand: HandState | null;
  heroSeat: number | null;
  heroCards: [CardId, CardId] | null;
  /** HEURISTIC score in 0..1 (not a probability): 0 unusable, 0.3 blocked, 1 no open issue, minus 0.15 per warning. */
  confidence: number;
  /** False once the rules could not explain an observation; stays false for the hand. */
  valid: boolean;
  /** True when the table is not No-Limit Hold'em (or could not be confirmed as such). */
  unsupported: boolean;
  issues: string[];
  /** Why no hand is being tracked, when hand is null. */
  waitingReason: string | null;
  /** Number of engine events: changes whenever the state advances (state version). */
  eventCount: number;
  handsSeen: number;
  /** 'waiting' | 'initialising' | engine phase. */
  phase: string;
  observedActor: number | null;
  predictedActor: number | null;
  turnStatus: 'agree' | 'disagree' | 'unobserved' | 'none';
  /** Reasons the state must be reconciled before a decision; empty when usable. */
  blockers: string[];
  warnings: string[];
  consistency: 'none' | 'consistent' | 'warnings' | 'reconciliation-required' | 'invalid';
  /** The latest observation has been unchanged for the settle time. */
  settled: boolean;
  discrepancies: Discrepancy[];
  heroStatus: HeroStatus;
  /** Hero's legal actions per the engine, compared with the visible buttons. */
  legal: { status: 'match' | 'mismatch' | 'unverified' | 'n/a'; detail: string | null; actions: LegalActions | null };
  participation: SeatParticipation[];
  meta: EventMeta[];
}

export interface CompletedHand {
  hand: HandState;
  heroSeat: number | null;
  heroCards: [CardId, CardId] | null;
  reveals: Map<number, [CardId, CardId]>;
  /** True when the final actions were observed (not inferred at the next hand's start). */
  observedToEnd: boolean;
  valid: boolean;
  /** Evidence per event (absent for hands replayed from a text log). */
  meta?: EventMeta[];
}

const HOLDEM_RE = /hold'?em|nlh|no[\s-]*limit/i;
const NOT_HOLDEM_RE = /omaha|plo|stud|razz|draw|short\s*deck|6\+/i;
/**
 * Player identity. A site-provided id is used as is. Without one the display name is
 * scoped to the table (the same name at another table is a different profile), and two
 * seats sharing a name get throw-away ids that are never persisted.
 */
const idOf = (o: SeatObs, ambiguous: Set<string>, tableId: string): string =>
  o.playerId ? o.playerId : ambiguous.has(o.name) ? `ambiguous:${o.name}:${o.seat}` : `name:${tableId}:${o.name}`;

/** Everything in an observation that matters for reconstruction (no clock, no timestamps). */
export function obsSignature(o: TableObs): string {
  const seats = o.seats.map((s) => `${s.seat}:${s.stack}:${s.bet}:${s.folded ? 'f' : ''}${s.hasCards ? 'c' : ''}${s.sittingOut ? 's' : ''}${s.disconnected ? 'd' : ''}${s.shownCards ? s.shownCards.join('.') : ''}`).join('|');
  const c = o.controls;
  return `${o.dealerSeat}/${o.board.join('.')}/${o.heroCards?.join('.') ?? ''}/${o.pot}/${o.toActSeat}/${o.heroToAct ? 1 : 0}/${c.fold ? 1 : 0}${c.check ? 1 : 0}${c.call}${c.raise ? 1 : 0}/${seats}`;
}

export class HandTracker {
  private h: HandState | null = null;
  private heroSeat: number | null = null;
  private heroCards: [CardId, CardId] | null = null;
  private valid = true;
  private unsupported = false;
  private issues: string[] = [];
  private waitingReason: string | null = 'waiting for a hand to start';
  private emitted = false;
  private reveals = new Map<number, [CardId, CardId]>();
  private handsSeen = 0;
  private stuckSince: number | null = null;
  private lastDealer: number | null = null;
  /** The action is consistent with the table but a step was probably missed (hand not used for profiles). */
  private uncertain = false;
  private meta: EventMeta[] = [];
  private blockers: string[] = [];
  private warnings: string[] = [];
  private discrepancies: Discrepancy[] = [];
  private sawCards = new Set<number>();
  private lastObs: TableObs | null = null;
  private sig = '';
  private sigSince = 0;
  private settled = false;
  private initSince: number | null = null;
  private initialising = false;
  private inferredThisSync = 0;
  private legal: TrackerState['legal'] = { status: 'n/a', detail: null, actions: null };

  /**
   * @param stuckMs    how long "chips moved but no bet is shown" may persist before it becomes a blocker
   * @param tolerance  chip comparison tolerance
   * @param settleMs   how long an observation must stay unchanged before deductions and mismatches count
   * @param initMs     how long a new hand may wait for the blind bets to appear where the button implies
   */
  constructor(private readonly stuckMs = 4000, private readonly tolerance = 0.011, private readonly settleMs = 120, private readonly initMs = 1200) {}

  get state(): TrackerState {
    const h = this.h;
    const usable = !!h && this.valid && !this.unsupported;
    const confidence = usable ? (this.blockers.length ? 0.3 : Math.max(0.4, 1 - 0.15 * this.warnings.length)) : 0;
    const observedActor = this.lastObs && h ? this.observedActor(this.lastObs) : null;
    const predictedActor = h ? h.toAct : null;
    return {
      hand: h, heroSeat: this.heroSeat, heroCards: this.heroCards, confidence, valid: this.valid && !this.unsupported,
      unsupported: this.unsupported, issues: this.issues.slice(-12), waitingReason: h ? null : this.waitingReason,
      eventCount: h?.events.length ?? 0, handsSeen: this.handsSeen,
      phase: h ? h.phase : this.initialising ? 'initialising' : 'waiting',
      observedActor, predictedActor,
      turnStatus: !h || h.phase === 'complete' ? 'none' : observedActor === null ? (predictedActor === null ? 'none' : 'unobserved') : observedActor === predictedActor ? 'agree' : 'disagree',
      blockers: this.blockers.slice(), warnings: this.warnings.slice(),
      consistency: !h ? 'none' : !usable ? 'invalid' : this.blockers.length ? 'reconciliation-required' : this.warnings.length ? 'warnings' : 'consistent',
      settled: this.settled, discrepancies: this.discrepancies.slice(), heroStatus: this.heroStatus(),
      legal: this.legal, participation: this.participation(), meta: this.meta.slice(),
    };
  }

  private note(msg: string): void { if (this.issues[this.issues.length - 1] !== msg) this.issues.push(msg); }
  private invalidate(msg: string): void { this.valid = false; this.note(`INVALID: ${msg}`); }

  private flag(kind: DiscrepancyKind, message: string, blocking: boolean, ts: number): void {
    (blocking ? this.blockers : this.warnings).push(message);
    this.note(message);
    if (this.discrepancies.some((d) => d.kind === kind && d.message === message)) return;
    if (this.discrepancies.length >= 60) this.discrepancies.shift();
    this.discrepancies.push({ ts, kind, message, street: this.h?.street ?? '', eventCount: this.h?.events.length ?? 0, blocking });
  }

  /** The seat the PAGE shows as acting, or null when it shows none (or its two indicators disagree). */
  private observedActor(obs: TableObs): number | null {
    const hero = this.heroSeat ?? obs.seats.find((s) => s.isHero)?.seat ?? null;
    if (obs.heroToAct && hero !== null) return obs.toActSeat !== null && obs.toActSeat !== hero ? null : hero;
    return obs.toActSeat;
  }

  private heroStatus(): HeroStatus {
    const h = this.h;
    if (!h) return 'no-hand';
    if (this.heroSeat === null) return 'not-dealt-in';
    const s = h.seats.find((x) => x.seat === this.heroSeat);
    if (!s || !s.dealtIn) return 'not-dealt-in';
    if (h.phase === 'complete') return 'hand-over';
    if (s.folded) return 'folded';
    if (h.toAct === s.seat) return 'to-act';
    if (s.allIn) return 'all-in';
    if (h.phase === 'showdown') return 'showdown';
    return h.toAct === null ? 'awaiting-board' : 'waiting-for-opponent';
  }

  private participation(): SeatParticipation[] {
    const h = this.h;
    const obs = this.lastObs;
    const out = new Map<number, SeatParticipation>();
    const over = !h || h.phase === 'complete';
    for (const e of h?.seats ?? []) {
      out.set(e.seat, {
        seat: e.seat, name: e.name, playerId: e.playerId, isHero: e.seat === this.heroSeat, present: false, left: true, disconnected: false,
        sittingOut: false, dealtIn: e.dealtIn, waitingForNextHand: !e.dealtIn, folded: e.dealtIn && e.folded, allIn: e.dealtIn && e.allIn && !e.folded,
        eligibleForPot: e.dealtIn && !e.folded && !over, canAct: e.dealtIn && !e.folded && !e.allIn && !over,
        position: e.pos?.label ?? null, stack: e.stack, streetCommit: e.streetCommit, totalCommit: e.totalCommit,
      });
    }
    for (const o of obs?.seats ?? []) {
      const p = out.get(o.seat);
      if (p) {
        p.present = true; p.left = false; p.disconnected = !!o.disconnected; p.sittingOut = o.sittingOut && !p.dealtIn;
        p.waitingForNextHand = !p.dealtIn && !o.sittingOut;
      } else {
        // Sat down after the hand started (or no hand is tracked): never part of this hand.
        out.set(o.seat, {
          seat: o.seat, name: o.name, playerId: o.playerId, isHero: o.isHero, present: true, left: false, disconnected: !!o.disconnected,
          sittingOut: o.sittingOut, dealtIn: false, waitingForNextHand: !o.sittingOut, folded: false, allIn: false, eligibleForPot: false, canAct: false,
          position: null, stack: o.stack, streetCommit: 0, totalCommit: 0,
        });
      }
    }
    return [...out.values()].sort((a, b) => a.seat - b.seat);
  }

  /** Feed one observation. Returns hands that finished since the previous call. */
  ingest(obs: TableObs): CompletedHand[] {
    const done: CompletedHand[] = [];
    const sig = obsSignature(obs);
    if (sig !== this.sig) { this.sig = sig; this.sigSince = obs.ts; }
    this.settled = obs.ts - this.sigSince >= this.settleMs;
    this.lastObs = obs;
    this.blockers = []; this.warnings = [];
    this.legal = { status: 'n/a', detail: null, actions: null };
    // ---- game-type gate: never apply Hold'em logic to another variant ----
    const typeText = obs.gameType ?? '';
    const heroSeatObs = obs.seats.find((s) => s.isHero);
    const wrongCards = obs.problems.some((p) => /hero has \d+ cards/.test(p));
    if ((typeText && NOT_HOLDEM_RE.test(typeText)) || wrongCards) {
      if (!this.unsupported) this.note(`unsupported game: ${typeText || 'hero does not hold exactly two cards'}`);
      this.unsupported = true;
      this.h = null; this.waitingReason = 'unsupported game type';
      return done;
    }
    void HOLDEM_RE;
    this.unsupported = false;

    if (this.isNewHand(obs)) {
      const prev = this.finish(false);
      if (prev) done.push(prev);
      this.start(obs, heroSeatObs);
    }
    if (!this.h) return done;
    if (this.valid) {
      // Deductions are provisional: keep the confirmed state so they can be undone.
      const before = { h: cloneHand(this.h), meta: this.meta.length, uncertain: this.uncertain, issues: this.issues.length, stuck: this.stuckSince };
      this.inferredThisSync = 0;
      try { this.sync(obs); } catch (e) { this.invalidate((e as Error).message); }
      if (this.valid && this.inferredThisSync > 0) {
        const bad = this.contradiction(obs);
        if (bad) {
          this.h = before.h; this.meta.length = before.meta; this.uncertain = before.uncertain; this.issues.length = before.issues; this.stuckSince = before.stuck;
          this.flag('reconcile', bad, true, obs.ts);
        }
      }
    }
    if (this.valid) this.validate(obs);
    for (const s of obs.seats) if (s.hasCards) this.sawCards.add(s.seat);
    this.collectReveals(obs);
    if (this.h.phase === 'showdown' && this.valid) {
      const live = this.h.seats.filter((s) => s.dealtIn && !s.folded);
      if (live.every((s) => this.reveals.has(s.seat))) this.settle();
    }
    if (this.h.phase === 'complete' && !this.emitted) {
      const c = this.finish(true);
      if (c) done.push(c);
    }
    return done;
  }

  private isNewHand(obs: TableObs): boolean {
    const h = this.h;
    if (!h) return obs.board.length === 0 && obs.seats.filter((s) => s.hasCards).length >= 2;
    if (obs.heroCards && this.heroCards && (obs.heroCards[0] !== this.heroCards[0] || obs.heroCards[1] !== this.heroCards[1])
      && !(obs.heroCards[0] === this.heroCards[1] && obs.heroCards[1] === this.heroCards[0])) return true;
    if (obs.board.length < h.board.length) return true;
    if (obs.board.length === 0 && h.board.length === 0 && obs.dealerSeat !== null && this.lastDealer !== null && obs.dealerSeat !== this.lastDealer
      && obs.seats.filter((s) => s.hasCards).length >= 2) return true;
    // Hand over and the table has been cleared / re-dealt.
    if ((h.phase === 'complete' || this.emitted) && obs.board.length === 0 && obs.seats.filter((s) => s.hasCards).length >= 2
      && obs.seats.every((s) => !s.folded || !s.hasCards) && h.board.length > 0) return true;
    return false;
  }

  private pushMeta(ts: number, source: EventSource, inferred: boolean, uncertain: boolean, note: string | null): void {
    const h = this.h!;
    const ev = h.events[h.events.length - 1];
    const s = seatOf(h, ev.seat);
    this.meta.push({ seq: ev.seq, ts, source, inferred, uncertain, note, stackAfter: s.stack, streetCommit: s.streetCommit, totalCommit: s.totalCommit });
  }

  private start(obs: TableObs, heroObs: SeatObs | undefined): void {
    this.h = null; this.valid = true; this.issues = []; this.emitted = false; this.reveals = new Map();
    this.heroSeat = null; this.heroCards = null; this.stuckSince = null; this.uncertain = false;
    this.meta = []; this.discrepancies = []; this.sawCards = new Set(); this.initialising = false;
    this.lastDealer = obs.dealerSeat;
    const fail = (why: string) => { this.waitingReason = why; };
    if (obs.board.length !== 0) return fail('joined mid-hand (or the previous board is still showing): waiting for the next hand');
    if (obs.dealerSeat === null) return fail('dealer button not found');
    if (!(obs.bigBlind && obs.bigBlind > 0)) return fail('blinds not readable');
    // Dealt in = has cards or has chips in front. A "disconnected" or "away" marker does not remove a
    // player who was dealt cards; a seated player with neither cards nor chips is not in this hand.
    const present = obs.seats.filter((s) => s.hasCards || s.bet > 0 || (s.folded && !s.sittingOut));
    if (present.length < 2) return fail('fewer than two players dealt in');
    if (present.some((s) => s.stack === null)) return fail('a stack could not be read');
    const names = new Map<string, number>();
    for (const s of obs.seats) names.set(s.name, (names.get(s.name) ?? 0) + 1);
    const ambiguous = new Set([...names].filter(([, n]) => n > 1).map(([name]) => name));
    const ante = obs.ante ?? 0;
    const dealtSeats = new Set(present.map((s) => s.seat));
    let h: HandState;
    try {
      h = createHand({
        handId: `${obs.tableId}:${obs.handLabel ?? 'h'}:${this.handsSeen + 1}:${obs.ts}`,
        buttonSeat: obs.dealerSeat, smallBlind: obs.smallBlind ?? obs.bigBlind / 2, bigBlind: obs.bigBlind, ante,
        seats: [...obs.seats].sort((a, b) => a.seat - b.seat).map((s) => ({
          seat: s.seat, playerId: idOf(s, ambiguous, obs.tableId), name: s.name,
          stack: (s.stack ?? 0) + s.bet + (dealtSeats.has(s.seat) ? ante : 0), sittingOut: !dealtSeats.has(s.seat),
        })),
      });
    } catch (e) {
      return fail(`cannot start hand: ${(e as Error).message}`);
    }
    // The engine posts the blinds from the button. If the table does not (yet) show those chips in front
    // of those seats, the snapshot mixes two hands or the button was read before it moved: wait briefly.
    const missing = this.blindsMissing(h, obs);
    if (missing) {
      if (this.initSince === null) this.initSince = obs.ts;
      if (obs.ts - this.initSince < this.initMs) { this.initialising = true; return fail(`hand starting: ${missing}`); }
    }
    this.initSince = null;
    this.h = h;
    for (let i = 0; i < h.events.length; i++) {
      const ev = h.events[i]; const s = seatOf(h, ev.seat);
      this.meta.push({ seq: i, ts: obs.ts, source: 'forced-post', inferred: false, uncertain: false, note: null, stackAfter: s.startStack - h.events.slice(0, i + 1).filter((x) => x.seat === ev.seat).reduce((a, x) => a + x.amount, 0), streetCommit: ev.to, totalCommit: h.events.slice(0, i + 1).filter((x) => x.seat === ev.seat).reduce((a, x) => a + x.amount, 0) });
    }
    this.handsSeen++;
    this.waitingReason = null;
    if (heroObs && dealtSeats.has(heroObs.seat) && obs.heroCards) { this.heroSeat = heroObs.seat; this.heroCards = obs.heroCards; }
    else if (heroObs && dealtSeats.has(heroObs.seat)) this.note('hero cards not readable yet');
    // A straddle shows up as a blind-sized bet from the first seat to act that exceeds the big blind
    // before anyone could have acted; the engine cannot tell it from a raise, which is equivalent for play.
  }

  /** A blind the engine posted that the table does not show in front of that seat, described; else null. */
  private blindsMissing(h: HandState, obs: TableObs): string | null {
    for (const e of h.seats) {
      if (!e.dealtIn || e.streetCommit <= 0) continue;
      const o = obs.seats.find((s) => s.seat === e.seat);
      if (!o || o.folded || !o.hasCards) continue; // a blind that already folded may have had its chips swept
      if (o.bet < e.streetCommit - this.tolerance) return `the button on seat ${h.buttonSeat} puts a blind of ${e.streetCommit} on seat ${e.seat} (${e.name}), but the table shows ${o.bet} there`;
    }
    return null;
  }

  /** Explain the observation as legal actions. Throws when the rules cannot explain it at all. */
  private sync(obs: TableObs): void {
    const h = this.h!;
    const bySeat = new Map(obs.seats.map((s) => [s.seat, s]));
    if (!this.heroCards && obs.heroCards) {
      const heroObs = obs.seats.find((s) => s.isHero);
      if (heroObs && seatOf(h, heroObs.seat).dealtIn) { this.heroSeat = heroObs.seat; this.heroCards = obs.heroCards; }
    }
    const tol = this.tolerance;
    const actor = this.observedActor(obs);
    const apply = (a: ActionInput, source: EventSource, inferred = false, note: string | null = null, uncertain = false) => {
      applyAction(h, a);
      this.pushMeta(obs.ts, source, inferred, uncertain, note);
      this.stuckSince = null;
      if (inferred) this.inferredThisSync++;
      if (uncertain) this.uncertain = true;
      if (note) this.note(`seat ${a.seat}: ${note}`);
    };
    for (let guard = 0; guard < 80; guard++) {
      if (h.phase === 'complete' || h.phase === 'showdown') return;
      if (h.toAct !== null) {
        const seat = h.toAct;
        const e = seatOf(h, seat);
        const o = bySeat.get(seat);
        const la = legalActions(h)!;
        const sameStreet = obs.board.length === h.board.length;
        const advanced = obs.board.length > h.board.length;
        if (!sameStreet && !advanced) return; // fewer board cards than the engine: handled by isNewHand

        // 1. Chips in front grew: a call, bet or raise that is displayed.
        if (o && sameStreet && o.bet > e.streetCommit + tol) {
          if (o.bet > h.currentBet + tol) apply({ seat, kind: la.raiseKind, to: o.bet }, 'bet-display');
          else {
            if (o.bet < Math.min(h.currentBet, e.streetCommit + e.stack) - tol) throw new Error(`seat ${seat} shows ${o.bet} against a bet of ${h.currentBet}: intermediate raises were missed`);
            apply({ seat, kind: 'call' }, 'bet-display');
          }
          continue;
        }

        // 2. The seat is drawn as folded, or its cards were taken away while the hand is still being played.
        const cardsGone = !!o && seat !== this.heroSeat && this.sawCards.has(seat) && !o.hasCards && !o.shownCards && (actor !== null || advanced);
        if (o && (o.folded || cardsGone)) {
          // A folded seat whose stack is lower than expected put chips in that were never seen.
          if (o.stack !== null && o.stack < e.stack - tol) throw new Error(`seat ${seat} folded after unseen betting (stack ${o.stack}, expected ${e.stack})`);
          // Folding when a check is free almost always means a bet was made and taken back unseen.
          if (la.canCheck) { this.uncertain = true; this.note(`seat ${seat} folded with a free check available: a bet was probably missed`); }
          apply({ seat, kind: 'fold' }, o.folded ? 'fold-display' : 'cards-removed');
          continue;
        }

        if (sameStreet) {
          // Opponents' cards face up on the river: the betting is over, so this seat closed it.
          if (o && h.street === 'river' && obs.seats.some((s) => s.shownCards !== null && !s.isHero)) {
            if (la.canCheck) apply({ seat, kind: 'check' }, 'showdown-evidence', true);
            else apply({ seat, kind: o.hasCards ? 'call' : 'fold' }, 'showdown-evidence', true);
            continue;
          }
          // 3. The action has moved past this seat without chips being added.
          if (actor === null || actor === seat) return;
          const ae = h.seats.find((s) => s.seat === actor);
          if (!ae || !ae.dealtIn || ae.folded || ae.allIn) {
            // The page shows a seat acting that, by the reconstructed history, cannot act. Nothing is deduced from it.
            return;
          }
          if (!o) {
            if (!this.settled) return;
            // No longer visible. Its last known state is kept; the action passing it leaves one zero-chip option.
            apply({ seat, kind: la.canCheck ? 'check' : 'fold' }, 'turn-passed', true, `no longer visible at the table; the action passed it (${la.canCheck ? 'check' : 'fold'} assumed, unconfirmed)`, true);
            continue;
          }
          const stackSame = o.stack !== null && Math.abs(o.stack - e.stack) <= tol;
          if (la.canCheck) {
            if (o.stack !== null && o.stack < e.stack - tol) return this.stuck(obs, seat, `seat ${seat} (${e.name}) has ${e.stack - o.stack} fewer chips but shows no bet`);
            apply({ seat, kind: 'check' }, 'turn-passed');
            continue;
          }
          // Facing a bet, the only action that adds no chips is a fold. Wait for the table to stop changing first.
          if (!this.settled) return;
          if (stackSame) {
            apply({ seat, kind: 'fold' }, 'turn-passed', true, 'fold not displayed; deduced because the action passed this seat, it faced a bet and its stack is unchanged');
            continue;
          }
          return this.stuck(obs, seat, o.stack === null
            ? `seat ${seat} (${e.name}) faced a bet and the action passed it, but its stack cannot be read`
            : `seat ${seat} (${e.name}) faced a bet and the action passed it: stack ${o.stack} (expected ${e.stack}), bet shown ${o.bet}, neither a call nor a fold`);
        }

        // 4. The next street is out, so this seat closed its action on the previous one.
        if (!o) {
          apply({ seat, kind: la.canCheck ? 'check' : 'fold' }, 'street-advanced', true, `no longer visible at the table when the street changed (${la.canCheck ? 'check' : 'fold'} assumed, unconfirmed)`, true);
          continue;
        }
        if (la.canCheck) {
          // A lower stack than expected means a whole bet-and-call round went unseen.
          if (o.stack !== null && o.stack < e.stack - tol) throw new Error(`seat ${seat} lost chips on a street where only a check was visible`);
          apply({ seat, kind: 'check' }, 'street-advanced');
        } else if (o.stack !== null && Math.abs(o.stack - (e.stack - la.callAmount)) <= tol) {
          apply({ seat, kind: 'call' }, 'stack-change', true, `call of ${la.callAmount} deduced from the stack after the street changed`);
        } else if (o.stack !== null && Math.abs(o.stack - e.stack) <= tol) {
          apply({ seat, kind: 'fold' }, 'street-advanced', true, 'fold deduced: the street changed and the stack is unchanged');
        } else {
          // Never assume a call: chips that cannot be accounted for are not attributed to anyone.
          throw new Error(`seat ${seat} (${e.name}): the street changed but its stack (${o.stack ?? 'unreadable'}, expected ${e.stack} after a fold or ${e.stack - la.callAmount} after a call) fits neither`);
        }
        continue;
      }
      if (awaitingBoard(h)) {
        if (obs.board.length <= h.board.length) return;
        const need = h.street === 'preflop' ? 3 : 1;
        if (obs.board.length < h.board.length + need) return; // flop still being dealt
        for (let i = 0; i < h.board.length; i++) if (obs.board[i] !== h.board[i]) throw new Error('board cards changed mid-hand');
        const next = obs.board.slice(h.board.length, h.board.length + need);
        if (this.heroCards && !cardsAreDistinct([...this.heroCards, ...h.board, ...next])) throw new Error('board card duplicates a hero card');
        dealBoard(h, next);
        continue;
      }
      return;
    }
    throw new Error('reconstruction did not converge');
  }

  /** Chips moved with no visible bet: tolerated briefly (animation), then reported as a blocker. */
  private stuck(obs: TableObs, _seat: number, message: string): void {
    if (this.stuckSince === null) this.stuckSince = obs.ts;
    else if (obs.ts - this.stuckSince > this.stuckMs) this.flag('chips', message, true, obs.ts);
  }

  /** After deductions: does the result contradict what the page shows? Returns the reason, or null. */
  private contradiction(obs: TableObs): string | null {
    const h = this.h!;
    if (h.phase === 'complete') return null;
    const actor = this.observedActor(obs);
    if (actor !== null && obs.board.length === h.board.length && h.toAct !== actor) {
      return `deducing the unseen actions would leave ${h.toAct === null ? 'nobody' : `seat ${h.toAct}`} to act, but the table shows seat ${actor}: deductions withdrawn`;
    }
    if (obs.heroToAct && this.heroSeat !== null && h.toAct === this.heroSeat) {
      const la = legalActions(h)!;
      const c = obs.controls;
      if (c.call !== null && Number.isFinite(c.call) && Math.abs(c.call - la.callAmount) > this.tolerance) return `deducing the unseen actions gives a call of ${la.callAmount}, but the call button shows ${c.call}: deductions withdrawn`;
      if (c.check && !la.canCheck) return 'deducing the unseen actions leaves Hero facing a bet, but a check button is shown: deductions withdrawn';
    }
    return null;
  }

  /** Cross-check the reconstructed state against everything else that is visible. */
  private validate(obs: TableObs): void {
    const h = this.h!;
    if (h.phase === 'complete') return;
    const tol = Math.max(this.tolerance, 0.011);
    const found: { kind: DiscrepancyKind; msg: string; block: boolean }[] = [];
    const sameStreet = obs.board.length === h.board.length;
    const actor = this.observedActor(obs);
    const betting = h.toAct !== null && sameStreet;

    if (betting) {
      for (const o of obs.seats) {
        const e = h.seats.find((s) => s.seat === o.seat);
        if (!e || !e.dealtIn) continue;
        if (o.stack !== null && Math.abs(e.stack - o.stack) > tol && Math.abs(e.stack + e.streetCommit - (o.stack + o.bet)) > tol) {
          // A folded player's stack no longer affects any decision (top-ups show here).
          found.push({ kind: 'stack', msg: `stack mismatch seat ${o.seat} (${e.name}): engine ${e.stack}, table ${o.stack}`, block: !e.folded });
        }
        if (!e.folded && !o.folded && o.bet < e.streetCommit - tol) {
          found.push({ kind: 'bet', msg: `engine has seat ${o.seat} (${e.name}) with ${e.streetCommit} in front this street, table shows ${o.bet}: a blind or an action was attributed to the wrong seat`, block: true });
        }
        if (!e.folded && o.seat !== h.toAct && o.bet > e.streetCommit + tol) {
          found.push({ kind: 'bet', msg: `seat ${o.seat} (${e.name}) shows ${o.bet} in front, engine has ${e.streetCommit} and expects seat ${h.toAct} to act first`, block: false });
        }
      }
      if (obs.pot !== null) {
        const total = potTotal(h);
        let street = 0;
        for (const s of h.seats) street += s.streetCommit;
        if (Math.abs(obs.pot - total) > tol && Math.abs(obs.pot - (total - street)) > tol) {
          found.push({ kind: 'pot', msg: `pot mismatch: engine ${total} (${total - street} from earlier streets + ${street} in front), table ${obs.pot}`, block: false });
        }
      }
    }
    if (actor !== null && sameStreet && h.toAct !== actor) {
      const heroTurn = this.heroSeat !== null && actor === this.heroSeat;
      found.push({ kind: 'turn', msg: heroTurn ? `table says it is Hero's turn, engine expects ${h.toAct === null ? 'no further action' : `seat ${h.toAct}`}` : `table shows seat ${actor} to act, engine expects ${h.toAct === null ? 'no further action' : `seat ${h.toAct}`}`, block: true });
    } else if (obs.heroToAct && this.heroSeat === null) {
      found.push({ kind: 'turn', msg: 'table says it is Hero\'s turn, but Hero is not in the reconstructed hand', block: true });
    }
    if (this.heroSeat !== null) {
      if (obs.heroToAct && h.toAct === this.heroSeat) {
        const la = legalActions(h)!;
        const c = obs.controls;
        const problems: string[] = [];
        if (c.call !== null && Math.abs(c.call - la.callAmount) > tol) problems.push(`call button shows ${c.call}, engine computes ${la.callAmount}`);
        if (c.check !== la.canCheck && (c.check || c.call !== null)) problems.push(`check button ${c.check ? 'present' : 'absent'} but engine canCheck=${la.canCheck}`);
        if (!c.fold && !c.check && c.call === null) this.legal = { status: 'unverified', detail: 'no action buttons were read', actions: la };
        else this.legal = { status: problems.length ? 'mismatch' : 'match', detail: problems.join('; ') || null, actions: la };
        for (const p of problems) found.push({ kind: 'legal', msg: p, block: true });
      } else if (h.toAct === this.heroSeat) {
        this.legal = { status: 'unverified', detail: 'engine expects Hero to act; the table does not show Hero\'s turn yet', actions: legalActions(h) };
      }
      if (this.heroCards && obs.heroCards && (obs.heroCards[0] !== this.heroCards[0] || obs.heroCards[1] !== this.heroCards[1])
        && !(obs.heroCards[0] === this.heroCards[1] && obs.heroCards[1] === this.heroCards[0])) found.push({ kind: 'cards', msg: 'hero cards changed mid-hand', block: true });
    }
    for (const p of obs.problems) found.push({ kind: 'read', msg: `read problem: ${p}`, block: false });

    for (const f of found) {
      // A mismatch seen on a table that is still changing is not yet a finding: decisions wait, nothing is logged.
      if (f.block && !this.settled) { this.blockers.push(`table still updating: ${f.msg}`); this.note(`table still updating: ${f.msg}`); continue; }
      this.flag(f.kind, f.msg, f.block, obs.ts);
    }
    // Any stack the engine cannot account for keeps the hand out of the opponent profiles, whatever the phase.
    for (const o of obs.seats) {
      const e = h.seats.find((s) => s.seat === o.seat);
      if (!e || !e.dealtIn || o.stack === null) continue;
      if (Math.abs(e.stack - o.stack) > tol && Math.abs(e.stack + e.streetCommit - (o.stack + o.bet)) > tol) this.uncertain = true;
    }
  }

  private collectReveals(obs: TableObs): void {
    const h = this.h!;
    if (h.board.length < 3 && h.phase !== 'showdown' && h.phase !== 'complete') return;
    for (const o of obs.seats) {
      if (!o.shownCards || o.shownCards.length !== 2 || o.isHero) continue;
      if (cardsAreDistinct([...o.shownCards, ...h.board, ...(this.heroCards ?? [])])) this.reveals.set(o.seat, [o.shownCards[0], o.shownCards[1]]);
    }
    if (this.heroSeat !== null && this.heroCards && h.phase === 'showdown') this.reveals.set(this.heroSeat, this.heroCards);
  }

  private settle(): void {
    const h = this.h!;
    if (h.phase !== 'showdown') return;
    // Unknown (mucked) hands rank below every shown hand.
    completeHand(h, (seat) => {
      const c = this.reveals.get(seat);
      return c && h.board.length === 5 ? evaluateHand([...c, ...h.board]) : 0;
    });
  }

  /** Emit the current hand. When `observed` is false the next hand has started and the ending is inferred. */
  private finish(observed: boolean): CompletedHand | null {
    const h = this.h;
    if (!h || this.emitted) return null;
    if (!observed && this.valid && h.phase !== 'complete') {
      // The table moved on before the last action was seen. A pending seat facing a
      // bet must have folded (a call would have produced another street or a showdown).
      try {
        for (let guard = 0; guard < 20 && h.toAct !== null; guard++) {
          const la = legalActions(h)!;
          applyAction(h, { seat: h.toAct, kind: la.canCheck ? 'check' : 'fold' });
          this.pushMeta(this.lastObs?.ts ?? 0, 'hand-ended', true, true, 'the next hand began before this action was seen');
        }
        if (h.phase === 'showdown') this.settle();
      } catch { /* leave incomplete */ }
    }
    this.emitted = true;
    // An inferred ending can be wrong (an unseen raise that took the pot), so such hands are
    // kept for review but never marked valid: they are not applied to opponent profiles.
    return {
      hand: h, heroSeat: this.heroSeat, heroCards: this.heroCards, reveals: new Map(this.reveals), observedToEnd: observed,
      valid: observed && this.valid && !this.uncertain && h.phase === 'complete', meta: this.meta.slice(),
    };
  }
}
