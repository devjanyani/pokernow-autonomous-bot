// ============================================================
// Chronological action timeline of one reconstructed hand, with the evidence
// behind every entry. Built only from engine events and their EventMeta:
// nothing is added for display.
// ============================================================

import type { EventMeta, EventSource } from '../adapter/tracker';
import type { HandState } from '../table/engine';

export interface TimelineEntry {
  seq: number;
  street: string;
  seat: number;
  name: string;
  position: string | null;
  kind: string;
  /** Chips added by this action. */
  amount: number;
  /** Seat's total in front on this street after the action. */
  to: number;
  /** Seat's total in the pot this hand after the action (null when unknown). */
  totalCommit: number | null;
  stackAfter: number | null;
  allIn: boolean;
  /** "CO: Raise to 8" */
  text: string;
  source: EventSource | 'log';
  /** Deduced rather than displayed. */
  inferred: boolean;
  /** Deduced and not confirmed. */
  uncertain: boolean;
  note: string | null;
  ts: number | null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function buildTimeline(h: HandState, meta: readonly EventMeta[] = [], fromSeq = 0): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const e of h.events) {
    if (e.seq < fromSeq) continue;
    const s = h.seats.find((x) => x.seat === e.seat);
    const m = meta[e.seq];
    const who = s?.pos?.label ?? `seat ${e.seat}`;
    let what: string;
    switch (e.kind) {
      case 'post-sb': what = `Posts small blind ${e.amount}`; break;
      case 'post-bb': what = `Posts big blind ${e.amount}`; break;
      case 'post-ante': what = `Posts ante ${e.amount}`; break;
      case 'post-straddle': what = `Posts straddle ${e.amount}`; break;
      case 'post-live': what = `Posts a big blind to enter or return ${e.amount} (live)`; break;
      case 'post-dead': what = `Posts a missed small blind ${e.amount} (dead)`; break;
      case 'bet': what = `Bet ${e.to}`; break;
      case 'raise': what = `Raise to ${e.to}`; break;
      case 'call': what = `Call ${e.amount}`; break;
      default: what = cap(e.kind);
    }
    if (e.allIn && e.kind !== 'fold') what += ' (all-in)';
    out.push({
      seq: e.seq, street: e.street, seat: e.seat, name: s?.name ?? `seat ${e.seat}`, position: s?.pos?.label ?? null, kind: e.kind,
      amount: e.amount, to: e.to, totalCommit: m?.totalCommit ?? null, stackAfter: m?.stackAfter ?? null, allIn: e.allIn,
      text: `${who}: ${what}`, source: m?.source ?? 'log', inferred: m?.inferred ?? false, uncertain: m?.uncertain ?? false, note: m?.note ?? null, ts: m?.ts ?? null,
    });
  }
  return out;
}

/** Plain-text timeline grouped by street. Deduced entries are marked. */
export function formatTimeline(entries: readonly TimelineEntry[], withNames = true): string {
  const lines: string[] = [];
  let street = '';
  for (const e of entries) {
    if (e.street !== street) { street = e.street; lines.push(`${cap(street)}:`); }
    const mark = e.uncertain ? ' [deduced, UNCONFIRMED]' : e.inferred ? ' [deduced]' : '';
    lines.push(`- ${e.text}${withNames ? ` (${e.name}, seat ${e.seat})` : ''}${mark}${e.note ? ` (${e.note})` : ''}`);
  }
  return lines.join('\n');
}
