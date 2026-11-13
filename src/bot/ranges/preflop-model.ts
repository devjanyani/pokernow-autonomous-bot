// ============================================================
// Opponent preflop ranges from the observed betting line.
//
// STATUS: HEURISTIC. Ranges are percentile bands of the equity ordering in
// range.ts. The widths come from commonly published opening frequencies by
// number of players left to act; they are approximations, not solver output,
// and are scaled per opponent by measured looseness / raise tendency.
// ============================================================

import { ActionEvent, HandState, seatOf } from '../table/engine';
import { Band, Range, fullRange, rangeFromBands } from './range';
import { NEUTRAL, Tendencies } from './postflop-model';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Approximate first-in raise frequency by number of players still to act behind. */
const OPEN_BY_BEHIND = [1, 0.42, 0.44, 0.28, 0.21, 0.17, 0.145, 0.125, 0.11, 0.1];

export function openFraction(behind: number, headsUpTable: boolean): number {
  if (headsUpTable) return 0.8;
  return OPEN_BY_BEHIND[clamp(Math.round(behind), 1, 9)];
}

const JAM_POINTS: [number, number][] = [[2, 0.75], [5, 0.55], [8, 0.42], [10, 0.36], [15, 0.25], [20, 0.18], [30, 0.1], [50, 0.05], [100, 0.025], [200, 0.015]];
/** Approximate open-jam frequency (one player behind) by effective stack in big blinds. */
export function jamFraction(effBB: number): number {
  if (effBB <= JAM_POINTS[0][0]) return JAM_POINTS[0][1];
  for (let i = 1; i < JAM_POINTS.length; i++) {
    const [x1, y1] = JAM_POINTS[i];
    if (effBB <= x1) {
      const [x0, y0] = JAM_POINTS[i - 1];
      return y0 + ((y1 - y0) * (effBB - x0)) / (x1 - x0);
    }
  }
  return JAM_POINTS[JAM_POINTS.length - 1][1];
}
/** Tightening of a jam range for extra players left to act (1 behind = 1). */
export const JAM_BEHIND_MULT = [1, 1, 0.66, 0.5, 0.4, 0.33, 0.28, 0.24, 0.21, 0.19];

export type PreflopLineKind =
  | 'unacted' | 'bb-check' | 'limp' | 'open' | 'iso' | 'call-open' | 'bb-defend'
  | '3bet' | 'call-3bet' | '4bet' | 'call-4bet' | '5bet' | 'jam' | 'rejam' | 'call-jam';

export interface PreflopLine {
  kind: PreflopLineKind;
  /** Open fraction of this seat's own position. */
  selfOpen: number;
  /** Open fraction of the first raiser's position (for lines that respond to a raise). */
  openerOpen: number;
  /** Stack in big blinds at the start of the hand. */
  stackBB: number;
  behind: number;
}

/** Classify a seat's preflop line from the event log. */
export function preflopLine(h: HandState, seat: number): PreflopLine {
  const s = seatOf(h, seat);
  const hu = h.seats.filter((x) => x.dealtIn).length === 2;
  const selfOpen = openFraction(s.pos!.behindPreflop, hu);
  const stackBB = s.startStack / h.bigBlind;
  let raises = 0, limpers = 0;
  let openerOpen = selfOpen;
  let kind: PreflopLineKind = 'unacted';
  for (const e of h.events as ActionEvent[]) {
    if (e.street !== 'preflop' || e.kind.startsWith('post')) continue;
    if (e.seat === seat) {
      if (e.kind === 'check') kind = 'bb-check';
      else if (e.kind === 'raise') {
        const committedFrac = (e.to + (s.totalCommit - s.streetCommit)) / Math.max(1e-9, s.startStack);
        if (e.allIn || committedFrac > 0.5) kind = raises === 0 ? 'jam' : 'rejam';
        else kind = raises === 0 ? (limpers > 0 ? 'iso' : 'open') : raises === 1 ? '3bet' : raises === 2 ? '4bet' : '5bet';
      } else if (e.kind === 'call') {
        const bigCall = e.allIn || e.to / Math.max(1e-9, s.startStack) > 0.4;
        if (raises === 0) kind = 'limp';
        else if (bigCall && e.to > 12 * h.bigBlind) kind = 'call-jam';
        else kind = raises === 1 ? (s.pos!.isBigBlind ? 'bb-defend' : 'call-open') : raises === 2 ? 'call-3bet' : 'call-4bet';
      }
    }
    if (e.kind === 'raise') {
      if (raises === 0) openerOpen = openFraction(seatOf(h, e.seat).pos!.behindPreflop, hu);
      raises++;
    } else if (e.kind === 'call' && raises === 0) limpers++;
  }
  return { kind, selfOpen, openerOpen, stackBB, behind: s.pos!.behindPreflop };
}

export function bandsForLine(line: PreflopLine, t: Tendencies = NEUTRAL): Band[] {
  const L = t.looseness, A = t.preflopAggression;
  const f = line.openerOpen, own = line.selfOpen;
  switch (line.kind) {
    case 'unacted': return [{ lo: 0, hi: 1, w: 1 }];
    case 'bb-check': return [{ lo: 0, hi: 0.08, w: 0.3 }, { lo: 0.08, hi: 1, w: 1 }];
    case 'limp': return [{ lo: 0, hi: 0.06, w: 0.25 }, { lo: 0.06, hi: clamp(0.45 * L, 0.2, 0.8), w: 1 }];
    case 'open': return [{ lo: 0, hi: clamp(own * A, 0.03, 0.95), w: 1 }];
    case 'iso': return [{ lo: 0, hi: clamp(0.6 * own * A, 0.03, 0.6), w: 1 }];
    case 'call-open': { const w = clamp(0.55 * f * L, 0.05, 0.35); return [{ lo: 0, hi: 0.03, w: 0.3 }, { lo: 0.03, hi: 0.03 + w, w: 1 }]; }
    case 'bb-defend': { const w = clamp((1.2 * f + 0.12) * L, 0.12, 0.8); return [{ lo: 0, hi: 0.04, w: 0.25 }, { lo: 0.04, hi: 0.04 + w, w: 1 }]; }
    case '3bet': { const v = clamp(0.3 * f * A, 0.02, 0.14); return [{ lo: 0, hi: v, w: 1 }, { lo: v * 2.5, hi: v * 4, w: 0.3 }]; }
    case 'call-3bet': { const w = clamp(0.5 * own * L, 0.04, 0.22); return [{ lo: 0, hi: 0.02, w: 0.35 }, { lo: 0.02, hi: 0.02 + w, w: 1 }]; }
    case '4bet': return [{ lo: 0, hi: clamp(0.028 * A, 0.015, 0.06), w: 1 }, { lo: 0.06, hi: 0.09, w: 0.2 }];
    case 'call-4bet': return [{ lo: 0, hi: 0.01, w: 0.5 }, { lo: 0.01, hi: 0.06, w: 1 }];
    case '5bet': return [{ lo: 0, hi: 0.02, w: 1 }];
    case 'jam': return [{ lo: 0, hi: clamp(jamFraction(line.stackBB) * JAM_BEHIND_MULT[clamp(line.behind, 1, 9)] * A, 0.015, 0.9), w: 1 }];
    case 'rejam': return [{ lo: 0, hi: clamp(jamFraction(line.stackBB) * 0.5 * A, 0.015, 0.6), w: 1 }];
    case 'call-jam': return [{ lo: 0, hi: clamp(jamFraction(line.stackBB) * 0.6 * L, 0.02, 0.5), w: 1 }];
  }
}

/** Estimated preflop range for a seat given everything it has done so far this hand. */
export function opponentPreflopRange(h: HandState, seat: number, t: Tendencies = NEUTRAL): { range: Range; line: PreflopLine } {
  const line = preflopLine(h, seat);
  if (line.kind === 'unacted') return { range: fullRange(), line };
  return { range: rangeFromBands(bandsForLine(line, t)), line };
}
