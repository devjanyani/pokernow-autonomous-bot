// ============================================================
// PokerNow hand-log parser and replayer.
//
// Parses the text lines of a PokerNow game log (the downloadable CSV, or lines
// copied from the log window) into typed events and replays every hand
// through the rules engine. Uses:
//   * importing past sessions into opponent profiles (dashboard: Import log),
//   * replay fixtures for tests when no live table is available,
//   * reviewing hands offline.
//
// Line formats are the ones PokerNow writes, e.g.
//   -- starting hand #3 (id: abc)  (No Limit Texas Hold'em) (dealer: "Ann @ a1") --
//   Player stacks: #1 "Ann @ a1" (1000) | #4 "Bob @ b2" (980)
//   "Bob @ b2" posts a small blind of 10
//   "Ann @ a1" raises to 60          "Bob @ b2" calls 60 and go all in
//   Flop:  [9♠, 4♦, 2♥]   Turn: 9♠, 4♦, 2♥ [K♣]   River: ... [3♠]
//   "Ann @ a1" shows a 5♦, A♣.       -- ending hand #3 --
// The parser was written from the documented format, not validated against a
// live export in this repository: unknown lines are reported, never guessed.
// ============================================================

import { CardId, parseCardStrict } from '../../cards';
import { evaluateHand } from '../../../core/equity/hand-eval';
import { applyAction, awaitingBoard, completeHand, createHand, dealBoard, HandState, legalActions, seatOf } from '../../table/engine';
import type { CompletedHand } from '../tracker';

export interface PlayerRef { name: string; id: string | null }

export type LogEvent =
  | { t: 'start'; number: number; handId: string | null; game: string; dealer: PlayerRef | null; deadButton: boolean }
  | { t: 'stacks'; players: { seat: number; ref: PlayerRef; stack: number }[] }
  | { t: 'hero'; cards: CardId[] }
  | { t: 'post'; ref: PlayerRef; kind: 'sb' | 'bb' | 'ante' | 'straddle' | 'other'; amount: number }
  | { t: 'action'; ref: PlayerRef; kind: 'fold' | 'check' | 'call' | 'bet' | 'raise'; amount: number | null; allIn: boolean }
  | { t: 'board'; street: 'flop' | 'turn' | 'river'; cards: CardId[]; secondRun: boolean }
  | { t: 'show'; ref: PlayerRef; cards: CardId[] }
  | { t: 'collect'; ref: PlayerRef; amount: number }
  | { t: 'uncalled'; ref: PlayerRef; amount: number }
  | { t: 'end'; number: number }
  | { t: 'table'; text: string }      // joins, quits, stand up, admin changes ...
  | { t: 'unknown'; text: string };

const num = (s: string): number => Number(s.replace(/,/g, ''));

export function parsePlayerRef(quoted: string): PlayerRef {
  const m = quoted.match(/^(.*) @ ([A-Za-z0-9_-]+)$/);
  return m ? { name: m[1].trim(), id: m[2] } : { name: quoted.trim(), id: null };
}
export const refKey = (r: PlayerRef): string => (r.id ? r.id : `name:${r.name}`);

function parseCardList(text: string): CardId[] | null {
  const out: CardId[] = [];
  for (const part of text.split(',')) {
    const c = parseCardStrict(part.trim().replace(/\.$/, ''));
    if (c === null) return null;
    out.push(c);
  }
  return out;
}

export function parseLogLine(raw: string): LogEvent {
  const text = raw.trim();
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^-- starting hand #(\d+)(?:\s*\(id:\s*([^)]+)\))?\s*\(([^)]*)\)\s*\((dead button|dealer:\s*"(.+)")\)\s*--$/i))) {
    return { t: 'start', number: Number(m[1]), handId: m[2]?.trim() ?? null, game: m[3].trim(), dealer: m[5] ? parsePlayerRef(m[5]) : null, deadButton: /dead button/i.test(m[4]) };
  }
  if ((m = text.match(/^-- ending hand #(\d+) --$/i))) return { t: 'end', number: Number(m[1]) };
  if (/^Player stacks:/i.test(text)) {
    const players: { seat: number; ref: PlayerRef; stack: number }[] = [];
    for (const part of text.replace(/^Player stacks:\s*/i, '').split(' | ')) {
      const pm = part.match(/^#(\d+)\s+"(.+)"\s+\(([\d.,]+)\)$/);
      if (!pm) return { t: 'unknown', text };
      players.push({ seat: Number(pm[1]), ref: parsePlayerRef(pm[2]), stack: num(pm[3]) });
    }
    return { t: 'stacks', players };
  }
  if ((m = text.match(/^Your hand is (.+)$/i))) {
    const cards = parseCardList(m[1]);
    return cards ? { t: 'hero', cards } : { t: 'unknown', text };
  }
  if ((m = text.match(/^(Flop|Turn|River)( \(second run\))?:\s*(?:.*?)\[([^\]]+)\]$/i))) {
    const cards = parseCardList(m[3]);
    return cards ? { t: 'board', street: m[1].toLowerCase() as 'flop' | 'turn' | 'river', cards, secondRun: !!m[2] } : { t: 'unknown', text };
  }
  if ((m = text.match(/^Uncalled bet of ([\d.,]+) returned to "(.+)"$/i))) return { t: 'uncalled', ref: parsePlayerRef(m[2]), amount: num(m[1]) };
  if ((m = text.match(/^"(.+)" (.+)$/))) {
    const ref = parsePlayerRef(m[1]);
    const rest = m[2];
    const allIn = /and go all in\s*$/i.test(rest);
    let a: RegExpMatchArray | null;
    if ((a = rest.match(/^posts an? (missing |missed )?(small blind|big blind|ante|straddle) of ([\d.,]+)/i))) {
      const k = a[1] ? 'other' : a[2].toLowerCase() === 'small blind' ? 'sb' : a[2].toLowerCase() === 'big blind' ? 'bb' : a[2].toLowerCase() === 'ante' ? 'ante' : 'straddle';
      return { t: 'post', ref, kind: k, amount: num(a[3]) };
    }
    if (/^folds\b/i.test(rest)) return { t: 'action', ref, kind: 'fold', amount: null, allIn: false };
    if (/^checks\b/i.test(rest)) return { t: 'action', ref, kind: 'check', amount: null, allIn: false };
    if ((a = rest.match(/^calls ([\d.,]+)/i))) return { t: 'action', ref, kind: 'call', amount: num(a[1]), allIn };
    if ((a = rest.match(/^bets ([\d.,]+)/i))) return { t: 'action', ref, kind: 'bet', amount: num(a[1]), allIn };
    if ((a = rest.match(/^raises to ([\d.,]+)/i))) return { t: 'action', ref, kind: 'raise', amount: num(a[1]), allIn };
    if ((a = rest.match(/^shows a (.+?)\.?$/i))) {
      const cards = parseCardList(a[1]);
      return cards ? { t: 'show', ref, cards } : { t: 'unknown', text };
    }
    if ((a = rest.match(/^collected ([\d.,]+) from pot/i))) return { t: 'collect', ref, amount: num(a[1]) };
    return { t: 'table', text };
  }
  if (/^The (player|admin|game)/i.test(text) || /^(Dead Small Blind|Remaining players|Undealt cards|WARNING)/i.test(text)) return { t: 'table', text };
  return { t: 'unknown', text };
}

/** Parse PokerNow's CSV export (entry,at,order). Returns log lines oldest first. */
export function parseLogCsv(csv: string): string[] {
  const rows: { entry: string; order: number }[] = [];
  const text = csv.replace(/^\uFEFF/, '');
  let i = 0, field = '', row: string[] = [], inQ = false;
  const pushRow = () => {
    row.push(field); field = '';
    if (row.length >= 3 && row[0] !== 'entry') rows.push({ entry: row[0], order: Number(row[2]) });
    row = [];
  };
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') pushRow();
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) pushRow();
  rows.sort((a, b) => a.order - b.order);
  return rows.map((r) => r.entry);
}

export interface ReplayedHand extends CompletedHand {
  number: number;
  errors: string[];
}

export interface ReplayResult { hands: ReplayedHand[]; unknownLines: string[]; unsupportedHands: number }

/**
 * Replay log lines (oldest first) through the rules engine. Hands the engine
 * cannot reproduce are returned with valid=false and their errors; they are
 * never applied to profiles.
 */
export function replayLog(lines: string[], tableId = 'log'): ReplayResult {
  const hands: ReplayedHand[] = [];
  const unknownLines: string[] = [];
  let unsupportedHands = 0;
  let cur: { start: Extract<LogEvent, { t: 'start' }>; events: LogEvent[] } | null = null;

  const flush = () => {
    if (!cur) return;
    const { start, events } = cur;
    cur = null;
    const errors: string[] = [];
    if (!/hold'?em/i.test(start.game) || !/no limit/i.test(start.game)) { unsupportedHands++; return; }
    const stacks = events.find((e): e is Extract<LogEvent, { t: 'stacks' }> => e.t === 'stacks');
    const posts = events.filter((e): e is Extract<LogEvent, { t: 'post' }> => e.t === 'post');
    const sb = posts.find((p) => p.kind === 'sb'), bb = posts.find((p) => p.kind === 'bb');
    if (!stacks || !bb) return;
    if (posts.some((p) => p.kind === 'other')) errors.push('missed/dead blind posts are not supported');
    const seatByKey = new Map(stacks.players.map((p) => [refKey(p.ref), p.seat]));
    if (seatByKey.size !== stacks.players.length) errors.push('two players share an identity');
    const dealerSeat = start.dealer ? seatByKey.get(refKey(start.dealer)) : undefined;
    const straddle = posts.find((p) => p.kind === 'straddle');
    const ante = posts.find((p) => p.kind === 'ante');
    let h: HandState | null = null;
    let heroCards: [CardId, CardId] | null = null;
    const reveals = new Map<number, [CardId, CardId]>();
    try {
      if (dealerSeat === undefined) throw new Error(start.deadButton ? 'dead button hands are not supported' : 'dealer not among the players');
      h = createHand({
        handId: `${tableId}:${start.handId ?? start.number}`, buttonSeat: dealerSeat, smallBlind: sb?.amount ?? 0, bigBlind: bb.amount,
        ante: ante?.amount, straddle: straddle?.amount, variant: 'nlhe',
        seats: [...stacks.players].sort((a, b) => a.seat - b.seat).map((p) => ({ seat: p.seat, playerId: refKey(p.ref), name: p.ref.name, stack: p.stack })),
      });
      const check = (p: typeof posts[number] | undefined, flag: 'isSmallBlind' | 'isBigBlind') => {
        if (p && !seatOf(h!, seatByKey.get(refKey(p.ref))!).pos![flag]) throw new Error(`${p.kind} posted from an unexpected seat`);
      };
      check(sb, 'isSmallBlind'); check(bb, 'isBigBlind');
      for (const e of events) {
        if (e.t === 'hero' && e.cards.length === 2) heroCards = [e.cards[0], e.cards[1]];
        else if (e.t === 'hero') throw new Error(`hero holds ${e.cards.length} cards: not Hold'em`);
        else if (e.t === 'action') {
          const seat = seatByKey.get(refKey(e.ref));
          if (seat === undefined) throw new Error(`unknown player ${e.ref.name}`);
          if (e.kind === 'bet' || e.kind === 'raise') {
            // PokerNow logs the first postflop wager as "bets" and everything else as "raises to".
            const la = legalActions(h);
            applyAction(h, { seat, kind: la?.raiseKind ?? e.kind, to: e.amount! });
          } else {
            const ev = applyAction(h, { seat, kind: e.kind });
            if (e.kind === 'call' && e.amount !== null && Math.abs(ev.to - e.amount) > 0.011 && Math.abs(ev.amount - e.amount) > 0.011) {
              errors.push(`call amount ${e.amount} does not match the engine (${ev.amount} added, ${ev.to} total)`);
            }
          }
        } else if (e.t === 'board' && !e.secondRun) {
          if (!awaitingBoard(h)) throw new Error(`${e.street} dealt while betting is open`);
          dealBoard(h, e.cards);
        } else if (e.t === 'board') errors.push('run-it-twice board ignored');
        else if (e.t === 'show' && e.cards.length === 2) {
          const seat = seatByKey.get(refKey(e.ref));
          if (seat !== undefined) reveals.set(seat, [e.cards[0], e.cards[1]]);
        }
      }
      if (h.phase === 'showdown') {
        const hh = h;
        completeHand(hh, (seat) => { const c = reveals.get(seat); return c ? evaluateHand([...c, ...hh.board]) : 0; });
      }
      if (h.phase !== 'complete') errors.push(`hand ended in phase ${h.phase}`);
    } catch (e) {
      errors.push((e as Error).message);
    }
    if (!h) return;
    hands.push({ number: start.number, hand: h, heroSeat: null, heroCards, reveals, observedToEnd: true, valid: errors.length === 0 && h.phase === 'complete', errors });
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    const ev = parseLogLine(line);
    if (ev.t === 'start') { flush(); cur = { start: ev, events: [] }; continue; }
    if (ev.t === 'unknown') { unknownLines.push(line); continue; }
    if (!cur) continue;
    if (ev.t === 'end') { flush(); continue; }
    cur.events.push(ev);
  }
  flush();
  return { hands, unknownLines, unsupportedHands };
}
