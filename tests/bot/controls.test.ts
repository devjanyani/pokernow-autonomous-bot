// ============================================================
// Action-control classification (src/bot/adapter/pokernow/controls.ts) and its
// effect on validation and recommendations.
//
// Real data: tests/bot/fixtures/live-2026-11-13b.json is a debug bundle from a
// recommendation-only session on a real PokerNow table (extension 0.5.0, names
// and table id replaced). In its hand 4 Hero is the big blind with 4d 9c; on the
// flop, turn and river PokerNow showed [Bet 5] [Bet] [Check] [Fold] and 0.5.0
// answered "call button shows 5, engine computes 0" (frames n=213-226).
// The bundle keeps the raw class|text of every button, so the frames can be
// re-classified with today's parser.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { cardStr } from '../../src/bot/cards';
import { TableObs } from '../../src/bot/adapter/observation';
import { classifyControl, controlsFromButtons, controlsFromRawStrings, describeControls, RawControl } from '../../src/bot/adapter/pokernow/controls';
import { PokerNowDom } from '../../src/bot/adapter/pokernow/dom';
import { HandTracker, TrackerState } from '../../src/bot/adapter/tracker';
import { frameTracker } from '../../src/bot/diag/recorder';
import { ControllerDeps, LiveController } from '../../src/bot/ext/controller';
import { BotMessage, DEFAULT_SETTINGS, sanitizeSettings } from '../../src/bot/ext/records';
import { decisionBanner } from '../../src/bot/ext/view';
import { GuardedExecutor } from '../../src/bot/adapter/executor';
import { dealBoard, potTotal } from '../../src/bot/table/engine';
import { act, mk } from './helpers';
import { render } from './render';

const raw = (text: string, cls = '', visible = true, disabled = false): RawControl => ({ text, cls, visible, disabled });
const CALL_CLS = 'button-1 action-button call with-tip call green ';
const RAISE_CLS = 'button-1 action-button with-tip raise green';
const CHECK_CLS = 'button-1 action-button with-tip check green ';
const FOLD_CLS = 'button-1 action-button with-tip fold red ';
const kinds = (rs: RawControl[]) => rs.map((r) => { const c = classifyControl(r); return `${c.kind}${c.amount !== null ? `:${c.amount}` : ''}${c.preset ? ':preset' : ''}`; });

describe('classification by label (scenarios 1-6)', () => {
  it('1. CHECK, BET 5, BET, FOLD', () => {
    const rs = [raw('Bet 5', CALL_CLS), raw('Bet', RAISE_CLS), raw('Check', CHECK_CLS), raw('Fold', FOLD_CLS)];
    expect(kinds(rs)).toEqual(['bet:5:preset', 'bet', 'check', 'fold']);
    expect(controlsFromButtons(rs)).toMatchObject({ fold: true, check: true, call: null, raise: true, wagerKind: 'bet', presets: [5], allIn: false });
  });

  it('2. CALL 5, RAISE, FOLD', () => {
    const rs = [raw('Call 5', CALL_CLS), raw('Raise', RAISE_CLS), raw('Fold', FOLD_CLS)];
    expect(kinds(rs)).toEqual(['call:5', 'raise', 'fold']);
    expect(controlsFromButtons(rs)).toMatchObject({ fold: true, check: false, call: 5, raise: true, wagerKind: 'raise', presets: [] });
  });

  it('3. CHECK and several BET presets', () => {
    const c = controlsFromButtons([raw('Bet 5', CALL_CLS), raw('Bet 10'), raw('Bet 1,250'), raw('Bet 2.5k'), raw('Bet', RAISE_CLS), raw('Check', CHECK_CLS), raw('Fold', FOLD_CLS)]);
    expect(c).toMatchObject({ check: true, call: null, wagerKind: 'bet', presets: [5, 10, 1250, 2500] });
  });

  it('4. CALL and several RAISE presets', () => {
    const c = controlsFromButtons([raw('Call 30', CALL_CLS), raw('Raise 60'), raw('Raise to 90'), raw('Raise', RAISE_CLS), raw('Fold', FOLD_CLS)]);
    expect(c).toMatchObject({ check: false, call: 30, wagerKind: 'raise', presets: [60, 90] });
  });

  it('5. keyboard shortcut letters and misleading classes do not decide the action', () => {
    expect(kinds([raw('C Call 5'), raw('Call 5 C'), raw('C\n Call 5')])).toEqual(['call:5', 'call:5', 'call:5']);
    // "C" for a bet shortcut, drawn with the call class: still a bet.
    expect(kinds([raw('C Bet 5', CALL_CLS), raw('Bet 5 (C)', CALL_CLS)])).toEqual(['bet:5:preset', 'bet:5:preset']);
    expect(kinds([raw('K Check'), raw('F Fold'), raw('R Raise'), raw('B Bet')])).toEqual(['check', 'fold', 'raise', 'bet']);
    // A lone letter, or a class that names an action, is not an action.
    expect(kinds([raw('C', CALL_CLS), raw('F', FOLD_CLS), raw('', CALL_CLS), raw('5', CALL_CLS)])).toEqual(['other', 'other', 'other', 'other']);
    // A number before the word is not the action's amount.
    expect(kinds([raw('5 Call'), raw('2 Check')])).toEqual(['call', 'check']);
    expect(controlsFromButtons([raw('Call')]).call).toBeNaN(); // a call of unknown size is never zero
  });

  it('all-in, pre-actions, size helpers and other buttons', () => {
    expect(kinds([raw('All In'), raw('All-in 460'), raw('ALLIN')])).toEqual(['all-in', 'all-in:460', 'all-in']);
    expect(kinds([raw('Check or Fold', 'button-1 action-button with-tip check-fold suspended-action '), raw('Call Any'), raw('Fold to any bet')])).toEqual(['pre-action', 'pre-action', 'pre-action']);
    // The bet form's helpers (seen in the recording) fill the amount box; they are not actions.
    const helpers = [raw('Min Raise', 'button-1 default-bet-button'), raw('1/2 Pot', 'button-1 default-bet-button'), raw('3/4 Pot'), raw('Pot'), raw('Back'), raw('-', 'control-button decrease'), raw('+'), raw('Activate Extra Time (10s)'), raw('Extra Time Activated'), raw('Show All Cardss', 'all-cards-button ')];
    expect(helpers.map((r) => classifyControl(r).kind)).toEqual(helpers.map(() => 'other'));
    const c = controlsFromButtons([...helpers, raw('All In', 'button-1 default-bet-button'), raw('Bet', RAISE_CLS), raw('Check', CHECK_CLS), raw('Fold', FOLD_CLS)]);
    expect(c).toMatchObject({ check: true, call: null, fold: true, allIn: true, presets: [] });
  });

  it('6. hidden, disabled and suspended controls are recorded but are not available actions', () => {
    const c = controlsFromButtons([raw('Call 5', CALL_CLS, false), raw('Check', CHECK_CLS, true, true), raw('Fold', `${FOLD_CLS} suspended-action`), raw('Raise', RAISE_CLS)]);
    expect(c).toMatchObject({ fold: false, check: false, call: null, raise: true });
    expect(c.actions!.map((a) => [a.kind, a.visible, a.enabled])).toEqual([['call', false, false], ['check', true, false], ['fold', true, false], ['raise', true, true]]);
    expect(describeControls(c)).toEqual([
      'call 5 "Call 5" [hidden, disabled]', 'check "Check" [visible, disabled]', 'fold "Fold" [visible, disabled]', 'raise "Raise" [visible, enabled]',
    ]);
  });

  it('6 (DOM). display:none and the disabled attribute are honoured when reading the page', () => {
    const html = `<div class="game-decisions-ctn"><div class="action-signal">Your Turn</div>
      <button class="${CALL_CLS}" style="display:none">Call 5</button><button class="${CHECK_CLS}" disabled>Check</button>
      <button class="${CALL_CLS}">Bet 5</button><button class="${RAISE_CLS}">Bet</button><button class="${FOLD_CLS}">Fold</button></div>`;
    const c = new PokerNowDom(new JSDOM(`<body>${html}</body>`).window.document).observe(1).controls;
    expect(c).toMatchObject({ call: null, check: false, fold: true, raise: true, presets: [5] });
    expect(c.actions!.filter((a) => a.kind === 'call' || a.kind === 'check').map((a) => [a.kind, a.visible, a.enabled])).toEqual([['call', false, false], ['check', true, false]]);
  });
});

// ---- the real recording ----------------------------------------------------------------

interface Frame { n: number; obs: TableObs; liveDecision: string }
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'live-2026-11-13b.json'), 'utf8')) as { recordedWith: string; hands: { frames: Frame[] }[] };
const recorded: Frame[] = fixture.hands.flatMap((h) => h.frames);
/** The same frame with its buttons classified by today's parser from the recorded class|text strings. */
const reparse = (o: TableObs): TableObs => ({ ...o, controls: { ...controlsFromRawStrings(o.raw?.buttons ?? []), minRaiseTo: o.controls.minRaiseTo, maxRaiseTo: o.controls.maxRaiseTo } });
const byN = (n: number) => recorded.find((f) => f.n === n)!;

function track(frames: TableObs[]): Map<number, TrackerState> {
  const t = new HandTracker();
  const out = new Map<number, TrackerState>();
  frames.forEach((o, i) => { t.ingest(o); const s = t.state; out.set(recorded[i].n, { ...s, hand: s.hand ? JSON.parse(JSON.stringify({ ...s.hand, payouts: null })) : null }); });
  return out;
}

describe('live recording 2026-11-13b: what the page showed', () => {
  it('the recording: 0.5.0, 211 frames; on three streets Hero is offered [Bet 5] [Bet] [Check] [Fold] and no recommendation was made', () => {
    expect(fixture.recordedWith).toBe('0.5.0');
    expect(recorded.length).toBe(211);
    for (const n of [213, 214, 220, 221, 225, 226]) {
      const f = byN(n);
      const labels = (f.obs.raw!.buttons).map((b) => b.split('|')[1]);
      expect(labels.filter((l) => !/Extra Time/.test(l)), `frame ${n}`).toEqual(['Bet 5', 'Bet', 'Check', 'Fold']);
      expect(f.obs.raw!.buttons[1]).toBe(`${CALL_CLS}|Bet 5`); // the shortcut carries the call button's classes
      expect(f.obs.heroToAct).toBe(true);
      expect(f.obs.controls.call).toBe(5); // what the 0.5.0 parser made of it
      expect(['blocked', 'none']).toContain(f.liveDecision);
    }
    expect(byN(213).obs.board.map(cardStr).join(' ')).toBe('Ah 6h 3h');
    expect(byN(221).obs.board.map(cardStr).join(' ')).toBe('Ah 6h 3h 8h');
    expect(byN(221).obs.heroCards!.map(cardStr).sort().join(' ')).toBe('4d 9c');
    expect(byN(221).obs.pot).toBe(20);
  });

  it('the old reading reproduces the failure: with the recorded controls the tracker blocks all three streets', () => {
    const st = track(recorded.map((f) => f.obs));
    for (const n of [214, 221, 226]) expect(st.get(n)!.blockers.join(' '), `frame ${n}`).toMatch(/call button shows 5, engine computes 0/);
  });
});

describe('live recording 2026-11-13b: with the buttons classified by label (8, 9, 10, 12, 13, 14)', () => {
  const frames = recorded.map((f) => reparse(f.obs));
  const st = track(frames);

  it('13. free check on the flop, turn and river: check legal, nothing to call, a separate bet option, buttons agree', () => {
    for (const [n, street] of [[213, 'flop'], [214, 'flop'], [220, 'turn'], [221, 'turn'], [225, 'river'], [226, 'river']] as const) {
      const s = st.get(n)!;
      const c = frames[recorded.findIndex((f) => f.n === n)].controls;
      expect(c, `frame ${n}`).toMatchObject({ call: null, check: true, fold: true, raise: true, wagerKind: 'bet', presets: [5] });
      expect([s.hand!.street, s.turnStatus, s.predictedActor === s.heroSeat], `frame ${n}`).toEqual([street, 'agree', true]);
      expect(s.blockers, `frame ${n}`).toEqual([]);
      expect(s.legal, `frame ${n}`).toMatchObject({ status: 'match', detail: null, actions: { canCheck: true, callAmount: 0, canRaise: true, raiseKind: 'bet', minRaiseTo: 5 } });
      // The shortcut equals the engine's minimum bet here (one big blind); recorded, not relied on.
      expect(s.legal.context).toMatchObject({ street, toCall: 0, currentBet: 0, heroStreetCommit: 0, wagerLabel: 'bet', presets: [5] });
      expect(potTotal(s.hand as never)).toBe(20);
    }
  });

  it('8/9/10. street changes: Hero checks behind the small blind on the flop, checks the turn, and the river brings a real bet', () => {
    const acts = (n: number) => st.get(n)!.hand!.events.filter((e) => e.street !== 'preflop').map((e) => `${e.street[0]}:${e.seat === st.get(n)!.heroSeat ? 'hero' : e.seat}:${e.kind}${e.kind === 'bet' ? e.to : ''}`);
    expect(acts(214)).toEqual([`f:${st.get(214)!.hand!.seats.find((x) => x.pos?.isSmallBlind)!.seat}:check`]); // 10: small blind checked, Hero to act
    const turn = acts(221);
    expect(turn.filter((a) => a.startsWith('f:')).length).toBe(4); // four players checked the flop
    expect(turn.filter((a) => a.startsWith('t:'))).toEqual([`t:${st.get(214)!.hand!.seats.find((x) => x.pos?.isSmallBlind)!.seat}:fold`]); // the small blind folds the turn: two opponents left
    expect(turn).toContain('f:hero:check');
    expect(st.get(221)!.hand!.board.length).toBe(4);
    expect(st.get(226)!.hand!.board.length).toBe(5);
    expect(acts(226)).toContain('t:hero:check');
  });

  it('14. a real outstanding bet on the river: [Call 5] [Raise] [Fold] is a call of 5 and no check', () => {
    for (const n of [232, 233]) {
      const s = st.get(n)!;
      const c = frames[recorded.findIndex((f) => f.n === n)].controls;
      expect(c).toMatchObject({ call: 5, check: false, wagerKind: 'raise', presets: [] });
      expect(s.legal).toMatchObject({ status: 'match', actions: { canCheck: false, callAmount: 5, raiseKind: 'raise' } });
      expect(s.legal.context).toMatchObject({ street: 'river', toCall: 5, currentBet: 5 });
      expect(s.blockers).toEqual([]);
    }
  });

  it('12. buttons mid-render (only Fold drawn after Hero has acted) are not a new turn and not a mismatch', () => {
    for (const n of [108, 125, 235]) { // Hero's chips are already in; the page still shows Hero highlighted with a lone Fold button
      const s = st.get(n)!;
      expect(byN(n).obs.raw!.buttons.map((b) => b.split('|')[1])).toEqual(['Fold']);
      expect(s.blockers, `frame ${n}`).toEqual([]);
      expect([s.actorLagging, s.predictedActor === s.heroSeat], `frame ${n}`).toEqual([true, false]);
    }
    for (const n of [210, 211]) { // preflop option: check and raise vanish a moment before the flop; still Hero's decision point
      const s = st.get(n)!;
      expect(s.blockers, `frame ${n}`).toEqual([]);
      expect(s.legal.status).toBe('match');
    }
  });

  it('whole recording: no blocker on any settled frame, every other Hero turn unchanged, all hands valid', () => {
    const settledBlocked = recorded.filter((f) => { const s = st.get(f.n)!; return s.settled && s.blockers.length > 0; }).map((f) => [f.n, st.get(f.n)!.blockers]);
    expect(settledBlocked).toEqual([]);
    const heroTurns = recorded.filter((f) => f.obs.heroToAct).map((f) => f.n);
    const usable = heroTurns.filter((n) => { const s = st.get(n)!; return s.valid && s.blockers.length === 0 && s.predictedActor === s.heroSeat && s.legal.status === 'match'; });
    const lagging = heroTurns.filter((n) => st.get(n)!.actorLagging);
    expect(usable.length + lagging.length).toBe(heroTurns.length);
    expect(usable).toEqual(expect.arrayContaining([69, 70, 106, 107, 122, 123, 136, 137, 150, 151, 206, 207, 208, 213, 214, 220, 221, 225, 226, 232, 233, 261, 262]));
    expect([...st.values()].every((s) => s.valid)).toBe(true);
  });

  it('13. end to end: a recommendation on each free-check street, never a fold, and fold is not among the options', async () => {
    let i = 0;
    const sent: BotMessage[] = [];
    const clicks: string[] = [];
    const deps: ControllerDeps = {
      observe: () => frames[i], health: () => ({ seats: true, hero: true, dealer: true, blinds: true }),
      driver: { async click(k) { clicks.push(k); return true; }, async betOrRaise(to) { clicks.push(`raise:${to}`); return { submitted: true, readBack: to, detail: 'ok' }; } },
      send: (m) => sent.push(m), loadProfiles: async () => [], now: () => performance.now(), sleep: async () => undefined, yieldFn: async () => undefined, random: () => 0.5, render: () => undefined,
    };
    const c = new LiveController(deps, sanitizeSettings({ ...DEFAULT_SETTINGS, mode: 'recommend', assumedClockMs: 3000 }), 3);
    const shown = new Map<number, { state: string; action: string | null; banner: string; options: string[] }>();
    for (i = 0; i < frames.length; i++) {
      c.tick();
      const heroTurn = frames[i].heroToAct;
      for (let k = 0; k < (heroTurn ? 400 : 1); k++) { await new Promise((r) => setTimeout(r, heroTurn ? 10 : 1)); c.tick(); if (!heroTurn || c.snapshot().recommendation.state !== 'thinking') break; }
      const l = c.snapshot();
      shown.set(recorded[i].n, { state: l.recommendation.state, action: l.decision?.action ?? null, banner: decisionBanner(l, l.ts).title, options: l.decision?.candidates.map((x) => x.action) ?? [] });
    }
    for (const n of [214, 221, 226]) {
      const s = shown.get(n)!;
      expect([n, s.state], `frame ${n}: ${s.banner}`).toEqual([n, 'ready']);
      expect(['check', 'bet']).toContain(s.action);
      expect(s.options).not.toContain('fold');
      expect(s.options).toContain('check');
      expect(s.options.some((o) => o === 'bet')).toBe(true); // check is weighed against bets, not hard-coded
      expect(s.banner).toMatch(/^(CHECK|BET \d+|ALL-IN \d+)$/);
    }
    expect(shown.get(233)).toMatchObject({ state: 'ready' });
    expect([...shown.values()].filter((s) => s.state === 'blocked')).toEqual([]);
    const flopOn = sent.filter((m): m is Extract<BotMessage, { type: 'bot/decision' }> => m.type === 'bot/decision').filter((d) => d.record.heroCards.slice().sort().join('') === '4d9c' && d.record.board.length >= 3);
    expect(flopOn.map((d) => [d.record.board.length, d.record.context!.canCheck, d.record.context!.toCall])).toEqual([[3, true, 0], [4, true, 0], [5, true, 0], [5, false, 5]]);
    expect(clicks).toEqual([]); // recommendation-only
  }, 120000);
});

describe('validation stays strict (11, 15)', () => {
  const holes = new Map<number, [number, number]>([[0, [0, 5]], [1, [9, 14]], [2, [20, 25]]]);
  function flopHeroToAct() {
    const h = mk(3, { sb: 2, bb: 5 });
    const t = new HandTracker();
    let ts = 1000;
    const feed = (mut?: (o: TableObs) => void) => { ts += 500; const o = render(h, 2, holes, ts); mut?.(o); t.ingest(o); t.ingest({ ...o, ts: ts + 200 }); return o; };
    feed();
    act(h, 'call'); act(h, 'call'); act(h, 'check'); dealBoard(h, [40, 41, 46]);
    feed();
    act(h, 'check');
    return { h, t, feed };
  }

  it('15. a genuine disagreement still blocks, and the diagnostic says what was read and what was reconstructed', () => {
    const { t, feed } = flopHeroToAct();
    feed((o) => { o.controls = controlsFromButtons([raw('Call 9', CALL_CLS), raw('Raise', RAISE_CLS), raw('Fold', FOLD_CLS)]); });
    const s = t.state;
    expect(s.legal.status).toBe('mismatch');
    expect(s.blockers.join(' | ')).toMatch(/call button shows 9, engine computes 0 \(flop: Hero has 0 in front, highest bet 0; buttons read: call 9 "Call 9" \[visible, enabled\], raise "Raise" \[visible, enabled\], fold "Fold" \[visible, enabled\]\)/);
    expect(s.blockers.join(' | ')).toMatch(/check button absent but engine canCheck=true/);
    expect(s.legal.context).toMatchObject({ street: 'flop', heroStreetCommit: 0, currentBet: 0, toCall: 0, wagerLabel: 'raise' });
    expect(s.warnings.join(' ')).toMatch(/wager button says "Raise" but the engine has no bet outstanding/);
    // The same detail is what the debug bundle stores for the frame.
    const ft = frameTracker(s);
    expect(ft.legal.context!.controls).toEqual(['call 9 "Call 9" [visible, enabled]', 'raise "Raise" [visible, enabled]', 'fold "Fold" [visible, enabled]']);
    expect(JSON.stringify(ft)).not.toMatch(/cookie|token|password/i);
  });

  it('15. the click guard refuses a call when the page offers none, even with a Bet shortcut on screen', async () => {
    const { h, t } = flopHeroToAct();
    const o = render(h, 2, holes, 9000);
    o.controls = controlsFromButtons([raw('Bet 5', CALL_CLS), raw('Bet', RAISE_CLS), raw('Check', CHECK_CLS), raw('Fold', FOLD_CLS)]);
    t.ingest(o); t.ingest({ ...o, ts: 9300 });
    const clicks: string[] = [];
    const ex = new GuardedExecutor({ async click(k) { clicks.push(k); return true; }, async betOrRaise() { return { submitted: false, readBack: null, detail: 'n/a' }; } }, () => ({ obs: { ...o, ts: 9400 }, state: t.state }), { minConfidence: 0.7, sleep: async () => undefined, now: () => 0 });
    ex.armed = true;
    const st = t.state;
    const out = await ex.execute({ action: 'call', handId: st.hand!.handId, street: 'flop', eventCount: st.eventCount });
    expect(out.status).toBe('rejected');
    expect(clicks).toEqual([]);
  });

  it('11. the same buttons read many times: one decision point, no duplicate actions, stable legal state', () => {
    const { t, feed } = flopHeroToAct();
    const o = feed((x) => { x.controls = controlsFromButtons([raw('Bet 5', CALL_CLS), raw('Bet', RAISE_CLS), raw('Check', CHECK_CLS), raw('Fold', FOLD_CLS)]); });
    const before = t.state.eventCount;
    for (let i = 0; i < 20; i++) t.ingest({ ...o, ts: o.ts + 300 + i * 40 });
    expect(t.state.eventCount).toBe(before);
    expect(t.state.legal).toMatchObject({ status: 'match', actions: { canCheck: true, callAmount: 0 } });
    expect(t.state.blockers).toEqual([]);
  });
});
