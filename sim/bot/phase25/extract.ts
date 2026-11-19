// ============================================================
// Phase 2.5: real hand histories -> normalised decision opportunities.
//
//   npx tsx sim/bot/phase25/extract.ts [--data data/phh-handhq] [--out data/phh-handhq/derived]
//
// Reads every .phhs file listed in the download manifest (fetch-handhq.ts), parses it (importers.ts parsePhhs),
// replays every hand through the rules engine (validate.ts replayHand) and keeps a hand only when it is a cash
// game of no-limit hold'em with exactly a small and a big blind, it is not from a heads-up table (see below), it
// replays without a rules error, and chips are conserved. Duplicates (same site and hand number) are dropped.
//
// Output (git-ignored, under data/):
//   opps.jsonl      one line per decision after the flop: the state the player acted in, as public features, and
//                   what the player did. Opportunity denominators follow the rules engine's legal actions.
//   river.jsonl     one line per CALLED river bet or raise: whether the bettor's cards were revealed, and if so
//                   the cards; the caller's cards when shown; and the line that led there.
//   extract.json    counts: files, sections, kept, rejected by reason, duplicates, opportunities, showdowns.
//
// Never used as known: cards that were not shown. Player ids are the dataset's own anonymised hashes; they stay
// in data/ (not in git) and are used only to group players for the leakage-free split.
//
// Heads-up tables are excluded: in the HandHQ conversion every heads-up hand lists p1 as the small blind but has p2
// act first before the flop, which the rules do not allow, so either the blinds or the order are wrong and the
// hand cannot be trusted (282 of 1,000 hands in the first file checked).
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { parseCardStrict } from '../../../src/bot/cards';
import { HandState, legalActions, potTotal } from '../../../src/bot/table/engine';
import { parsePhhs } from '../data/importers';
import type { HandHistory } from '../data/schema';
import { replayHand } from '../data/validate';
import { DATASET_VERSION, HANDHQ_FOLDERS } from '../data/fetch-handhq';

export type OppType = 'open' | 'bet' | 'raise' | 'xr' | 'cold';
export interface Opp {
  /** Hand key (site:hand number), file index, action index within the hand. */
  k: string; f: number; i: number;
  day: number; venue: string; stake: string; seats: number; player: string;
  street: 'flop' | 'turn' | 'river';
  /** Players still in the hand (2 = heads-up pot). */
  n: number;
  /** open = may bet (nothing to call); bet = facing a bet; raise = the player's own bet or raise was raised by a player who had not checked to it; xr = the player's bet was check-raised; cold = facing two or more bets without having bet. */
  type: OppType;
  /** Facing: the amount to call over the pot before it. Open: 0. */
  frac: number;
  /** The player acts last after the flop among those still in the hand. */
  ip: boolean;
  /** The player made the last bet or raise of the previous street (the preflop raiser on the flop). */
  agg: boolean;
  /** Bets and raises already made on this street. */
  level: number;
  /** Effective stack (the player's against the largest other) over the pot; null when the site did not record stacks. */
  spr: number | null;
  /** The player could raise (facing) / bet (open) at all. */
  canAgg: boolean;
  act: 'check' | 'bet' | 'fold' | 'call' | 'raise';
  /** A bet or raise: the amount added over the call, over the pot after calling. */
  size?: number;
}
export interface RiverRec {
  k: string; f: number; i: number; day: number; venue: string; stake: string; player: string;
  /** The bettor's and the caller's cards when shown (else null). Board of five. */
  bettor: string | null; caller: string | null; board: string;
  frac: number; level: number; n: number;
  /** Bettor's actions on the flop and turn ("b" bet/raise, "c" call, "x" check), e.g. "b/x". */
  line: string;
}

function stakeOf(folder: string): { venue: string; stake: string } {
  const f = HANDHQ_FOLDERS.find((x) => folder.startsWith(x.folder.split('/')[0]));
  return { venue: f?.site ?? folder.split('-')[0], stake: f?.stake ?? '?' };
}

/**
 * The decisions after the flop of one hand. `onOpp` is called with the live state just before each decision (for
 * model predictions); its results must be discarded when the hand turns out not to be ok.
 */
export function opportunities(h: HandHistory, fileIdx: number, onRiverCall?: (r: RiverRec) => void, onOpp?: (st: HandState, o: Opp) => void): { opps: Opp[]; ok: boolean; reason: string } {
  const opps: Opp[] = [];
  const key = `${h.meta.venue ?? '?'}:${h.meta.hand ?? h.handId}`;
  const day = Number(h.meta.day ?? 0);
  const { venue, stake } = { venue: String(h.meta.venue ?? '?'), stake: String(h.meta.stake ?? '?') };
  const pending: { bettor: number; i: number; frac: number; level: number; n: number; line: string }[] = [];
  const lines = new Map<number, string[]>();
  const rep = replayHand(h, (st: HandState, i, a) => {
    if (st.street === 'preflop') return;
    const la = legalActions(st)!;
    const live = st.seats.filter((s) => s.dealtIn && !s.folded);
    const me = st.seats.find((s) => s.seat === a.seat)!;
    const pot = potTotal(st);
    const facing = la.callAmount > 1e-9;
    const evs = st.events.filter((e) => e.street === st.street && !e.kind.startsWith('post'));
    const lastAgg = st.aggressor[st.street];
    const aggChecked = lastAgg !== null && evs.some((e) => e.seat === lastAgg && e.kind === 'check');
    const ownBet = evs.some((e) => e.seat === a.seat && (e.kind === 'bet' || e.kind === 'raise'));
    const type: OppType = !facing ? 'open' : st.raisesThisStreet <= 1 ? 'bet' : !ownBet ? 'cold' : aggChecked ? 'xr' : 'raise';
    const prev = st.street === 'flop' ? 'preflop' : st.street === 'turn' ? 'flop' : 'turn';
    const order = Math.max(...live.map((s) => s.pos!.postflopOrder));
    const others = live.filter((s) => s.seat !== a.seat).map((s) => s.stack + s.streetCommit);
    const eff = Math.min(me.stack + me.streetCommit, Math.max(...others, 0));
    const p = String(h.seats[a.seat]?.name ?? `seat${a.seat}`);
    const o: Opp = {
      k: key, f: fileIdx, i, day, venue, stake, seats: Number(h.meta.seat_count ?? h.seats.length), player: p,
      street: st.street as Opp['street'], n: live.length, type, frac: facing ? la.callAmount / Math.max(1e-9, pot - la.callAmount) : 0,
      ip: me.pos!.postflopOrder === order, agg: st.aggressor[prev] === a.seat, level: st.raisesThisStreet, spr: h.meta.stacksUnknown ? null : eff / Math.max(1e-9, pot),
      canAgg: la.canRaise, act: a.kind,
    };
    if (a.kind === 'bet' || a.kind === 'raise') o.size = ((a.to ?? 0) - st.currentBet) / Math.max(1e-9, pot + la.callAmount);
    opps.push(o);
    onOpp?.(st, o);
    const l = lines.get(a.seat) ?? [];
    if (!l[({ flop: 0, turn: 1, river: 2 } as const)[st.street]]) { l[({ flop: 0, turn: 1, river: 2 } as const)[st.street]] = a.kind === 'bet' || a.kind === 'raise' ? 'b' : a.kind === 'call' ? 'c' : a.kind === 'check' ? 'x' : 'f'; lines.set(a.seat, l); }
    // River: remember bets; a call of the last bet makes a called-river record.
    if (st.street === 'river') {
      if (a.kind === 'bet' || a.kind === 'raise') pending.push({ bettor: a.seat, i, frac: ((a.to ?? 0) - st.currentBet) / Math.max(1e-9, pot + la.callAmount), level: st.raisesThisStreet + 1, n: live.length, line: (lines.get(a.seat) ?? []).slice(0, 2).map((x) => x ?? '-').join('/') });
      if (a.kind === 'call' && pending.length && onRiverCall) {
        const b = pending[pending.length - 1];
        const hb = h.holes[b.bettor], hc = h.holes[a.seat];
        onRiverCall({ k: key, f: fileIdx, i: b.i, day, venue, stake, player: String(h.seats[b.bettor]?.name ?? ''), bettor: hb ? hb.join('') : null, caller: hc ? hc.join('') : null, board: h.board.join(''), frac: b.frac, level: b.level, n: b.n, line: b.line });
      }
    }
  });
  const err = rep.issues.find((x) => x.level === 'error');
  if (err || !rep.state) return { opps: [], ok: false, reason: err ? err.message.replace(/\d+(\.\d+)?/g, '#').replace(/"[^"]*"/g, '"…"').slice(0, 80) : 'no state' };
  void venue; void stake;
  return { opps, ok: true, reason: '' };
}

export interface ExtractStats {
  dataset: string; files: number; sections: number; parsed: number; kept: number; stacksUnknownHands: number; headsUpTable: number; duplicate: number;
  rejected: Record<string, number>; byVenue: Record<string, number>; days: Record<number, number>; players: number;
}

/**
 * Every usable hand of the downloaded sample, in manifest order: parsed, heads-up tables and duplicates removed.
 * `onHand` replays it (normally through `opportunities`) and says whether it was ok; the counts are kept here.
 */
export function forEachHand(dataDir: string, onHand: (h: HandHistory, fileIdx: number) => { ok: boolean; reason: string }, progress = true): ExtractStats {
  const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'manifest.json'), 'utf8')) as { files: { folder: string; file: string; sha256: string }[]; dataset: string };
  const seen = new Set<string>();
  const players = new Set<string>();
  const stat: ExtractStats = { dataset: manifest.dataset ?? DATASET_VERSION, files: 0, sections: 0, parsed: 0, kept: 0, stacksUnknownHands: 0, headsUpTable: 0, duplicate: 0, rejected: {}, byVenue: {}, days: {}, players: 0 };
  for (const [fi, mf] of manifest.files.entries()) {
    const text = fs.readFileSync(path.join(dataDir, mf.folder, mf.file), 'utf8');
    const { venue, stake } = stakeOf(mf.folder);
    const r = parsePhhs(text, 'handhq', `${fi}`);
    stat.files++; stat.sections += r.sections; stat.parsed += r.hands.length;
    for (const iss of r.issues) { const k = `parse: ${iss.message.slice(0, 60)}`; stat.rejected[k] = (stat.rejected[k] ?? 0) + 1; }
    for (const h of r.hands) {
      h.meta.stake = stake; h.meta.venue = h.meta.venue ?? venue;
      if (Number(h.meta.seat_count ?? h.seats.length) <= 2 || h.seats.length <= 2) { stat.headsUpTable++; continue; }
      const key = `${h.meta.venue}:${h.meta.hand ?? h.handId}`;
      if (seen.has(key)) { stat.duplicate++; continue; }
      seen.add(key);
      const res = onHand(h, fi);
      if (!res.ok) { stat.rejected[res.reason] = (stat.rejected[res.reason] ?? 0) + 1; continue; }
      stat.kept++;
      if (h.meta.stacksUnknown) stat.stacksUnknownHands++;
      stat.byVenue[`${h.meta.venue} ${stake}`] = (stat.byVenue[`${h.meta.venue} ${stake}`] ?? 0) + 1;
      stat.days[Number(h.meta.day)] = (stat.days[Number(h.meta.day)] ?? 0) + 1;
      for (const s of h.seats) if (s.name) players.add(s.name);
    }
    if (progress && (fi + 1) % 20 === 0) console.error(`${fi + 1} / ${manifest.files.length} files, ${stat.kept} hands kept`);
  }
  stat.players = players.size;
  return stat;
}

async function main(): Promise<void> {
  const argS = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
  const dataDir = argS('data', 'data/phh-handhq'), outDir = argS('out', path.join(dataDir, 'derived'));
  fs.mkdirSync(outDir, { recursive: true });
  const oppOut = fs.openSync(path.join(outDir, 'opps.jsonl'), 'w'), rivOut = fs.openSync(path.join(outDir, 'river.jsonl'), 'w');
  const extra = { opps: 0, oppsByType: {} as Record<string, number>, riverCalled: 0, riverBettorShown: 0, riverBothShown: 0 };
  const stat = forEachHand(dataDir, (h, fi) => {
    const riv: RiverRec[] = [];
    const ex = opportunities(h, fi, (x) => riv.push(x));
    if (!ex.ok) return ex;
    for (const o of ex.opps) { fs.writeSync(oppOut, JSON.stringify(o) + '\n'); extra.opps++; const t = `${o.street} ${o.type}`; extra.oppsByType[t] = (extra.oppsByType[t] ?? 0) + 1; }
    for (const x of riv) { fs.writeSync(rivOut, JSON.stringify(x) + '\n'); extra.riverCalled++; if (x.bettor) extra.riverBettorShown++; if (x.bettor && x.caller) extra.riverBothShown++; }
    return ex;
  });
  fs.closeSync(oppOut); fs.closeSync(rivOut);
  const all = { ...stat, ...extra };
  fs.writeFileSync(path.join(outDir, 'extract.json'), JSON.stringify(all, null, 1));
  console.log(JSON.stringify({ ...all, rejected: Object.entries(stat.rejected).sort((a, b) => b[1] - a[1]).slice(0, 8) }, null, 1));
  void parseCardStrict;
}

if (process.argv[1] && /extract\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
