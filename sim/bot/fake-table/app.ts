// ============================================================
// A local stand-in for a PokerNow table, for end-to-end tests of the built
// extension in a real browser. It renders PokerNow-SHAPED markup (the same
// fixture markup the unit tests use), plays the other seats with scripted
// opponents and reacts to clicks on the action buttons like the real page.
//
// It is NOT PokerNow: passing against it shows the extension loads, reads
// this markup, decides, clicks and stores data in real Chrome. It says nothing
// about whether the selectors match the live site.
// ============================================================

import { CardId, Rng, shuffledDeck } from '../../../src/bot/cards';
import { evaluateHand } from '../../../src/core/equity/hand-eval';
import { archetypePolicy } from '../../../src/bot/sim/policies';
import { applyAction, awaitingBoard, completeHand, createHand, dealBoard, HandState, legalActions } from '../../../src/bot/table/engine';
import { render, toHtml } from '../../../tests/bot/render';

const params = new URLSearchParams(location.search);
const N = Math.max(2, Math.min(10, Number(params.get('players') ?? 6)));
const HERO = 0;
const rng = new Rng(Number(params.get('seed') ?? 11));
const policies = Array.from({ length: N }, (_, i) => archetypePolicy((['loose-passive', 'tight-aggressive', 'loose-aggressive', 'tight-passive'] as const)[i % 4]));
const stats = { hands: 0, heroActions: 0, illegalClicks: 0, errors: [] as string[] };
(window as unknown as { __stats: typeof stats }).__stats = stats;

let h: HandState;
let holes = new Map<number, [CardId, CardId]>();
let board: CardId[] = [];
let handNo = 0;
const root = document.getElementById('root') as HTMLElement;

function heroAct(kind: 'fold' | 'check' | 'call' | 'bet' | 'raise', to?: number): void {
  try {
    applyAction(h, { seat: HERO, kind: kind === 'bet' || kind === 'raise' ? legalActions(h)!.raiseKind : kind, to });
    stats.heroActions++;
  } catch (e) {
    stats.illegalClicks++;
    stats.errors.push((e as Error).message);
  }
  step();
}

function draw(): void {
  root.innerHTML = toHtml(render(h, HERO, holes, performance.now()));
  root.querySelector('button.fold')?.addEventListener('click', () => heroAct('fold'));
  root.querySelector('button.check')?.addEventListener('click', () => heroAct('check'));
  root.querySelector('button.call')?.addEventListener('click', () => heroAct('call'));
  const form = root.querySelector('.raise-controller-form') as HTMLFormElement | null;
  root.querySelector('button.raise')?.addEventListener('click', () => { if (form) form.style.display = 'block'; });
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    heroAct('raise', Number((form.querySelector('input.value') as HTMLInputElement).value.replace(/,/g, '')));
  });
}

function newHand(): void {
  const deck = shuffledDeck(rng);
  h = createHand({
    handId: `fake${++handNo}`, buttonSeat: handNo % N, smallBlind: 10, bigBlind: 20,
    seats: Array.from({ length: N }, (_, s) => ({ seat: s, playerId: `p${s}`, name: s === HERO ? 'Hero' : `Villain ${s}`, stack: 2000 })),
  });
  holes = new Map(h.seats.map((s, i) => [s.seat, [deck[2 * i], deck[2 * i + 1]] as [CardId, CardId]]));
  board = deck.slice(40, 45);
  step();
}

function step(): void {
  draw();
  if (h.phase === 'complete') { stats.hands++; setTimeout(newHand, 1500); return; }
  if (h.phase === 'showdown') {
    setTimeout(() => { completeHand(h, (s) => evaluateHand([...holes.get(s)!, ...h.board])); step(); }, 900);
    return;
  }
  if (h.toAct === HERO) return; // wait for a click
  if (h.toAct !== null) {
    const seat = h.toAct;
    setTimeout(async () => {
      const c = await policies[seat].act({ h, seat, hole: holes.get(seat)!, la: legalActions(h)!, rng: rng.fork(h.events.length + seat) });
      applyAction(h, { seat, ...c });
      step();
    }, 350);
    return;
  }
  if (awaitingBoard(h)) setTimeout(() => { dealBoard(h, h.street === 'preflop' ? board.slice(0, 3) : [board[h.board.length]]); step(); }, 500);
}

newHand();
