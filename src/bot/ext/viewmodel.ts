// ============================================================
// Pure view models for the dashboard tabs: no DOM, no chrome.*, no storage.
// Everything the tabs sort, filter, page, label or cross-check is computed
// here so it can be unit tested on recorded data.
// ============================================================

import { classify, PlayerProfile, posterior, Posterior, StatKey, StyleProbabilities } from '../opponents/profile';
import type { DecisionRecord, HandRecord, Settings } from './records';
import type { SessionSummary, TableSummary } from './storage';
import type { Tone } from './view';

// ---- identifiers ---------------------------------------------------------------

/** "pglaSnQ1x9Zk3bV" -> "pglaSn…k3bV". Short ids are returned unchanged. */
export function shortId(id: string, head = 6, tail = 4): string {
  return id.length <= head + tail + 1 ? id : `${id.slice(0, head)}…${id.slice(-tail)}`;
}
export function tableLabel(tableId: string, nicknames: ReadonlyMap<string, string>): string {
  const n = nicknames.get(tableId);
  return n ? n : tableId === 'imported-log' ? 'Imported log' : shortId(tableId);
}
/** Hand ids are "<table>:<label>:<n>:<clock>"; n counts hands since the table tab was opened. */
export function handNumber(handId: string): string {
  const parts = handId.split(':');
  const n = parts.length >= 4 ? parts[parts.length - 2] : '';
  return /^\d+$/.test(n) ? `#${n}` : shortId(handId, 4, 6);
}

// ---- generic list helpers ---------------------------------------------------------

export type SortDir = 'asc' | 'desc';
/** Stable sort; rows whose key is null always go last, whichever direction. */
export function sortRows<T>(rows: readonly T[], key: (r: T) => number | string | null | undefined, dir: SortDir): T[] {
  const m = dir === 'asc' ? 1 : -1;
  return rows.map((r, i) => ({ r, i, k: key(r) })).sort((a, b) => {
    const an = a.k === null || a.k === undefined || (typeof a.k === 'number' && !Number.isFinite(a.k));
    const bn = b.k === null || b.k === undefined || (typeof b.k === 'number' && !Number.isFinite(b.k));
    if (an || bn) return an && bn ? a.i - b.i : an ? 1 : -1;
    const c = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : String(a.k).localeCompare(String(b.k), undefined, { sensitivity: 'base', numeric: true });
    return c !== 0 ? m * c : a.i - b.i;
  }).map((x) => x.r);
}

export interface Page<T> { rows: T[]; page: number; pages: number; total: number; from: number; to: number }
export function paginate<T>(rows: readonly T[], page: number, size: number): Page<T> {
  const total = rows.length, pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const from = (p - 1) * size;
  return { rows: rows.slice(from, from + size), page: p, pages, total, from: total ? from + 1 : 0, to: Math.min(total, from + size) };
}
/** Case-insensitive: every word of the query must occur in one of the fields. */
export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fields.filter(Boolean).join('\n').toLowerCase();
  return words.every((w) => hay.includes(w));
}
export const pct = (x: number | null | undefined, digits = 0): string => (x === null || x === undefined || !Number.isFinite(x) ? '–' : `${(100 * x).toFixed(digits)}%`);
export function ago(ts: number, now: number): string {
  if (!ts) return 'never';
  const s = Math.max(0, (now - ts) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

// ---- opponents ---------------------------------------------------------------------

export const STYLE_NAMES: [keyof StyleProbabilities, string][] = [
  ['tightAggressive', 'Tight-aggressive'], ['looseAggressive', 'Loose-aggressive'], ['tightPassive', 'Tight-passive'], ['loosePassive', 'Loose-passive'], ['unclassified', 'Not enough hands'],
];
/** The headline statistics, in table order. Everything else is in the expandable detail. */
export const KEY_STATS: { key: StatKey; label: string; title: string }[] = [
  { key: 'vpip', label: 'VPIP', title: 'Voluntarily put chips in before the flop' },
  { key: 'pfr', label: 'PFR', title: 'Raised before the flop' },
  { key: 'threeBet', label: '3-bet', title: 'Re-raised a preflop raise' },
  { key: 'aggFreq', label: 'Aggression', title: 'Bets and raises as a share of postflop actions' },
  { key: 'foldToCbetFlop', label: 'Fold to c-bet', title: 'Folded to a flop continuation bet' },
  { key: 'wtsd', label: 'Showdown', title: 'Went to showdown after seeing a flop' },
];
export const STAT_GROUPS: { title: string; keys: [StatKey, string][] }[] = [
  { title: 'Before the flop', keys: [['vpip', 'VPIP'], ['pfr', 'Raise'], ['rfi', 'Raise first in'], ['limp', 'Limp'], ['coldCall', 'Cold call'], ['threeBet', '3-bet'], ['foldTo3Bet', 'Fold to 3-bet'], ['fourBet', '4-bet']] },
  { title: 'By position', keys: [['vpipEarly', 'VPIP early'], ['vpipLate', 'VPIP late'], ['vpipBlinds', 'VPIP blinds'], ['rfiEarly', 'Raise first in, early'], ['rfiLate', 'Raise first in, late'], ['rfiBlinds', 'Raise first in, blinds']] },
  { title: 'As the bettor', keys: [['cbetFlop', 'C-bet flop'], ['cbetTurn', 'C-bet turn'], ['betWhenCheckedToFlop', 'Bet when checked to, flop'], ['betWhenCheckedToTurn', 'Bet when checked to, turn'], ['betWhenCheckedToRiver', 'Bet when checked to, river'], ['checkRaise', 'Check-raise'], ['aggFreq', 'Aggression frequency'], ['aggVsCall', 'Aggressive vs calling']] },
  { title: 'Facing a bet', keys: [['foldToCbetFlop', 'Fold to c-bet, flop'], ['foldToCbetTurn', 'Fold to c-bet, turn'], ['foldVsBetFlop', 'Fold, flop'], ['callVsBetFlop', 'Call, flop'], ['raiseVsBetFlop', 'Raise, flop'], ['foldVsBetTurn', 'Fold, turn'], ['callVsBetTurn', 'Call, turn'], ['raiseVsBetTurn', 'Raise, turn'], ['foldVsBetRiver', 'Fold, river'], ['callVsBetRiver', 'Call, river'], ['raiseVsBetRiver', 'Raise, river'], ['foldVsBetHeadsUp', 'Fold, heads-up'], ['foldVsBetMultiway', 'Fold, multiway']] },
  { title: 'Showdown', keys: [['wtsd', 'Went to showdown'], ['wsd', 'Won at showdown']] },
];

export interface OpponentRow {
  id: string; name: string; hands: number; lastSeen: number;
  /** Most likely style and its probability; `confidence` says how much the hand count supports any label. */
  style: string; styleKey: keyof StyleProbabilities; styleProb: number;
  confidence: 'none' | 'low' | 'medium' | 'high';
  styles: StyleProbabilities;
  stats: Record<string, Posterior>;
  /** "name:<table>:<name>" identities are scoped to one table. */
  scope: string | null;
  profile: PlayerProfile;
}
export function opponentRow(p: PlayerProfile): OpponentRow {
  const styles = classify(p);
  const best = STYLE_NAMES.map(([k, label]) => ({ k, label, v: styles[k] })).sort((a, b) => b.v - a.v)[0];
  const n = p.stats.vpip.d;
  const stats: Record<string, Posterior> = {};
  for (const s of KEY_STATS) stats[s.key] = posterior(p, s.key);
  const scoped = /^name:([^:]+):/.exec(p.playerId);
  return {
    id: p.playerId, name: p.name, hands: p.hands, lastSeen: p.lastSeen, style: best.label, styleKey: best.k, styleProb: best.v,
    confidence: n < 10 ? 'none' : n < 40 ? 'low' : n < 120 ? 'medium' : 'high', styles, stats, scope: scoped ? scoped[1] : null, profile: p,
  };
}
/** "34%" with the interval and sample underneath; "–" when never observed. */
export function statCell(q: Posterior): { main: string; sub: string; observed: boolean } {
  if (q.d === 0) return { main: '–', sub: 'no samples', observed: false };
  return { main: pct(q.mean), sub: `${pct(q.lo)}–${pct(q.hi)} · n=${q.d}`, observed: true };
}

// ---- hands -----------------------------------------------------------------------------

export type HandStatusKind = 'verified' | 'unverified' | 'ending-not-observed' | 'invalid';
export interface HandStatus { kind: HandStatusKind; label: string; tone: Tone; detail: string }

/** Chips Hero put into the pot according to the recorded actions. */
export function heroCommitted(h: HandRecord): number | null {
  if (h.heroSeat === null) return null;
  return h.events.filter((e) => e.seat === h.heroSeat).reduce((a, e) => a + (Number(e.amount) || 0), 0);
}
/** Sum of all stack changes of the hand; 0 when every chip is accounted for. Null when stacks are unknown. */
export function chipImbalance(h: HandRecord): number | null {
  const seats = h.seats.filter((s) => s.dealtIn);
  if (!seats.length || seats.some((s) => !Number.isFinite(s.startStack) || !Number.isFinite(s.endStack))) return null;
  return Math.round(seats.reduce((a, s) => a + (s.endStack - s.startStack), 0) * 100) / 100;
}

/**
 * Hero's result in chips. Normally the result settled from the cards shown; when the stacks at the start of the
 * next hand show that the pot was shared differently (board run twice), the table's result.
 */
export function heroResult(h: HandRecord): number | null {
  if (h.heroNet === null) return null;
  return h.stackCheck?.status === 'awarded-differently' && h.stackCheck.heroDiff !== null ? Math.round((h.heroNet + h.stackCheck.heroDiff) * 100) / 100 : h.heroNet;
}

/** Everything about a stored hand that the reader should be warned about. Never empty for an unverified hand. */
export function handWarnings(h: HandRecord): string[] {
  const w: string[] = [];
  if (!h.observedToEnd) w.push('The end of this hand was not observed (the next hand started first, or the table tab was closed). The result is not known.');
  if (!h.valid && h.observedToEnd) w.push('The reconstruction of this hand failed a consistency check. Actions and result may be wrong and it was not used for opponent statistics.');
  const deduced = h.events.filter((e) => e.inferred && !e.uncertain).length, unconfirmed = h.events.filter((e) => e.uncertain).length;
  if (unconfirmed) w.push(`${unconfirmed} action(s) were deduced from the rules and never confirmed by the table.`);
  else if (deduced) w.push(`${deduced} action(s) were not displayed by the table and were deduced from the rules.`);
  const imb = chipImbalance(h);
  if (h.heroNet !== null && imb !== null && Math.abs(imb) > 0.011) w.push(`Stack changes do not add up to zero (${imb > 0 ? '+' : ''}${imb} chips): a stack was read wrongly or a player re-bought during the hand.`);
  const put = heroCommitted(h);
  if (h.heroNet !== null && put !== null && h.heroNet < -put - 0.011) w.push(`Hero's stack fell by ${-h.heroNet} but the recorded actions put only ${put} into the pot: the stack change is not explained by the betting.`);
  if (h.heroSeat !== null && !h.heroCards) w.push('Hero\'s cards were not read.');
  if (h.stackCheck?.status === 'awarded-differently') w.push(`Result taken from the table, not from the cards shown: ${h.stackCheck.note}.`);
  if (h.stackCheck?.status === 'unexplained') w.push(`Result not confirmed: ${h.stackCheck.note}.`);
  return w;
}

export function handStatus(h: HandRecord): HandStatus {
  if (!h.observedToEnd) return { kind: 'ending-not-observed', label: 'Ending not observed', tone: 'warn', detail: 'No result is known for this hand.' };
  if (!h.valid) return { kind: 'invalid', label: 'Reconstruction invalid', tone: 'bad', detail: 'Failed a consistency check; the result is not trusted.' };
  if (h.stackCheck?.status === 'unexplained') return { kind: 'unverified', label: 'Result unverified', tone: 'warn', detail: 'The stacks at the start of the next hand do not match the settled result.' };
  const imb = chipImbalance(h), put = heroCommitted(h);
  if ((imb !== null && Math.abs(imb) > 0.011) || (h.heroNet !== null && put !== null && h.heroNet < -put - 0.011)) return { kind: 'unverified', label: 'Result unverified', tone: 'warn', detail: 'The stack changes are not explained by the recorded betting.' };
  const c = h.stackCheck?.status;
  if (c === 'awarded-differently') return { kind: 'verified', label: 'Verified by stacks', tone: 'good', detail: 'The pot was shared differently from the cards shown (for example the board was run twice); the result is the one the table paid.' };
  if (c === 'confirmed' || c === 'top-up') return { kind: 'verified', label: 'Verified', tone: 'good', detail: 'Actions, pot and stacks agree, and the next hand started with exactly the settled stacks.' };
  return { kind: 'verified', label: 'Verified', tone: 'good', detail: 'Actions, pot and stacks agree. Not cross-checked against a following hand.' };
}

export interface HandRow {
  h: HandRecord; id: string; number: string; ts: number; tableId: string; table: string; players: number;
  status: HandStatus; warnings: number;
  /** Hero's result in big blinds. Present only when a result exists; `verified` says whether it may be trusted and summed. */
  netBB: number | null; verified: boolean;
  heroPosition: string | null; street: string; showdown: boolean;
}
export function handRow(h: HandRecord, nicknames: ReadonlyMap<string, string>): HandRow {
  const status = handStatus(h);
  const hero = h.heroSeat !== null ? h.seats.find((s) => s.seat === h.heroSeat) : undefined;
  const last = h.events[h.events.length - 1];
  return {
    h, id: h.handId, number: handNumber(h.handId), ts: h.ts, tableId: h.tableId, table: tableLabel(h.tableId, nicknames), players: h.seats.filter((s) => s.dealtIn).length,
    status, warnings: handWarnings(h).length, netBB: h.heroNet !== null && h.bigBlind > 0 ? (heroResult(h) as number) / h.bigBlind : null, verified: status.kind === 'verified' && h.heroNet !== null,
    heroPosition: hero?.position ?? null, street: h.board.length >= 5 ? 'river' : h.board.length === 4 ? 'turn' : h.board.length === 3 ? 'flop' : last?.street ?? 'preflop', showdown: h.wentToShowdown,
  };
}

export interface HandFilter { query: string; table: string; status: 'all' | HandStatusKind | 'problems'; hero: 'all' | 'played' | 'won' | 'lost'; }
export const NO_HAND_FILTER: HandFilter = { query: '', table: 'all', status: 'all', hero: 'all' };
export function filterHands(rows: readonly HandRow[], f: HandFilter): HandRow[] {
  return rows.filter((r) => {
    if (f.table !== 'all' && r.tableId !== f.table) return false;
    if (f.status === 'problems' ? r.status.kind === 'verified' : f.status !== 'all' && r.status.kind !== f.status) return false;
    if (f.hero === 'played' && !r.h.events.some((e) => e.seat === r.h.heroSeat && !e.kind.startsWith('post') && e.kind !== 'fold')) return false;
    if (f.hero === 'won' && !(r.netBB !== null && r.netBB > 0)) return false;
    if (f.hero === 'lost' && !(r.netBB !== null && r.netBB < 0)) return false;
    return matches(f.query, r.table, r.tableId, r.number, r.h.heroCards?.join(' '), r.h.board.join(' '), ...r.h.seats.map((s) => s.name));
  });
}
/** Totals over VERIFIED results only; unverified results are counted, never summed. */
export function handTotals(rows: readonly HandRow[]): { hands: number; verified: number; netBB: number; unverifiedWithResult: number; noResult: number } {
  const v = rows.filter((r) => r.verified);
  return { hands: rows.length, verified: v.length, netBB: v.reduce((a, r) => a + (r.netBB as number), 0), unverifiedWithResult: rows.filter((r) => !r.verified && r.netBB !== null).length, noResult: rows.filter((r) => r.netBB === null).length };
}

export type RecMatch = 'followed' | 'same-action-other-size' | 'different';
export interface ActionLine {
  seq: number; seat: number; name: string; position: string | null; isHero: boolean; kind: string; text: string; allIn: boolean;
  deduced: boolean; unconfirmed: boolean; potBefore: number;
  /** The recommendation computed for this decision point, when one was stored. */
  rec: null | { label: string; action: string; to: number | null; match: RecMatch; execution: string | null; equity: number | null; candidates: { label: string; ev: number | null; freq: number }[]; basis: string[]; uncertainty: string };
}
export interface StreetBlock { street: string; cards: string[]; potBefore: number | null; actions: ActionLine[] }
export interface HandDetail {
  streets: StreetBlock[];
  players: { seat: number; name: string; position: string | null; isHero: boolean; startStack: number; endStack: number; net: number; folded: boolean; shown: string[] | null }[];
  warnings: string[]; status: HandStatus;
  /** Hero decision points in this hand, and how many have a stored recommendation. */
  heroDecisions: number; withRecommendation: number; followed: number;
}

const STREET_CARDS: Record<string, [number, number]> = { flop: [0, 3], turn: [3, 4], river: [4, 5] };
function actionText(e: HandRecord['events'][number]): string {
  switch (e.kind) {
    case 'post-sb': return `posts small blind ${e.amount}`;
    case 'post-bb': return `posts big blind ${e.amount}`;
    case 'post-ante': return `posts ante ${e.amount}`;
    case 'post-straddle': return `posts straddle ${e.amount}`;
    case 'post-live': return `posts a big blind to enter or return ${e.amount} (live)`;
    case 'post-dead': return `posts a missed small blind ${e.amount} (dead)`;
    case 'bet': return `bets ${e.to}`;
    case 'raise': return `raises to ${e.to}`;
    case 'call': return `calls ${e.amount}`;
    case 'check': return 'checks';
    case 'fold': return 'folds';
    default: return e.kind;
  }
}

export function handDetail(h: HandRecord, decisions: readonly DecisionRecord[]): HandDetail {
  // The last recommendation stored for each decision point (a decision may be recomputed).
  const bySeq = new Map<number, DecisionRecord>();
  for (const d of [...decisions].sort((a, b) => a.ts - b.ts)) bySeq.set(d.eventCount, d);
  const seat = (n: number) => h.seats.find((s) => s.seat === n);
  const streets: StreetBlock[] = [];
  let heroDecisions = 0, withRecommendation = 0, followed = 0;
  for (const e of h.events) {
    let block = streets[streets.length - 1];
    if (!block || block.street !== e.street) {
      const range = STREET_CARDS[e.street];
      block = { street: e.street, cards: range ? h.board.slice(range[0], range[1]) : [], potBefore: e.street === 'preflop' ? null : e.potBefore, actions: [] };
      streets.push(block);
    }
    const s = seat(e.seat);
    const isHero = e.seat === h.heroSeat;
    const voluntary = !e.kind.startsWith('post');
    let rec: ActionLine['rec'] = null;
    if (isHero && voluntary) {
      heroDecisions++;
      const d = bySeq.get(e.seq);
      if (d && d.decision && typeof d.decision.action === 'string') {
        const to = typeof d.decision.to === 'number' ? d.decision.to : null;
        const sameKind = d.decision.action === e.kind;
        const sized = e.kind === 'bet' || e.kind === 'raise';
        const match: RecMatch = !sameKind ? 'different' : sized && to !== null && Math.abs(to - e.to) > 0.011 ? 'same-action-other-size' : 'followed';
        withRecommendation++;
        if (match === 'followed') followed++;
        rec = {
          label: d.decision.label, action: d.decision.action, to, match, execution: d.execution ? d.execution.status : null, equity: d.decision.equity?.equity ?? null,
          candidates: (d.decision.candidates ?? []).map((c) => ({ label: c.label, ev: c.ev, freq: c.freq })), basis: d.decision.basis ?? [], uncertainty: d.decision.uncertainty ?? '',
        };
      }
    }
    block.actions.push({
      seq: e.seq, seat: e.seat, name: s?.name ?? `seat ${e.seat}`, position: s?.position ?? null, isHero, kind: e.kind, text: actionText(e), allIn: e.allIn && e.kind !== 'fold',
      deduced: !!e.inferred, unconfirmed: !!e.uncertain, potBefore: e.potBefore, rec,
    });
  }
  // Streets that were dealt with no action recorded (everyone all-in) still show their cards.
  for (const [name, [a, b]] of Object.entries(STREET_CARDS)) {
    if (h.board.length >= b && !streets.some((s) => s.street === name)) streets.push({ street: name, cards: h.board.slice(a, b), potBefore: null, actions: [] });
  }
  const order = ['preflop', 'flop', 'turn', 'river', 'showdown'];
  streets.sort((x, y) => order.indexOf(x.street) - order.indexOf(y.street));
  return {
    streets, warnings: handWarnings(h), status: handStatus(h), heroDecisions, withRecommendation, followed,
    players: h.seats.filter((s) => s.dealtIn).map((s) => ({ seat: s.seat, name: s.name, position: s.position, isHero: s.seat === h.heroSeat, startStack: s.startStack, endStack: s.endStack, net: s.endStack - s.startStack, folded: s.folded, shown: s.shown })),
  };
}

// ---- tables ------------------------------------------------------------------------------

export interface TableEntry extends TableSummary { label: string; authorized: boolean; active: boolean; stale: boolean }
/**
 * One list out of the three places a table can be known from: stored history, the authorisation list, and the
 * live table tab. `staleDays`: a table not seen for that long (or never recorded) counts as stale.
 */
export function tableEntries(summaries: readonly TableSummary[], settings: Pick<Settings, 'authorizedTables'>, activeTableId: string | null, now: number, staleDays = 7): TableEntry[] {
  const map = new Map<string, TableSummary>();
  for (const s of summaries) map.set(s.tableId, s);
  for (const id of [...settings.authorizedTables, ...(activeTableId ? [activeTableId] : [])]) {
    if (!map.has(id)) map.set(id, { tableId: id, nickname: '', firstSeen: 0, lastSeen: 0, hands: 0, decisions: 0, frames: 0, diagnostics: 0 });
  }
  const auth = new Set(settings.authorizedTables);
  return [...map.values()].map((s) => {
    const active = s.tableId === activeTableId;
    return { ...s, label: s.nickname || (s.tableId === 'imported-log' ? 'Imported log' : shortId(s.tableId)), authorized: auth.has(s.tableId), active, stale: !active && now - s.lastSeen > staleDays * 86400000 };
  }).sort((a, b) => Number(b.active) - Number(a.active) || b.lastSeen - a.lastSeen || a.tableId.localeCompare(b.tableId));
}
export const hasHistory = (t: Pick<TableSummary, 'hands' | 'decisions' | 'frames' | 'diagnostics'>): boolean => t.hands + t.decisions + t.frames + t.diagnostics > 0;

/** What a bulk action would do, for the confirmation text. The active table is never included. */
export interface TablePlan { tables: TableEntry[]; revoke: string[]; purge: string[]; hands: number; decisions: number; frames: number; diagnostics: number }
export function planTables(selected: readonly TableEntry[], what: { revoke: boolean; purge: boolean }): TablePlan {
  const tables = selected.filter((t) => !t.active);
  const purge = what.purge ? tables.filter(hasHistory) : [];
  const sum = (k: 'hands' | 'decisions' | 'frames' | 'diagnostics') => purge.reduce((a, t) => a + t[k], 0);
  return { tables, revoke: what.revoke ? tables.filter((t) => t.authorized).map((t) => t.tableId) : [], purge: purge.map((t) => t.tableId), hands: sum('hands'), decisions: sum('decisions'), frames: sum('frames'), diagnostics: sum('diagnostics') };
}
export function describePlan(p: TablePlan): string[] {
  const out: string[] = [];
  if (p.revoke.length) out.push(`Revoke the authorisation of ${p.revoke.length} table(s). Automatic play there stops being possible until you authorise the table again.`);
  if (p.purge.length) out.push(`Permanently delete the stored history of ${p.purge.length} table(s): ${p.hands} hand(s), ${p.decisions} recommendation(s), ${p.frames} recorded frame(s), ${p.diagnostics} log line(s).`);
  if (!out.length) out.push('Nothing to do for the selected tables.');
  return out;
}

// ---- diagnostics -----------------------------------------------------------------------------

export interface SessionEntry extends SessionSummary { table: string; minutes: number }
export function sessionEntries(sessions: readonly SessionSummary[], nicknames: ReadonlyMap<string, string>): SessionEntry[] {
  return sessions.map((s) => ({ ...s, table: s.tableId ? tableLabel(s.tableId, nicknames) : 'Unknown table', minutes: Math.max(0, Math.round((s.lastWall - s.firstWall) / 60000)) }));
}
