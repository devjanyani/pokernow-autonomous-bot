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
// hideFolds=1: folded seats keep their cards and get no fold class (a fold marker the adapter does not recognise).
// auto=<ms>: when nobody clicks for Hero within <ms>, the table plays check / call for Hero (a person playing by hand).
const HIDE_FOLDS = params.get('hideFolds') === '1';
const AUTO_MS = Number(params.get('auto') ?? 0);
// cents=1: 0.25 / 0.50 blinds and 50.00 stacks (PokerNow's small play-money tables, amounts in cents); else 10 / 20.
const CENTS = params.get('cents') === '1';
const SB = CENTS ? 0.25 : 10, BB = CENTS ? 0.5 : 20;
// clock=<s>: Hero's action clock, shown as whole seconds in a .time-to-talk element (read by the adapter); when it runs
// out the table checks or folds for Hero (a timeout). Without it the page shows no clock.
const CLOCK_MS = Number(params.get('clock') ?? 0) * 1000;
const stats = { hands: 0, heroActions: 0, autoActions: 0, timeouts: 0, illegalClicks: 0, errors: [] as string[], heroTurns: [] as { start: number; end: number | null; how: string | null }[] };
const timerEl = document.createElement('div');
timerEl.className = 'time-to-talk';
timerEl.style.cssText = 'position:fixed;right:8px;bottom:8px;font:20px monospace';
document.body.appendChild(timerEl);
let clockTimer: ReturnType<typeof setInterval> | null = null;
function heroTurnEnded(how: string): void {
  const t = stats.heroTurns[stats.heroTurns.length - 1];
  if (t && t.end === null) { t.end = performance.now(); t.how = how; }
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  timerEl.textContent = '';
}
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
    heroTurnEnded(`click ${kind}`);
  } catch (e) {
    stats.illegalClicks++;
    stats.errors.push((e as Error).message);
  }
  step();
}

function draw(): void {
  const o = render(h, HERO, holes, performance.now());
  if (HIDE_FOLDS && h.phase !== 'complete') for (const s of o.seats) { const e = h.seats.find((x) => x.seat === s.seat)!; if (e.folded && s.seat !== HERO) { s.folded = false; s.hasCards = true; } }
  root.innerHTML = toHtml(o);
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
    handId: `fake${++handNo}`, buttonSeat: handNo % N, smallBlind: SB, bigBlind: BB,
    seats: Array.from({ length: N }, (_, s) => ({ seat: s, playerId: `p${s}`, name: s === HERO ? 'Hero' : `Villain ${s}`, stack: 100 * BB })),
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
  if (h.toAct === HERO) {
    if (!stats.heroTurns.length || stats.heroTurns[stats.heroTurns.length - 1].end !== null) stats.heroTurns.push({ start: performance.now(), end: null, how: null });
    if (CLOCK_MS > 0 && !clockTimer) {
      const start = performance.now(), at = h.events.length, hand = handNo;
      const tickClock = () => {
        if (hand !== handNo || h.events.length !== at || h.toAct !== HERO) { heroTurnEnded('moved on'); return; }
        const left = CLOCK_MS - (performance.now() - start);
        if (left <= 0) {
          const la = legalActions(h)!;
          applyAction(h, { seat: HERO, kind: la.canCheck ? 'check' : 'fold' });
          stats.timeouts++;
          heroTurnEnded('timeout');
          step();
          return;
        }
        timerEl.textContent = String(Math.ceil(left / 1000));
      };
      tickClock();
      clockTimer = setInterval(tickClock, 100);
    }
    // Wait for a click; optionally act for Hero after a pause, like a person playing by hand.
    if (AUTO_MS > 0) {
      const at = h.events.length, hand = handNo;
      setTimeout(() => {
        if (hand !== handNo || h.events.length !== at || h.toAct !== HERO) return;
        const la = legalActions(h)!;
        applyAction(h, { seat: HERO, kind: la.canCheck ? 'check' : la.callAmount <= 60 ? 'call' : 'fold' });
        stats.autoActions++;
        heroTurnEnded('table played Hero');
        step();
      }, AUTO_MS);
    }
    return;
  }
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
