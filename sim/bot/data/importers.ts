// ============================================================
// Importers: source text -> the common schema (schema.ts). Pure functions of their input; no file or network
// access here. Each returns the records it could read AND an issue for every row or file it could not, so a
// partly unreadable source is visible as such.
//
// STATUS: written from the published format descriptions and exercised on small SYNTHETIC fixtures
// (tests/bot/fixtures/data, written by hand for this project, not taken from any dataset). They have not yet
// been run on the real PokerBench or PHH files, which are not on this machine. Expect adjustments on first
// contact with real files; the validators will show where.
// ============================================================

import { replayLog } from '../../../src/bot/adapter/pokernow/log';
import { cardStr } from '../../../src/bot/cards';
import type { DataAction, DataActionKind, DecisionExample, HandHistory, Issue } from './schema';

const err = (where: string, message: string): Issue => ({ level: 'error', where, message });

// ---- PokerBench (CSV) ---------------------------------------------------------------------------
// Columns used (postflop files): preflop_action, board_flop, board_turn, board_river, aggressor_position,
// postflop_action, evaluation_at, available_moves, pot_size, hero_position, holding, correct_decision.
// Amounts are in big blinds. One preferred action per row; no EV and no frequencies (see the roadmap).

/** Split one CSV line; quoted fields may contain commas. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const cardsOf = (s: string): string[] => { const t = s.trim(); const out: string[] = []; for (let i = 0; i + 1 < t.length; i += 2) out.push(t[i].toUpperCase() + t[i + 1].toLowerCase()); return t.length % 2 ? [...out, t.slice(-1)] : out; };
function move(text: string): { kind: DataActionKind; amount?: number } | null {
  const m = /^\s*(fold|check|call|bet|raise)\b\s*(\d+(?:\.\d+)?)?/i.exec(text);
  if (!m) return null;
  return { kind: m[1].toLowerCase() as DataActionKind, ...(m[2] ? { amount: Number(m[2]) } : {}) };
}

export function parsePokerBenchPostflop(csv: string, source: string): { examples: DecisionExample[]; issues: Issue[] } {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const issues: Issue[] = [];
  if (!lines.length) return { examples: [], issues: [err(source, 'empty file')] };
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const need = ['preflop_action', 'board_flop', 'board_turn', 'board_river', 'aggressor_position', 'postflop_action', 'evaluation_at', 'available_moves', 'pot_size', 'hero_position', 'holding', 'correct_decision'];
  const missing = need.filter((k) => !header.includes(k));
  if (missing.length) return { examples: [], issues: [err(source, `missing column(s): ${missing.join(', ')}`)] };
  const col = (cols: string[], k: string) => (cols[header.indexOf(k)] ?? '').trim();
  const examples: DecisionExample[] = [];
  for (let n = 1; n < lines.length; n++) {
    const cols = splitCsvLine(lines[n]);
    const where = `${source} row ${n}`;
    const street = col(cols, 'evaluation_at').toLowerCase();
    if (street !== 'flop' && street !== 'turn' && street !== 'river') { issues.push(err(where, `evaluation_at "${col(cols, 'evaluation_at')}" is not a postflop street`)); continue; }
    const board = [...cardsOf(col(cols, 'board_flop')), ...(street !== 'flop' ? cardsOf(col(cols, 'board_turn')) : []), ...(street === 'river' ? cardsOf(col(cols, 'board_river')) : [])];
    const hole = cardsOf(col(cols, 'holding'));
    if (hole.length !== 2) { issues.push(err(where, `holding "${col(cols, 'holding')}" is not two cards`)); continue; }
    const moves = col(cols, 'available_moves').replace(/^\[|\]$/g, '').split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).map(move);
    if (!moves.length || moves.some((m) => m === null)) { issues.push(err(where, `available_moves "${col(cols, 'available_moves')}" could not be read`)); continue; }
    const label = move(col(cols, 'correct_decision'));
    if (!label) { issues.push(err(where, `correct_decision "${col(cols, 'correct_decision')}" could not be read`)); continue; }
    const pos = col(cols, 'hero_position');
    if (pos !== 'IP' && pos !== 'OOP') { issues.push(err(where, `hero_position "${pos}" is neither IP nor OOP`)); continue; }
    examples.push({
      source, id: `${source}#${n}`, street, heroCards: [hole[0], hole[1]], board, pot: Number(col(cols, 'pot_size')), position: pos,
      legal: moves as { kind: DataActionKind; amount?: number }[], label, labelSemantics: 'solver-dominant-action',
      // The preflop line is kept verbatim: turning it into seats and stacks needs checking against real rows first.
      reconstruction: 'partial',
      raw: { preflop_action: col(cols, 'preflop_action'), postflop_action: col(cols, 'postflop_action'), aggressor_position: col(cols, 'aggressor_position') },
    });
  }
  return { examples, issues };
}

// ---- PHH (one hand per file) ----------------------------------------------------------------------
// Fields used: variant, antes, blinds_or_straddles, starting_stacks, actions. Actions:
//   "d dh p1 AsKs"  deal hole cards ("????" when hidden)     "p3 cbr 300"  bet or raise TO 300
//   "p1 f"          fold                                      "p2 cc"       check or call
//   "d db Jc3d5c"   deal board cards                          "p1 sm AsKs"  show (or muck) at showdown
// Players are p1..pn in table order. The blinds array says who posts what; the button is derived from it.

function tomlValue(text: string): unknown {
  const t = text.trim();
  if (/^'.*'$/.test(t) || /^".*"$/.test(t)) return t.slice(1, -1);
  if (t === 'true' || t === 'false') return t === 'true';
  // TOML local times and dates (HandHQ files write `time = 00:00:03`): kept as text.
  if (/^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(t) || /^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  // `inf` (HandHQ iPoker files: stacks not recorded) is read as Infinity; the caller decides what to do with it.
  if (t.startsWith('[')) {
    // Only a bare list element `inf` is replaced, never text inside a quoted string.
    const json = t.replace(/'/g, '"').replace(/,\s*\]/g, ']').replace(/(^\[|,)(\s*)inf(?=\s*[,\]])/g, '$1$21e999');
    return JSON.parse(json);
  }
  const n = Number(t);
  if (Number.isFinite(n)) return n;
  throw new Error(`cannot read value ${t.slice(0, 40)}`);
}

export function parsePhh(text: string, source: string, handId: string): { hand: HandHistory | null; issues: Issue[] } {
  const where = `${source} ${handId}`;
  const f: Record<string, unknown> = {};
  try {
    // A value may run over several lines (the actions list): join until the brackets balance.
    let key = '', buf = '';
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\s+#.*$/, '');
      if (!key) { const m = /^\s*([A-Za-z_][\w]*)\s*=\s*(.*)$/.exec(line); if (!m) continue; key = m[1]; buf = m[2]; } else buf += ` ${line.trim()}`;
      const open = (buf.match(/\[/g) ?? []).length, close = (buf.match(/\]/g) ?? []).length;
      if (open === close) { f[key] = tomlValue(buf); key = ''; buf = ''; }
    }
    if (key) throw new Error(`unterminated value for ${key}`);
  } catch (e) { return { hand: null, issues: [err(where, `not readable: ${(e as Error).message}`)] }; }
  const fail = (m: string) => ({ hand: null, issues: [err(where, m)] });
  if (f.variant !== 'NT') return fail(`variant "${String(f.variant)}" is not no-limit hold'em (NT)`);
  const stacks = f.starting_stacks as number[], blinds = f.blinds_or_straddles as number[], acts = f.actions as string[];
  if (!Array.isArray(stacks) || !Array.isArray(blinds) || !Array.isArray(acts) || stacks.length !== blinds.length) return fail('starting_stacks, blinds_or_straddles and actions are required and must agree in length');
  const n = stacks.length;
  // Unknown stacks (written `inf`): replaced by 1,000 big blinds each and flagged, so the betting replays; any
  // statistic that needs stacks (stack-to-pot ratio, all-in) must skip hands with meta.stacksUnknown.
  const stacksUnknown = stacks.some((x) => !Number.isFinite(x));
  if (stacksUnknown) for (let i = 0; i < n; i++) if (!Number.isFinite(stacks[i])) stacks[i] = 1000 * Math.max(...blinds);
  const posted = blinds.map((b, i) => ({ b, i })).filter((x) => x.b > 0);
  if (posted.length !== 2) return fail(posted.length > 2 ? 'straddles are not supported' : 'exactly a small and a big blind are required');
  const [lo, hi] = posted[0].b <= posted[1].b ? [posted[0], posted[1]] : [posted[1], posted[0]];
  if (lo.b === hi.b) return fail('the two blinds are equal: cannot tell the small from the big');
  if (n > 2 && (lo.i + 1) % n !== hi.i) return fail('the big blind is not the seat after the small blind');
  const antes = (f.antes as number[] | undefined) ?? [];
  if (antes.some((a) => a !== (antes[0] ?? 0))) return fail('unequal antes are not supported');
  const buttonSeat = n === 2 ? lo.i : (lo.i - 1 + n) % n;
  const holes: ([string, string] | null)[] = Array.from({ length: n }, () => null);
  const board: string[] = [];
  const actions: DataAction[] = [];
  const two = (s: string): [string, string] | null => (/^[2-9TJQKA][shdc][2-9TJQKA][shdc]$/.test(s) ? [s.slice(0, 2), s.slice(2)] : null);
  const committed = new Array<number>(n).fill(0);
  let streetHigh = hi.b;
  committed[lo.i] = lo.b; committed[hi.i] = hi.b;
  for (const a of acts) {
    const t = a.trim().split(/\s+/);
    if (t[0] === 'd' && t[1] === 'dh') { const p = Number(t[2].slice(1)) - 1; const c = two(t[3] ?? ''); if (c) holes[p] = c; continue; }
    if (t[0] === 'd' && t[1] === 'db') { for (let i = 0; i + 1 < (t[2] ?? '').length; i += 2) board.push(t[2].slice(i, i + 2)); committed.fill(0); streetHigh = 0; continue; }
    const pm = /^p(\d+)$/.exec(t[0] ?? '');
    if (!pm) return fail(`action "${a}" is not understood`);
    const seat = Number(pm[1]) - 1;
    if (!(seat >= 0 && seat < n)) return fail(`action "${a}" names a player that is not in the hand`);
    if (t[1] === 'f') actions.push({ seat, kind: 'fold' });
    else if (t[1] === 'cc') { actions.push({ seat, kind: committed[seat] >= streetHigh ? 'check' : 'call' }); committed[seat] = Math.max(committed[seat], streetHigh); }
    else if (t[1] === 'cbr') { const to = Number(t[2]); if (!(to > 0)) return fail(`action "${a}" has no amount`); actions.push({ seat, kind: streetHigh > 0 ? 'raise' : 'bet', to }); committed[seat] = to; streetHigh = to; }
    else if (t[1] === 'sm') { const c = two(t[2] ?? ''); if (c) holes[seat] = c; }
    else return fail(`action "${a}" is not understood`);
  }
  const meta: Record<string, string | number> = {};
  for (const k of ['venue', 'day', 'month', 'year', 'hand', 'currency', 'currency_symbol', 'time', 'table', 'seat_count']) if (typeof f[k] === 'string' || typeof f[k] === 'number') meta[k] = f[k] as string | number;
  if (stacksUnknown) meta.stacksUnknown = 1;
  return { hand: { source, handId, seats: stacks.map((s, i) => ({ seat: i, name: Array.isArray(f.players) ? String((f.players as unknown[])[i]) : null, stack: s })), buttonSeat, smallBlind: lo.b, bigBlind: hi.b, ante: antes[0] ?? 0, holes, board, actions, meta }, issues: [] };
}

/**
 * A `.phhs` file: many PHH hands, each introduced by a `[n]` header line (HandHQ files in the PHH dataset).
 * Each section is parsed by parsePhh with the id `<fileTag>#<n>`; a section that fails is reported and skipped.
 */
export function parsePhhs(text: string, source: string, fileTag: string): { hands: HandHistory[]; issues: Issue[]; sections: number } {
  const hands: HandHistory[] = [];
  const issues: Issue[] = [];
  const parts = text.split(/^\[(\d+)\]\s*$/m);
  // parts = [preamble, n1, body1, n2, body2, ...]
  let sections = 0;
  for (let i = 1; i + 1 < parts.length; i += 2) {
    sections++;
    const r = parsePhh(parts[i + 1], source, `${fileTag}#${parts[i]}`);
    if (r.hand) hands.push(r.hand);
    issues.push(...r.issues);
  }
  return { hands, issues, sections };
}

// ---- own PokerNow logs ------------------------------------------------------------------------------
// Uses the same log reader as the dashboard's import, so a hand that the extension can replay is a hand here.

export function parsePokerNowLog(lines: string[], source: string): { hands: HandHistory[]; issues: Issue[] } {
  const r = replayLog(lines, source);
  const hands: HandHistory[] = [];
  const issues: Issue[] = [];
  if (r.unsupportedHands) issues.push({ level: 'warning', where: source, message: `${r.unsupportedHands} hand(s) of another game variant skipped` });
  for (const c of r.hands) {
    if (!c.valid) { issues.push(err(`${source} ${c.hand.handId}`, 'the log could not be replayed cleanly')); continue; }
    const dealt = c.hand.seats.filter((s) => s.dealtIn).sort((a, b) => a.seat - b.seat);
    const index = new Map(dealt.map((s, i) => [s.seat, i]));
    hands.push({
      source, handId: c.hand.handId, seats: dealt.map((s, i) => ({ seat: i, name: s.name, stack: s.startStack })), buttonSeat: index.get(c.hand.buttonSeat) ?? 0,
      smallBlind: c.hand.smallBlind, bigBlind: c.hand.bigBlind, ante: c.hand.ante,
      holes: dealt.map((s) => { const x = c.reveals.get(s.seat); return x ? [cardStr(x[0]), cardStr(x[1])] as [string, string] : null; }),
      board: c.hand.board.map(cardStr),
      actions: c.hand.events.filter((e) => !e.kind.startsWith('post')).map((e) => ({ seat: index.get(e.seat) as number, kind: e.kind as DataActionKind, ...(e.kind === 'bet' || e.kind === 'raise' ? { to: e.to } : {}) })),
      meta: {},
    });
  }
  return { hands, issues };
}
