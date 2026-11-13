// ============================================================
// PokerNow DOM adapter: the ONLY file that knows PokerNow's markup.
//
//   PokerNowDom.observe()   rendered page -> TableObs (player-visible data only)
//   PokerNowDom (driver)    click fold/check/call, type and submit a bet
//
// It reads only what the page renders for the logged-in player. It does not
// touch the site's network traffic, websocket, or any hidden state.
//
// VERIFICATION STATUS: the selectors come from this repository's earlier
// scraper and from public descriptions of PokerNow's markup. They are tested
// here against a hand-written HTML fixture (tests/bot/fixtures), NOT against a
// live table in this work session. `health()` reports which selectors matched
// so a markup change is visible in the dashboard instead of failing silently.
// All selectors live in SELECTORS and can be overridden from settings.
// ============================================================

import { CardId, parseCardStrict } from '../../cards';
import { ControlsObs, SeatObs, TableObs } from '../observation';
import type { TableDriver } from '../executor';
import { ActionControl, classifyControl, controlsFromActions, parseChipText } from './controls';

export const SELECTORS = {
  seat: '.table-player',
  seatNumberClass: /(?:^|\s)table-player-(\d+)(?:\s|$)/,
  hero: 'you-player',
  name: '.table-player-name',
  stack: '.table-player-stack',
  bet: '.table-player-bet-value',
  foldedClass: /(?:^|\s)(fold|folded)(?:\s|$)/,
  sittingOutClass: /(?:^|\s)(sitting-out|sit-out|standing-up|quitting|waiting)(?:\s|$)/,
  /** Offline / away is NOT sitting out: such a player can still hold cards and blinds in the current hand. */
  disconnectedClass: /(?:^|\s)(offline|away|disconnected)(?:\s|$)/,
  seatCards: '.table-player-cards .card',
  card: '.card',
  cardValue: '.value',
  cardSuit: '.suit',
  dealer: '.dealer-button-ctn',
  dealerPositionClass: /dealer-position-(\d+)/,
  board: '.table-cards .card',
  potTotal: '.table-pot-size .add-on .chips-value',
  potMain: '.table-pot-size .main-value .chips-value',
  blinds: '.blind-value-ctn .chips-value, .blind-value .chips-value',
  gameType: '.table-game-type, .game-type, .blind-value-ctn .game-type-ctn',
  toAct: '.table-player.decision-current',
  heroTurnSignal: '.action-signal',
  controls: '.game-decisions-ctn, .action-buttons',
  foldBtn: 'button.fold',
  checkBtn: 'button.check',
  callBtn: 'button.call',
  raiseBtn: 'button.raise',
  raiseForm: '.raise-controller-form',
  raiseInput: '.raise-controller-form input.value, .raise-controller-form input[type="text"], .raise-controller-form input[type="number"]',
  raiseSlider: '.raise-controller-form input[type="range"]',
  raiseSubmit: '.raise-controller-form input[type="submit"], .raise-controller-form button[type="submit"]',
  timer: '.time-to-talk, .decision-timer, .action-signal .time',
};
export type SelectorMap = typeof SELECTORS;

/** "1,250" / "12.50" / "1.2k" -> number; null when the text is not a chip amount. */
export const parseChips = parseChipText;

const PRE_ACTION_RE = /check\s*(or|\/)\s*fold|fold\s*(to)?\s*any|call\s*any|check\/fold/i;
const visible = (el: Element | null): el is HTMLElement => {
  if (!el) return false;
  const h = el as HTMLElement & { disabled?: boolean };
  if (h.disabled) return false;
  if (typeof h.getClientRects === 'function' && h.isConnected && h.ownerDocument.defaultView) {
    const st = h.ownerDocument.defaultView.getComputedStyle(h);
    if (st && (st.display === 'none' || st.visibility === 'hidden')) return false;
  }
  return true;
};

export class PokerNowDom implements TableDriver {
  private lastHealth: Record<string, boolean> = {};
  constructor(
    private readonly doc: Document,
    private readonly sel: SelectorMap = SELECTORS,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Which key elements were found in the last observe() (for the diagnostics panel). */
  health(): Record<string, boolean> { return { ...this.lastHealth }; }

  private parseCard(el: Element, problems: string[], where: string): CardId | null {
    const v = el.querySelector(this.sel.cardValue)?.textContent?.trim() ?? '';
    const s = el.querySelector(this.sel.cardSuit)?.textContent?.trim() ?? '';
    if (!v && !s) return null; // face-down card
    const c = parseCardStrict(v + s);
    if (c === null) problems.push(`unreadable card in ${where}: "${v}${s}"`);
    return c;
  }

  private chips(root: ParentNode, selector: string): number | null {
    const el = root.querySelector(selector);
    if (!el) return null;
    const inner = el.querySelector('.chips-value') ?? el;
    return parseChips(inner.textContent);
  }

  observe(now: number = Date.now()): TableObs {
    const { doc, sel } = this;
    const problems: string[] = [];
    const seats: SeatObs[] = [];
    let heroCards: [CardId, CardId] | null = null;
    let dealerSeat: number | null = null;
    const seatEls = Array.from(doc.querySelectorAll(sel.seat));
    let fallbackSeat = 100;
    for (const el of seatEls) {
      const name = el.querySelector(sel.name)?.textContent?.trim();
      if (!name) continue; // empty seat
      const m = el.className.match(sel.seatNumberClass);
      const seat = m ? Number(m[1]) : fallbackSeat++;
      if (!m) problems.push(`seat number missing for ${name}`);
      const isHero = el.classList.contains(sel.hero);
      const stack = this.chips(el, sel.stack);
      const bet = this.chips(el, sel.bet) ?? 0;
      const cardEls = Array.from(el.querySelectorAll(sel.seatCards));
      const shown: CardId[] = [];
      for (const c of cardEls) { const id = this.parseCard(c, problems, `seat ${seat}`); if (id !== null) shown.push(id); }
      if (isHero) {
        if (cardEls.length === 2 && shown.length === 2 && shown[0] !== shown[1]) heroCards = [shown[0], shown[1]];
        else if (cardEls.length > 2) problems.push(`hero has ${cardEls.length} cards`);
      }
      if (el.querySelector(sel.dealer)) dealerSeat = seat;
      seats.push({
        seat, name, playerId: el.getAttribute('data-player-id'), stack, bet,
        folded: sel.foldedClass.test(el.className), sittingOut: sel.sittingOutClass.test(el.className),
        isHero, hasCards: cardEls.length > 0, shownCards: !isHero && shown.length === 2 ? shown : null,
        disconnected: sel.disconnectedClass.test(el.className), cls: String(el.className).slice(0, 200),
      });
    }
    const dealerEl = doc.querySelector(sel.dealer);
    const dm = dealerEl?.className.match(sel.dealerPositionClass);
    if (dm) dealerSeat = Number(dm[1]);

    const board: CardId[] = [];
    for (const c of Array.from(doc.querySelectorAll(sel.board))) {
      const id = this.parseCard(c, problems, 'board');
      if (id !== null && !board.includes(id) && board.length < 5) board.push(id);
    }
    if (board.length === 1 || board.length === 2) problems.push(`board shows ${board.length} cards`);

    const blindVals = Array.from(doc.querySelectorAll(sel.blinds)).map((e) => parseChips(e.textContent)).filter((v): v is number => v !== null && v > 0);
    const smallBlind = blindVals.length >= 2 ? Math.min(blindVals[0], blindVals[1]) : null;
    const bigBlind = blindVals.length >= 2 ? Math.max(blindVals[0], blindVals[1]) : null;

    const toActEl = doc.querySelector(sel.toAct);
    const tm = toActEl?.className.match(sel.seatNumberClass);
    const controls = this.readControls();
    const preAction = Array.from(doc.querySelectorAll('button')).some((b) => visible(b) && PRE_ACTION_RE.test(b.textContent ?? ''));
    const heroSeat = seats.find((s) => s.isHero);
    const signal = !!doc.querySelector(sel.heroTurnSignal) || (!!toActEl && toActEl.classList.contains(sel.hero));
    const heroToAct = !preAction && (controls.fold || controls.check || controls.call !== null) && (signal || !toActEl);

    const gameType = doc.querySelector(sel.gameType)?.textContent?.trim() || null;
    const timerText = doc.querySelector(sel.timer)?.textContent?.trim() ?? '';
    const tsec = timerText.match(/^(\d+)(?::(\d+))?$/);
    this.lastHealth = {
      seats: seats.length > 0, hero: !!heroSeat, dealer: dealerSeat !== null, blinds: bigBlind !== null,
      pot: !!doc.querySelector(sel.potTotal) || !!doc.querySelector(sel.potMain), toAct: !!toActEl,
      controls: !!doc.querySelector(sel.controls), gameType: gameType !== null, timer: !!tsec,
    };
    return {
      ts: now, tableId: (doc.location?.pathname ?? '').split('/').filter(Boolean).pop() ?? 'unknown', gameType, handLabel: null,
      seats, dealerSeat, board, heroCards,
      pot: this.chips(doc, sel.potTotal) ?? this.chips(doc, sel.potMain),
      smallBlind, bigBlind, ante: blindVals.length >= 3 ? blindVals[2] : null,
      toActSeat: tm ? Number(tm[1]) : null, heroToAct, controls,
      timeRemainingMs: tsec ? (tsec[2] !== undefined ? Number(tsec[1]) * 60 + Number(tsec[2]) : Number(tsec[1])) * 1000 : null,
      problems,
      raw: {
        buttons: Array.from(doc.querySelectorAll(`${sel.controls.split(',').map((c) => `${c.trim()} button`).join(', ')}, button.fold, button.check, button.call, button.raise`)).filter((b) => visible(b)).map((b) => `${String((b as HTMLElement).className).slice(0, 60)}|${(b.textContent ?? '').trim().slice(0, 40)}`).filter((v, i, a) => a.indexOf(v) === i).slice(0, 12),
        signal: doc.querySelector(sel.heroTurnSignal)?.textContent?.trim().slice(0, 40) ?? null,
        pot: doc.querySelector('.table-pot-size')?.textContent?.trim().slice(0, 60) ?? null,
        timer: timerText ? timerText.slice(0, 20) : null,
      },
    };
  }

  /** Buttons of the action area, in document order (also the class-named ones, wherever they sit). */
  private controlButtons(): HTMLElement[] {
    const scoped = this.sel.controls.split(',').map((c) => `${c.trim()} button`).join(', ');
    const all = Array.from(this.doc.querySelectorAll(`${scoped}, ${this.sel.foldBtn}, ${this.sel.checkBtn}, ${this.sel.callBtn}, ${this.sel.raiseBtn}`)) as HTMLElement[];
    return all.filter((b, i) => all.indexOf(b) === i);
  }

  private classified(): { el: HTMLElement; c: ActionControl }[] {
    return this.controlButtons().map((el) => ({ el, c: classifyControl({ text: el.textContent ?? '', cls: String(el.className), visible: visible(el) || this.shown(el), disabled: !!(el as HTMLButtonElement).disabled }) }));
  }

  /** Displayed (ignores `disabled`, which is reported separately). */
  private shown(el: HTMLElement): boolean {
    const view = el.ownerDocument.defaultView;
    if (!view || !el.isConnected) return false;
    const st = view.getComputedStyle(el);
    return !(st && (st.display === 'none' || st.visibility === 'hidden'));
  }

  /** The visible, enabled control whose LABEL names this action (never chosen by class or position). */
  private actionButton(kind: 'fold' | 'check' | 'call' | 'wager'): HTMLElement | null {
    for (const { el, c } of this.classified()) {
      if (!c.enabled) continue;
      if (kind === 'wager' ? (c.kind === 'bet' || c.kind === 'raise') && !c.preset : c.kind === kind) return el;
    }
    return null;
  }

  private readControls(): ControlsObs {
    const c = controlsFromActions(this.classified().map((x) => x.c));
    const slider = this.doc.querySelector(this.sel.raiseSlider) as HTMLInputElement | null;
    if (slider) { c.minRaiseTo = parseChips(slider.min); c.maxRaiseTo = parseChips(slider.max); }
    return c;
  }

  // ---- driver -------------------------------------------------------------

  async click(kind: 'fold' | 'check' | 'call'): Promise<boolean> {
    const b = this.actionButton(kind);
    if (!b) return false;
    b.click();
    return true;
  }

  private setInputValue(input: HTMLInputElement, value: string): void {
    const view = this.doc.defaultView as (Window & typeof globalThis) | null;
    const proto = view ? view.HTMLInputElement.prototype : Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, value); else input.value = value;
    const Ev = view ? view.Event : Event;
    input.dispatchEvent(new Ev('input', { bubbles: true }));
    input.dispatchEvent(new Ev('change', { bubbles: true }));
  }

  async betOrRaise(to: number): Promise<{ submitted: boolean; readBack: number | null; detail: string }> {
    let input = this.doc.querySelector(this.sel.raiseInput) as HTMLInputElement | null;
    if (!visible(input)) {
      const open = this.actionButton('wager');
      if (!open) return { submitted: false, readBack: null, detail: 'no bet/raise button' };
      open.click();
      for (let i = 0; i < 20 && !visible(input); i++) { await this.sleep(50); input = this.doc.querySelector(this.sel.raiseInput) as HTMLInputElement | null; }
      if (!visible(input)) return { submitted: false, readBack: null, detail: 'bet input did not open' };
    }
    const text = Number.isInteger(to) ? String(to) : to.toFixed(2);
    input.focus();
    this.setInputValue(input, text);
    await this.sleep(60);
    const readBack = parseChips(input.value);
    if (readBack === null || Math.abs(readBack - to) > 0.011) return { submitted: false, readBack, detail: `typed ${text} but the input shows "${input.value}"` };
    const submit = this.doc.querySelector(this.sel.raiseSubmit) as HTMLElement | null;
    if (!visible(submit)) return { submitted: false, readBack, detail: 'no submit control in the bet form' };
    submit.click();
    return { submitted: true, readBack, detail: 'submitted' };
  }
}
