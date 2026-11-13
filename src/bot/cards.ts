// ============================================================
// Card primitives for the bot core.
//
// Encoding matches the rest of the repo (src/core/cfr/card-utils.ts):
//   id = rank * 4 + suit, rank 0..12 (2..A), suit 0..3 (h, d, c, s).
// ============================================================

export type CardId = number;

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'hdcs';
const SUIT_SYMBOLS: Record<string, number> = {
  '♥': 0, '♡': 0, h: 0, '♦': 1, '♢': 1, d: 1, '♣': 2, '♧': 2, c: 2, '♠': 3, '♤': 3, s: 3,
};

export const rankOf = (c: CardId): number => c >> 2;
export const suitOf = (c: CardId): number => c & 3;

export function cardStr(c: CardId): string {
  return RANK_CHARS[rankOf(c)] + SUIT_CHARS[suitOf(c)];
}

export function cardsStr(cards: readonly CardId[]): string {
  return cards.map(cardStr).join(' ');
}

/**
 * Parse one card from text such as "Ah", "10♠", "T s", "Q♦". Returns null on
 * anything that is not an unambiguous card: callers must treat null as "not
 * observed" and never substitute a default card.
 */
export function parseCardStrict(text: string): CardId | null {
  const t = (text || '').trim();
  const m = t.match(/^(10|[2-9TJQKAtjqka])\s*([hdcsHDCS♥♡♦♢♣♧♠♤])$/);
  if (!m) return null;
  const r = m[1] === '10' ? 'T' : m[1].toUpperCase();
  const rank = RANK_CHARS.indexOf(r);
  const suit = SUIT_SYMBOLS[m[2].toLowerCase()] ?? SUIT_SYMBOLS[m[2]];
  if (rank < 0 || suit === undefined) return null;
  return rank * 4 + suit;
}

/** Parse "Ah Kd 7c" / "Ah,Kd" style lists; throws on a bad card (test/CLI use). */
export function parseCards(text: string): CardId[] {
  return text.split(/[\s,]+/).filter(Boolean).map((s) => {
    const c = parseCardStrict(s);
    if (c === null) throw new Error(`bad card "${s}"`);
    return c;
  });
}

/** True when every card is a valid id and no card appears twice. */
export function cardsAreDistinct(cards: readonly CardId[]): boolean {
  let lo = 0, hi = 0;
  for (const c of cards) {
    if (!Number.isInteger(c) || c < 0 || c > 51) return false;
    if (c < 32) { const b = 1 << c; if (lo & b) return false; lo |= b; }
    else { const b = 1 << (c - 32); if (hi & b) return false; hi |= b; }
  }
  return true;
}

// ---- 1326 hole-card combos --------------------------------------------------

export const NUM_COMBOS = 1326;
export const COMBO_LO = new Int8Array(NUM_COMBOS);
export const COMBO_HI = new Int8Array(NUM_COMBOS);
const COMBO_INDEX = new Int16Array(52 * 52);
{
  let k = 0;
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) {
      COMBO_LO[k] = a; COMBO_HI[k] = b;
      COMBO_INDEX[a * 52 + b] = k; COMBO_INDEX[b * 52 + a] = k;
      k++;
    }
  }
}
export const comboIndex = (a: CardId, b: CardId): number => COMBO_INDEX[a * 52 + b];

// ---- 169 starting-hand classes ---------------------------------------------

/** Canonical class name: "AA", "AKs", "T9o" (higher rank first). */
export function handClass(a: CardId, b: CardId): string {
  const ra = rankOf(a), rb = rankOf(b);
  const hi = Math.max(ra, rb), lo = Math.min(ra, rb);
  if (hi === lo) return RANK_CHARS[hi] + RANK_CHARS[lo];
  return RANK_CHARS[hi] + RANK_CHARS[lo] + (suitOf(a) === suitOf(b) ? 's' : 'o');
}

/** Small deterministic PRNG (mulberry32), seedable, used everywhere in the bot core. */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number { return Math.floor(this.next() * n); }
  fork(salt: number): Rng { return new Rng(hashSeed(this.s, salt)); }
}

export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= p >>> 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
  }
  return (h ^ (h >>> 15)) >>> 0;
}

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function shuffledDeck(rng: Rng): CardId[] {
  const d: CardId[] = [];
  for (let i = 0; i < 52; i++) d.push(i);
  for (let i = 51; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = d[i]; d[i] = d[j]; d[j] = t;
  }
  return d;
}
