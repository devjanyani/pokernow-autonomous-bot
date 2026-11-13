// ============================================================
// Game-state reconstruction from successive table observations.
//
// The tracker keeps ONE rules-engine hand (table/engine.ts) and explains each
// new observation as zero or more legal actions applied to it:
//
//   observed bet grew past the current bet  -> bet / raise to that amount
//   observed bet grew up to the current bet -> call (or short all-in call)
//   seat shows folded                       -> fold
//   nothing changed but the action moved on -> check (only when checking is legal)
//   more board cards than the engine has    -> close the round, deal the street
//
// Because events are derived by DIFFING the engine against what is visible,
// re-reading an unchanged table produces no events (no duplicates), and
// several actions that happened between two reads are replayed in order.
// Anything the rules cannot explain marks the hand invalid: the bot then
// stops deciding until the next hand starts cleanly.
// ============================================================

import { CardId, cardsAreDistinct } from '../cards';
import { evaluateHand } from '../../core/equity/hand-eval';
import {
  ActionInput, applyAction, awaitingBoard, completeHand, createHand, dealBoard, HandState, legalActions, potTotal, seatOf,
} from '../table/engine';
import { SeatObs, TableObs } from './observation';

export interface TrackerState {
  hand: HandState | null;
  heroSeat: number | null;
  heroCards: [CardId, CardId] | null;
  /** 0..1: how far the reconstructed state can be trusted for acting. */
  confidence: number;
  /** False once the rules could not explain an observation; stays false for the hand. */
  valid: boolean;
  /** True when the table is not No-Limit Hold'em (or could not be confirmed as such). */
  unsupported: boolean;
  issues: string[];
  /** Why no hand is being tracked, when hand is null. */
  waitingReason: string | null;
  /** Number of engine events: changes whenever the state advances (staleness token). */
  eventCount: number;
  handsSeen: number;
}

export interface CompletedHand {
  hand: HandState;
  heroSeat: number | null;
  heroCards: [CardId, CardId] | null;
  reveals: Map<number, [CardId, CardId]>;
  /** True when the final actions were observed (not inferred at the next hand's start). */
  observedToEnd: boolean;
  valid: boolean;
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
  private softIssues = 0;
  private hardIssue = false;
  /** The action is consistent with the table but a step was probably missed (hand not used for profiles). */
  private uncertain = false;
  /** How long an unexplained "seat must have acted" state may persist before the hand is invalid. */
  constructor(private readonly stuckMs = 4000, private readonly tolerance = 0.011) {}

  get state(): TrackerState {
    let confidence = 0;
    if (this.h && this.valid && !this.unsupported) confidence = this.hardIssue ? 0.3 : Math.max(0.4, 1 - 0.15 * this.softIssues);
    return {
      hand: this.h, heroSeat: this.heroSeat, heroCards: this.heroCards, confidence, valid: this.valid && !this.unsupported,
      unsupported: this.unsupported, issues: this.issues.slice(-12), waitingReason: this.h ? null : this.waitingReason,
      eventCount: this.h?.events.length ?? 0, handsSeen: this.handsSeen,
    };
  }

  private note(msg: string): void { if (this.issues[this.issues.length - 1] !== msg) this.issues.push(msg); }
  private invalidate(msg: string): void { this.valid = false; this.note(`INVALID: ${msg}`); }

  /** Feed one observation. Returns hands that finished since the previous call. */
  ingest(obs: TableObs): CompletedHand[] {
    const done: CompletedHand[] = [];
    // ---- game-type gate: never apply Hold'em logic to another variant ----
    const typeText = obs.gameType ?? '';
    const heroSeatObs = obs.seats.find((s) => s.isHero);
    const wrongCards = obs.problems.some((p) => /hero has \d+ cards/.test(p));
    if ((typeText && NOT_HOLDEM_RE.test(typeText) && !HOLDEM_RE.test(typeText)) || (typeText && NOT_HOLDEM_RE.test(typeText)) || wrongCards) {
      if (!this.unsupported) this.note(`unsupported game: ${typeText || 'hero does not hold exactly two cards'}`);
      this.unsupported = true;
      this.h = null; this.waitingReason = 'unsupported game type';
      return done;
    }
    this.unsupported = false;

    if (this.isNewHand(obs)) {
      const prev = this.finish(false);
      if (prev) done.push(prev);
      this.start(obs, heroSeatObs);
    }
    if (!this.h) return done;
    if (this.valid) {
      try { this.sync(obs); } catch (e) { this.invalidate((e as Error).message); }
    }
    if (this.valid) this.validate(obs);
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

  private start(obs: TableObs, heroObs: SeatObs | undefined): void {
    this.h = null; this.valid = true; this.issues = []; this.emitted = false; this.reveals = new Map();
    this.heroSeat = null; this.heroCards = null; this.stuckSince = null; this.uncertain = false; this.softIssues = 0; this.hardIssue = false;
    this.lastDealer = obs.dealerSeat;
    const fail = (why: string) => { this.waitingReason = why; };
    if (obs.board.length !== 0) return fail('joined mid-hand: waiting for the next hand');
    if (obs.dealerSeat === null) return fail('dealer button not found');
    if (!(obs.bigBlind && obs.bigBlind > 0)) return fail('blinds not readable');
    const present = obs.seats.filter((s) => !s.sittingOut && (s.hasCards || s.folded || s.bet > 0));
    if (present.length < 2) return fail('fewer than two players dealt in');
    if (present.some((s) => s.stack === null)) return fail('a stack could not be read');
    const names = new Map<string, number>();
    for (const s of obs.seats) names.set(s.name, (names.get(s.name) ?? 0) + 1);
    const ambiguous = new Set([...names].filter(([, n]) => n > 1).map(([name]) => name));
    const ante = obs.ante ?? 0;
    const dealtSeats = new Set(present.map((s) => s.seat));
    try {
      this.h = createHand({
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
    this.handsSeen++;
    this.waitingReason = null;
    if (heroObs && dealtSeats.has(heroObs.seat) && obs.heroCards) { this.heroSeat = heroObs.seat; this.heroCards = obs.heroCards; }
    else if (heroObs && dealtSeats.has(heroObs.seat)) this.note('hero cards not readable yet');
    // A straddle shows up as a blind-sized bet from the first seat to act that exceeds the big blind
    // before anyone could have acted; the engine cannot tell it from a raise, which is equivalent for play.
  }

  /** Explain the observation as legal actions. Throws IllegalActionError when it cannot. */
  private sync(obs: TableObs): void {
    const h = this.h!;
    const bySeat = new Map(obs.seats.map((s) => [s.seat, s]));
    if (!this.heroCards && obs.heroCards) {
      const heroObs = obs.seats.find((s) => s.isHero);
      if (heroObs && seatOf(h, heroObs.seat).dealtIn) { this.heroSeat = heroObs.seat; this.heroCards = obs.heroCards; }
    }
    const tol = this.tolerance;
    const apply = (a: ActionInput) => { applyAction(h, a); this.stuckSince = null; };
    for (let guard = 0; guard < 80; guard++) {
      if (h.phase === 'complete' || h.phase === 'showdown') return;
      if (h.toAct !== null) {
        const seat = h.toAct;
        const e = seatOf(h, seat);
        const o = bySeat.get(seat);
        const la = legalActions(h)!;
        if (!o) { apply({ seat, kind: 'fold' }); this.note(`seat ${seat} left during the hand: treated as a fold`); continue; }
        if (obs.board.length === h.board.length) {
          if (o.bet > e.streetCommit + tol) {
            if (o.bet > h.currentBet + tol) apply({ seat, kind: la.raiseKind, to: o.bet });
            else {
              if (o.bet < Math.min(h.currentBet, e.streetCommit + e.stack) - tol) throw new Error(`seat ${seat} shows ${o.bet} against a bet of ${h.currentBet}: intermediate raises were missed`);
              apply({ seat, kind: 'call' });
            }
            continue;
          }
          if (o.folded) {
            // A folded seat whose stack is lower than expected put chips in that were never seen.
            if (o.stack !== null && o.stack < e.stack - tol) throw new Error(`seat ${seat} folded after unseen betting (stack ${o.stack}, expected ${e.stack})`);
            // Folding when a check is free almost always means a bet was made and taken back unseen.
            if (la.canCheck) { this.uncertain = true; this.note(`seat ${seat} folded with a free check available: a bet was probably missed`); }
            apply({ seat, kind: 'fold' });
            continue;
          }
          // Opponents' cards face up on the river: the betting is over, so this seat closed it.
          if (h.street === 'river' && obs.seats.some((s) => s.shownCards !== null && !s.isHero)) {
            if (la.canCheck) apply({ seat, kind: 'check' });
            else apply({ seat, kind: o.hasCards ? 'call' : 'fold' });
            continue;
          }
          const movedOn = obs.toActSeat !== null ? obs.toActSeat !== seat : obs.heroToAct && seat !== this.heroSeat;
          if (movedOn && la.canCheck) { apply({ seat, kind: 'check' }); continue; }
          if (movedOn) {
            // Facing a bet with no visible reaction: usually an animation in progress.
            if (this.stuckSince === null) this.stuckSince = obs.ts;
            else if (obs.ts - this.stuckSince > this.stuckMs) this.invalidate(`seat ${seat} (${e.name}) faced a bet but shows neither a call nor a fold`);
          }
          return;
        }
        if (obs.board.length > h.board.length) {
          // The street has moved on, so this seat closed its action.
          if (o.folded) {
            if (o.stack !== null && o.stack < e.stack - tol) throw new Error(`seat ${seat} folded after unseen betting (stack ${o.stack}, expected ${e.stack})`);
            if (la.canCheck) { this.uncertain = true; this.note(`seat ${seat} folded with a free check available: a bet was probably missed`); }
            apply({ seat, kind: 'fold' });
          }
          else if (la.canCheck) {
            // A lower stack than expected means a whole bet-and-call round went unseen.
            if (o.stack !== null && o.stack < e.stack - tol) throw new Error(`seat ${seat} lost chips on a street where only a check was visible`);
            apply({ seat, kind: 'check' });
          }
          else if (o.stack !== null && Math.abs(o.stack - (e.stack - la.callAmount)) <= tol) apply({ seat, kind: 'call' });
          else if (!o.hasCards) apply({ seat, kind: 'fold' });
          else { apply({ seat, kind: 'call' }); this.softIssues++; this.note(`seat ${seat}: call inferred across a street change (stack read ${o.stack})`); }
          continue;
        }
        return; // fewer board cards than the engine: handled by isNewHand
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

  /** Cross-check the reconstructed state against everything else that is visible. */
  private validate(obs: TableObs): void {
    const h = this.h!;
    if (h.phase === 'complete') return;
    let soft = 0; let hard = false;
    const tol = Math.max(this.tolerance, 0.011);
    for (const o of obs.seats) {
      const e = h.seats.find((s) => s.seat === o.seat);
      if (!e || !e.dealtIn || o.stack === null) continue;
      if (Math.abs(e.stack - o.stack) > tol && Math.abs(e.stack + e.streetCommit - (o.stack + o.bet)) > tol) { soft++; this.uncertain = true; this.note(`stack mismatch seat ${o.seat}: engine ${e.stack}, table ${o.stack}`); }
    }
    if (obs.pot !== null) {
      const total = potTotal(h);
      let street = 0;
      for (const s of h.seats) street += s.streetCommit;
      if (Math.abs(obs.pot - total) > tol && Math.abs(obs.pot - (total - street)) > tol) { soft++; this.note(`pot mismatch: engine ${total} (${total - street} before this street), table ${obs.pot}`); }
    }
    if (this.heroSeat !== null) {
      if (obs.heroToAct && h.toAct !== this.heroSeat) { hard = true; this.note(`table says it is Hero's turn, engine expects seat ${h.toAct}`); }
      if (obs.heroToAct && h.toAct === this.heroSeat) {
        const la = legalActions(h)!;
        if (obs.controls.call !== null && Math.abs(obs.controls.call - la.callAmount) > tol) { hard = true; this.note(`call button shows ${obs.controls.call}, engine computes ${la.callAmount}`); }
        if (obs.controls.check !== la.canCheck && (obs.controls.check || obs.controls.call !== null)) { hard = true; this.note(`check button ${obs.controls.check ? 'present' : 'absent'} but engine canCheck=${la.canCheck}`); }
      }
      if (this.heroCards && obs.heroCards && (obs.heroCards[0] !== this.heroCards[0] || obs.heroCards[1] !== this.heroCards[1])
        && !(obs.heroCards[0] === this.heroCards[1] && obs.heroCards[1] === this.heroCards[0])) { hard = true; this.note('hero cards changed mid-hand'); }
    }
    if (obs.problems.length) { soft += obs.problems.length; for (const p of obs.problems) this.note(`read problem: ${p}`); }
    this.softIssues = soft; this.hardIssue = hard;
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
        }
        if (h.phase === 'showdown') this.settle();
      } catch { /* leave incomplete */ }
    }
    this.emitted = true;
    // An inferred ending can be wrong (an unseen raise that took the pot), so such hands are
    // kept for review but never marked valid: they are not applied to opponent profiles.
    return { hand: h, heroSeat: this.heroSeat, heroCards: this.heroCards, reveals: new Map(this.reveals), observedToEnd: observed, valid: observed && this.valid && !this.uncertain && h.phase === 'complete' };
  }
}
