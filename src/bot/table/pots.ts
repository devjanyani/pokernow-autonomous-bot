// ============================================================
// Pot construction and settlement (main pot + side pots).
//
// A pot layer between contribution levels (prev, L] holds from every seat
// min(c, L) - min(c, prev) chips, folded seats included (dead money). Only
// non-folded seats that contributed at least L can win it.
// ============================================================

export interface PotContribution {
  seat: number;
  /** Total chips this seat put in this hand (blinds and antes included). */
  committed: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  /** Seats that can win this pot. */
  eligible: number[];
}

export interface PotBreakdown {
  pots: Pot[];
  /** Chips returned to a seat because nobody could call them. */
  uncalled: { seat: number; amount: number } | null;
}

export function buildPots(contribs: readonly PotContribution[]): PotBreakdown {
  const c = contribs.map((x) => ({ ...x }));
  // Uncalled portion: the excess of the single largest live contribution over
  // the second largest contribution of ANY seat goes back.
  let uncalled: PotBreakdown['uncalled'] = null;
  const sorted = [...c].sort((a, b) => b.committed - a.committed);
  if (sorted.length >= 2 && !sorted[0].folded && sorted[0].committed > sorted[1].committed) {
    const amount = sorted[0].committed - sorted[1].committed;
    sorted[0].committed -= amount;
    uncalled = { seat: sorted[0].seat, amount };
  } else if (sorted.length === 1 && !sorted[0].folded) {
    uncalled = { seat: sorted[0].seat, amount: sorted[0].committed };
    sorted[0].committed = 0;
  }
  const levels = [...new Set(c.filter((x) => !x.folded && x.committed > 0).map((x) => x.committed))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const L of levels) {
    let amount = 0;
    for (const x of c) amount += Math.min(x.committed, L) - Math.min(x.committed, prev);
    const eligible = c.filter((x) => !x.folded && x.committed >= L).map((x) => x.seat);
    if (amount > 0) {
      const last = pots[pots.length - 1];
      // Merge layers with identical eligibility (happens when a folded seat sits between levels).
      if (last && last.eligible.length === eligible.length && last.eligible.every((s, i) => s === eligible[i])) last.amount += amount;
      else pots.push({ amount, eligible });
    }
    prev = L;
  }
  // Dead money above the highest live level (a folded seat that out-contributed
  // every live seat) belongs to the last pot.
  let extra = 0;
  for (const x of c) extra += Math.max(0, x.committed - prev);
  if (extra > 0) {
    if (pots.length) pots[pots.length - 1].amount += extra;
    else pots.push({ amount: extra, eligible: c.filter((x) => !x.folded).map((x) => x.seat) });
  }
  return { pots, uncalled };
}

/**
 * Pay every pot to the best eligible hand(s). `strength(seat)` is any comparable
 * value, higher wins. Ties split; odd chips go one at a time to the tied seats
 * in `oddChipOrder` (seats clockwise from the left of the button).
 * Returns chips paid per seat, including any uncalled return.
 */
export function settlePots(
  breakdown: PotBreakdown,
  strength: (seat: number) => number,
  oddChipOrder: readonly number[],
  chipUnit = 1,
): Map<number, number> {
  const paid = new Map<number, number>();
  const add = (s: number, a: number) => paid.set(s, (paid.get(s) ?? 0) + a);
  if (breakdown.uncalled) add(breakdown.uncalled.seat, breakdown.uncalled.amount);
  for (const pot of breakdown.pots) {
    if (pot.eligible.length === 0) continue;
    let best = -Infinity;
    for (const s of pot.eligible) best = Math.max(best, strength(s));
    const winners = pot.eligible.filter((s) => strength(s) === best);
    const units = Math.round(pot.amount / chipUnit);
    const each = Math.floor(units / winners.length);
    let odd = units - each * winners.length;
    const ordered = [...winners].sort((a, b) => oddChipOrder.indexOf(a) - oddChipOrder.indexOf(b));
    for (const s of ordered) {
      let u = each;
      if (odd > 0) { u++; odd--; }
      add(s, u * chipUnit);
    }
  }
  return paid;
}
