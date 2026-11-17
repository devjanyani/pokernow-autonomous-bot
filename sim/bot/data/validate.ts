// ============================================================
// Validation of imported data. Nothing is repaired and nothing is guessed: a record either passes, or it is
// reported with the reason and left out by the importer.
//
//   validateSource   provenance is complete (origin, licence, date, hashes; approval where required)
//   validateHand     cards are real and distinct, and the action replays through the bot's own rules engine
//                    with every action legal and every chip accounted for
//   validateExample  a labelled decision is internally consistent (label among the legal moves, cards distinct)
// ============================================================

import { parseCardStrict } from '../../../src/bot/cards';
import { applyAction, awaitingBoard, createHand, dealBoard, HandState, legalActions, totalChips, validateAction } from '../../../src/bot/table/engine';
import type { DecisionExample, HandHistory, Issue, SourceInfo } from './schema';

const err = (where: string, message: string): Issue => ({ level: 'error', where, message });
const warn = (where: string, message: string): Issue => ({ level: 'warning', where, message });
const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) && Number.isFinite(Date.parse(s));

export function validateSource(s: SourceInfo): Issue[] {
  const out: Issue[] = [];
  const w = `source ${s?.id ?? '?'}`;
  if (!s || typeof s !== 'object') return [err('source', 'not an object')];
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(s.id ?? '')) out.push(err(w, 'id must be lower-case letters, digits and dashes'));
  for (const k of ['name', 'origin', 'licence', 'population'] as const) if (typeof s[k] !== 'string' || !s[k].trim()) out.push(err(w, `${k} is required`));
  if (typeof s.licenceNotes !== 'string') out.push(err(w, 'licenceNotes is required (may be empty only for own logs and synthetic data)'));
  if (!['solver-labels', 'human-hands', 'program-hands', 'own-logs', 'synthetic'].includes(s.kind)) out.push(err(w, `unknown kind "${String(s.kind)}"`));
  if (!['solver-dominant-action', 'human-action', 'program-action', 'none'].includes(s.labelSemantics)) out.push(err(w, `unknown labelSemantics "${String(s.labelSemantics)}"`));
  if (!isDate(s.retrieved)) out.push(err(w, 'retrieved must be an ISO date'));
  if (!Array.isArray(s.caveats)) out.push(err(w, 'caveats must be a list (empty only when there really are none)'));
  // What a label means must fit the kind of source: nobody's play is a solver label.
  if ((s.kind === 'human-hands' || s.kind === 'own-logs') && s.labelSemantics !== 'human-action' && s.labelSemantics !== 'none') out.push(err(w, 'hands played by people must be labelled human-action (or none), never as solver output'));
  if (s.kind === 'program-hands' && s.labelSemantics === 'solver-dominant-action') out.push(err(w, 'hands played by a program are program-action; a strong program\'s play is still not a solver label'));
  if (s.kind === 'solver-labels' && s.labelSemantics !== 'solver-dominant-action') out.push(err(w, 'solver-labels must use solver-dominant-action'));
  const external = s.kind !== 'own-logs' && s.kind !== 'synthetic';
  if (external && s.access !== 'needs-approval') out.push(err(w, 'data obtained from elsewhere must be marked needs-approval'));
  if (external && !(s.licenceNotes ?? '').trim()) out.push(err(w, 'licenceNotes must say what is and is not known about the right to use this data'));
  if (s.access === 'needs-approval' && (!s.approvedBy?.trim() || !isDate(s.approvedOn))) out.push(err(w, 'not approved: approvedBy and approvedOn are required before this source may be imported'));
  if (!Array.isArray(s.files) || !s.files.length) out.push(err(w, 'at least one file with its SHA-256 is required'));
  else for (const f of s.files) {
    if (typeof f.path !== 'string' || !f.path || /^([a-zA-Z]:|[\\/])|\.\./.test(f.path)) out.push(err(w, `file path "${String(f.path)}" must be relative and stay inside the data folder`));
    if (!/^[0-9a-f]{64}$/.test(f.sha256 ?? '')) out.push(err(w, `file ${f.path}: sha256 must be 64 hex digits`));
    if (!(Number.isInteger(f.bytes) && f.bytes >= 0)) out.push(err(w, `file ${f.path}: bytes must be a whole number`));
  }
  return out;
}

function cardIssues(where: string, cards: string[]): Issue[] {
  const out: Issue[] = [];
  const seen = new Set<number>();
  for (const c of cards) {
    const id = parseCardStrict(c);
    if (id === null) { out.push(err(where, `"${c}" is not a card`)); continue; }
    if (seen.has(id)) out.push(err(where, `card ${c} appears twice`));
    seen.add(id);
  }
  return out;
}

export interface Replay { state: HandState | null; issues: Issue[] }

/** Replay a hand through the rules engine. The board cards are dealt when the betting of a street closes. */
export function replayHand(h: HandHistory): Replay {
  const where = `hand ${h.handId}`;
  const issues: Issue[] = [];
  if (!Array.isArray(h.seats) || h.seats.length < 2 || h.seats.length > 10) return { state: null, issues: [err(where, 'needs 2 to 10 seats')] };
  if (!(h.bigBlind > 0) || !(h.smallBlind >= 0) || h.smallBlind > h.bigBlind) return { state: null, issues: [err(where, 'blinds are not usable')] };
  if (h.seats.some((s) => !(s.stack > 0))) return { state: null, issues: [err(where, 'every seat needs a positive starting stack')] };
  if (![0, 3, 4, 5].includes(h.board.length)) issues.push(err(where, `a board of ${h.board.length} cards is not possible`));
  const holes = h.holes ?? [];
  if (holes.length !== h.seats.length) issues.push(err(where, 'holes must have one entry per seat (null when unknown)'));
  issues.push(...cardIssues(where, [...h.board, ...holes.flatMap((x) => x ?? [])]));
  if (issues.some((i) => i.level === 'error')) return { state: null, issues };
  let state: HandState;
  try {
    state = createHand({ handId: h.handId, buttonSeat: h.buttonSeat, smallBlind: h.smallBlind, bigBlind: h.bigBlind, ante: h.ante || 0, tableSeats: Math.max(2, h.seats.length), seats: h.seats.map((s) => ({ seat: s.seat, playerId: s.name ?? `seat${s.seat}`, stack: s.stack })) });
  } catch (e) { return { state: null, issues: [...issues, err(where, `cannot start the hand: ${(e as Error).message}`)] }; }
  const chips = totalChips(state);
  const board = h.board.map((c) => parseCardStrict(c) as number);
  const deal = (): boolean => {
    while (awaitingBoard(state)) {
      const need = state.street === 'preflop' ? 3 : 1;
      if (board.length < state.board.length + need) return false;
      dealBoard(state, board.slice(state.board.length, state.board.length + need));
    }
    return true;
  };
  for (let i = 0; i < h.actions.length; i++) {
    const a = h.actions[i];
    deal();
    if (state.toAct === null) { issues.push(err(where, `action ${i + 1} (${a.kind} by seat ${a.seat}) comes after the betting is over`)); return { state, issues }; }
    if (state.toAct !== a.seat) { issues.push(err(where, `action ${i + 1}: seat ${a.seat} acts, but it is seat ${state.toAct}'s turn`)); return { state, issues }; }
    const input = { seat: a.seat, kind: a.kind, to: a.kind === 'bet' || a.kind === 'raise' ? a.to : undefined };
    const bad = validateAction(state, input);
    if (bad) { issues.push(err(where, `action ${i + 1} (${a.kind}${a.to !== undefined ? ` to ${a.to}` : ''} by seat ${a.seat}) is not legal: ${bad.code}`)); return { state, issues }; }
    applyAction(state, input);
  }
  deal();
  if (Math.abs(totalChips(state) - chips) > 1e-6) issues.push(err(where, 'chips are not conserved'));
  if (state.board.length < board.length) issues.push(err(where, `${board.length} board cards are given but the action only reaches ${state.board.length}`));
  if (state.toAct !== null) issues.push(warn(where, `the record stops with seat ${state.toAct} still to act`));
  void legalActions;
  return { state, issues };
}

export const validateHand = (h: HandHistory): Issue[] => replayHand(h).issues;

export function validateExample(e: DecisionExample): Issue[] {
  const where = `example ${e.id}`;
  const out: Issue[] = cardIssues(where, [...e.heroCards, ...e.board]);
  const want = { preflop: 0, flop: 3, turn: 4, river: 5 }[e.street];
  if (want === undefined) out.push(err(where, `unknown street "${String(e.street)}"`));
  else if (e.board.length !== want) out.push(err(where, `${e.street} needs ${want} board cards, has ${e.board.length}`));
  if (!(e.pot > 0)) out.push(err(where, 'pot must be positive'));
  if (!e.legal.length) out.push(err(where, 'no legal moves listed'));
  if (!e.legal.some((m) => m.kind === e.label.kind)) out.push(err(where, `the label (${e.label.kind}) is not among the legal moves (${e.legal.map((m) => m.kind).join(', ')})`));
  if (e.legal.some((m) => m.kind === 'check') && e.legal.some((m) => m.kind === 'call')) out.push(err(where, 'check and call cannot both be legal'));
  if ((e.label.kind === 'bet' || e.label.kind === 'raise') && !(e.label.amount !== undefined && e.label.amount > 0)) out.push(err(where, 'a bet or raise label needs an amount'));
  if (e.reconstruction === 'full') { if (!e.history) out.push(err(where, 'reconstruction is "full" but no history is attached')); else out.push(...validateHand(e.history)); }
  return out;
}
