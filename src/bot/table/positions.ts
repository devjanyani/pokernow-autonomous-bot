// ============================================================
// Position reconstruction for 2-10 dealt-in players.
//
// Positions are derived from the actual button and the seats dealt into THIS
// hand, never from physical seat numbers. The strategically relevant quantity
// is how many players act after a seat preflop, so every seat also gets
// `behindPreflop` (players still to act after it when the pot is unopened) and
// a `chart6` label (the 6-max chart position with the same number of players
// behind, or null for the early seats of a 7-10 handed table).
// ============================================================

export type PositionLabel =
  | 'BTN' | 'SB' | 'BB' | 'UTG' | 'UTG+1' | 'UTG+2' | 'UTG+3' | 'MP' | 'LJ' | 'HJ' | 'CO';

export type Chart6Position = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';

export interface SeatPosition {
  seat: number;
  label: PositionLabel;
  /** Order of action preflop, 0 = first to act. */
  preflopOrder: number;
  /** Order of action postflop, 0 = first to act. */
  postflopOrder: number;
  /** Players acting after this seat preflop in an unopened pot (blinds included). */
  behindPreflop: number;
  /** Equivalent 6-max chart position by players-behind, or null if earlier than 6-max UTG. */
  chart6: Chart6Position | null;
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
}

/** Labels for the seats between the big blind and the button, first to act first. */
const EARLY_LABELS: Record<number, PositionLabel[]> = {
  0: [],
  1: ['CO'],
  2: ['HJ', 'CO'],
  3: ['UTG', 'HJ', 'CO'],
  4: ['UTG', 'MP', 'HJ', 'CO'],
  5: ['UTG', 'UTG+1', 'MP', 'HJ', 'CO'],
  6: ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'],
  7: ['UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO'],
  // Ten dealt in with a dead small blind: eight seats between the big blind and the button. Until 0.9.2 this listed
  // 'MP' twice, so two players shared a label (display and profile groups only; decisions use behindPreflop).
  8: ['UTG', 'UTG+1', 'UTG+2', 'UTG+3', 'MP', 'LJ', 'HJ', 'CO'],
};

function chart6For(isBtn: boolean, isSb: boolean, isBb: boolean, behind: number): Chart6Position | null {
  if (isBb) return 'BB';
  if (isSb) return 'SB'; // also the button at a heads-up table
  if (isBtn) return 'BTN';
  // behindPreflop counts BTN, SB, BB plus later non-blind seats.
  if (behind === 3) return 'CO';
  if (behind === 4) return 'MP';
  if (behind === 5) return 'UTG';
  return null;
}

/**
 * @param dealtSeats  physical seat numbers dealt into this hand, in CLOCKWISE order.
 * @param buttonSeat  physical seat holding the button. If the button seat is not
 *                    dealt in (dead button), the nearest dealt seat counter-clockwise
 *                    is treated as the button for ordering.
 * @param opts.straddleSeat seat that posted a straddle (acts last preflop).
 * @param opts.noSmallBlind dead small blind: the seat that would post it is not in the hand, so the first
 *                    dealt seat left of the button is the big blind and nobody posts a small blind
 *                    (seen on PokerNow when the small-blind seat sits out). Ignored heads-up.
 */
export function assignPositions(
  dealtSeats: readonly number[],
  buttonSeat: number,
  opts: { straddleSeat?: number | null; noSmallBlind?: boolean } = {},
): SeatPosition[] {
  const n = dealtSeats.length;
  if (n < 2 || n > 10) throw new RangeError(`assignPositions: ${n} dealt-in players (need 2-10)`);
  if (new Set(dealtSeats).size !== n) throw new RangeError('assignPositions: duplicate seat');

  let btnIdx = dealtSeats.indexOf(buttonSeat);
  if (btnIdx < 0) {
    // Dead button: walk counter-clockwise from the button seat to the first dealt seat.
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const dist = ((buttonSeat - dealtSeats[i]) % 64 + 64) % 64;
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    btnIdx = best;
  }
  const at = (k: number) => dealtSeats[(btnIdx + k) % n];
  const headsUp = n === 2;
  const dead = !!opts.noSmallBlind && !headsUp;
  const sbSeat = dead ? null : headsUp ? at(0) : at(1);
  const bbSeat = headsUp || dead ? at(1) : at(2);

  // Preflop order: first seat left of the big blind ... big blind last.
  const preflop: number[] = [];
  const bbOffset = headsUp || dead ? 1 : 2;
  for (let k = 1; k <= n; k++) preflop.push(at(bbOffset + k));
  const straddle = opts.straddleSeat ?? null;
  if (straddle !== null && preflop.includes(straddle) && !headsUp) {
    // The straddler acts last preflop; action starts on the straddler's left.
    const i = preflop.indexOf(straddle);
    const rotated = [...preflop.slice(i + 1), ...preflop.slice(0, i + 1)];
    preflop.splice(0, n, ...rotated);
  }
  // Postflop order: first seat left of the button ... button last.
  const postflop: number[] = [];
  for (let k = 1; k <= n; k++) postflop.push(at(k));

  const blindSeats = dead ? 2 : 3; // seats taken by button and blinds
  const early = EARLY_LABELS[Math.max(0, n - blindSeats)] ?? [];
  const out: SeatPosition[] = [];
  for (let k = 0; k < n; k++) {
    const seat = at(k);
    const isButton = k === 0;
    const isSmallBlind = seat === sbSeat;
    const isBigBlind = seat === bbSeat;
    let label: PositionLabel;
    if (headsUp) label = isButton ? 'BTN' : 'BB';
    else if (isButton) label = 'BTN';
    else if (isSmallBlind) label = 'SB';
    else if (isBigBlind) label = 'BB';
    else label = early[k - blindSeats];
    const preflopOrder = preflop.indexOf(seat);
    const behindPreflop = n - 1 - preflopOrder;
    out.push({
      seat, label, preflopOrder,
      postflopOrder: postflop.indexOf(seat),
      behindPreflop,
      // With a dead small blind one fewer player is behind every seat; charts are keyed as if it were there.
      chart6: chart6For(isButton, isSmallBlind, isBigBlind, behindPreflop + (dead ? 1 : 0)),
      isButton, isSmallBlind, isBigBlind,
    });
  }
  return out;
}
