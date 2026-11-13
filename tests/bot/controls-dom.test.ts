// ============================================================
// PokerNow action buttons read from markup (jsdom). The class strings and
// labels are the ones recorded on a real table on 2026-11-13; the surrounding
// markup is the project's fixture table. This file uses only the public
// adapter, so it also runs against the code before the fix (where the first
// test fails: "Bet 5" was read as a call of 5).
// ============================================================

import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { PokerNowDom } from '../../src/bot/adapter/pokernow/dom';
import { HandTracker } from '../../src/bot/adapter/tracker';
import { dealBoard } from '../../src/bot/table/engine';
import { act, mk } from './helpers';
import { render, toHtml } from './render';

const TIME = '<button class="button-1 action-button with-tip time-bank  suspended-action " type="button">Activate Extra Time (10s)</button>';
const btn = (cls: string, text: string, extra = '') => `<button class="${cls}" type="button" ${extra}>${text}</button>`;
const REAL = {
  bet5: btn('button-1 action-button call with-tip call green ', 'Bet 5'),
  bet: btn('button-1 action-button with-tip raise green', 'Bet'),
  raise: btn('button-1 action-button with-tip raise green', 'Raise'),
  check: btn('button-1 action-button with-tip check green ', 'Check'),
  fold: btn('button-1 action-button with-tip fold red ', 'Fold'),
  call: (n: number) => btn('button-1 action-button call with-tip call green ', `Call ${n}`),
  checkFold: btn('button-1 action-button with-tip check-fold suspended-action ', 'Check or Fold'),
};

/** A table page whose action area holds exactly `buttons`. */
function page(buttons: string, heroTurn = true): PokerNowDom {
  const h = mk(3, { sb: 2, bb: 5 });
  const holes = new Map<number, [number, number]>([[0, [0, 5]], [1, [9, 14]], [2, [20, 25]]]);
  const base = toHtml(render(h, 0, holes, 1)).replace(/<div class="game-decisions-ctn">[\s\S]*?<\/div>\n<\/div>$/, '');
  const html = `${base}<div class="game-decisions-ctn">${heroTurn ? '<div class="action-signal">Your Turn</div>' : ''}${buttons}</div></div>`;
  return new PokerNowDom(new JSDOM(`<body>${html}</body>`, { url: 'https://www.pokernow.club/games/abc' }).window.document);
}

describe('PokerNow action buttons, real class strings', () => {
  it('1/13. [Bet 5] [Bet] [Check] [Fold]: a free check and a bet, NOT a call of 5', () => {
    const c = page(TIME + REAL.bet5 + REAL.bet + REAL.check + REAL.fold).observe(1).controls;
    expect(c.call).toBeNull();
    expect(c.check).toBe(true);
    expect(c.fold).toBe(true);
    expect(c.raise).toBe(true);
  });

  it('2/14. [Call 5] [Raise] [Fold]: a call of 5, no check', () => {
    const c = page(TIME + REAL.call(5) + REAL.raise + REAL.fold).observe(1).controls;
    expect([c.call, c.check, c.fold, c.raise]).toEqual([5, false, true, true]);
  });

  it('7. the buttons change when an opponent bets: check becomes call', () => {
    expect(page(REAL.bet5 + REAL.bet + REAL.check + REAL.fold).observe(1).controls.call).toBeNull();
    expect(page(REAL.call(30) + REAL.raise + REAL.fold).observe(2).controls).toMatchObject({ call: 30, check: false });
  });

  it('driver: "call" and "check" click the button with that LABEL, never the Bet shortcut that shares the call class', async () => {
    const doc = new JSDOM(`<body><div class="game-decisions-ctn"><div class="action-signal">Your Turn</div>${REAL.bet5}${REAL.bet}${REAL.check}${REAL.fold}</div></body>`).window.document;
    const clicked: string[] = [];
    for (const b of Array.from(doc.querySelectorAll('button'))) b.addEventListener('click', () => clicked.push(b.textContent ?? ''));
    const dom = new PokerNowDom(doc);
    expect(await dom.click('call')).toBe(false); // there is nothing to call
    expect(clicked).toEqual([]);
    expect(await dom.click('check')).toBe(true);
    expect(clicked).toEqual(['Check']);
  });

  it('end to end on markup: big blind checks behind on the flop after the small blind checks (10)', () => {
    const h = mk(3, { sb: 2, bb: 5 });
    const holes = new Map<number, [number, number]>([[0, [0, 5]], [1, [9, 14]], [2, [20, 25]]]);
    const t = new HandTracker();
    const read = (ts: number) => new PokerNowDom(new JSDOM(`<body>${toHtml(render(h, 2, holes, ts))}</body>`, { url: 'https://www.pokernow.club/games/abc' }).window.document).observe(ts);
    const feed = (ts: number) => { t.ingest(read(ts)); t.ingest(read(ts + 200)); };
    feed(1000);
    act(h, 'call'); act(h, 'call'); act(h, 'check'); dealBoard(h, [40, 41, 46]);
    feed(2000);
    act(h, 'check'); // small blind checks; Hero (big blind, seat 2) is next
    feed(3000);
    const o = read(3400);
    expect(o.heroToAct).toBe(true);
    expect(o.controls.call).toBeNull();
    t.ingest(o);
    expect(t.state.predictedActor).toBe(2);
    expect(t.state.legal.status).toBe('match');
    expect(t.state.blockers).toEqual([]);
  });
});
