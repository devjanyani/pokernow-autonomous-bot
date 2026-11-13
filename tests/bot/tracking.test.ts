// ============================================================
// Regression tests for game-state reconstruction, continuous turn tracking and
// decision reliability (PRIORITY ENGINEERING TASK, section 18, scenarios 1-35).
//
// These are DETERMINISTIC SYNTHETIC fixtures. The ones modelled on reports from
// live play ("hero in the small blind, table says YOUR TURN, engine expects the
// button") reproduce the described situation, not the original hands: no log
// of those hands exists. Passing here does not show PokerNow compatibility.
//
// `hideFolds` renders a table whose fold marker is NOT recognised (the folded
// seat keeps its cards and has no "folded" flag), which is the failure the
// reports are consistent with.
// ============================================================

import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { JSDOM } from 'jsdom';
import { CardId, parseCards } from '../../src/bot/cards';
import { BotAgent } from '../../src/bot/agent';
import { TableObs } from '../../src/bot/adapter/observation';
import { PokerNowDom } from '../../src/bot/adapter/pokernow/dom';
import { HandTracker } from '../../src/bot/adapter/tracker';
import { buildBundle, DebugFrame, parseBundle } from '../../src/bot/diag/recorder';
import { formatReplay, replayObservations } from '../../src/bot/diag/replay';
import { buildTimeline, formatTimeline } from '../../src/bot/diag/timeline';
import { ControllerDeps, LiveController, MSG } from '../../src/bot/ext/controller';
import { BotMessage, DEFAULT_SETTINGS, LiveState, sanitizeSettings, Settings } from '../../src/bot/ext/records';
import { BotStorage } from '../../src/bot/ext/storage';
import { evaluateHand } from '../../src/core/equity/hand-eval';
import { completeHand, dealBoard, HandState, legalActions, potTotal, tableCounts, totalChips } from '../../src/bot/table/engine';
import { act, mk } from './helpers';
import { render, toHtml } from './render';

type MkOpts = Parameters<typeof mk>[1];

/** A scripted table: the ground truth is a rules-engine hand, `obs()` is what Hero would see. */
class Sim {
  ts = 1000;
  h: HandState;
  holes = new Map<number, [CardId, CardId]>();
  constructor(readonly n: number, readonly hero: number, opts: MkOpts & { heroCards?: string } = {}) {
    this.h = mk(n, { sb: 1, bb: 2, stacks: Array.from({ length: n }, () => 200), ...opts });
    this.deal(opts.heroCards);
  }
  deal(heroCards?: string): void {
    this.holes = new Map(this.h.seats.map((s, i) => [s.seat, [2 * i, 2 * i + 1] as [CardId, CardId]]));
    if (heroCards) { const c = parseCards(heroCards); this.holes.set(this.hero, [c[0], c[1]]); }
  }
  next(n: number, opts: MkOpts = {}, hero = this.hero): void {
    (this as { n: number }).n = n; (this as { hero: number }).hero = hero;
    this.h = mk(n, { sb: 1, bb: 2, stacks: Array.from({ length: n }, () => 200), ...opts });
    this.deal();
  }
  obs(o: { hideFolds?: boolean } = {}): TableObs {
    this.ts += 500;
    const ob = render(this.h, this.hero, this.holes, this.ts);
    if (o.hideFolds) for (const s of ob.seats) { const e = this.h.seats.find((x) => x.seat === s.seat)!; if (e.dealtIn && e.folded) { s.folded = false; s.hasCards = true; } }
    return ob;
  }
  flop(): void { dealBoard(this.h, [40, 41, 46]); }
  card(c: CardId): void { dealBoard(this.h, [c]); }
}

/** Show an observation twice, 200 ms apart, so it counts as settled. */
const feed = (t: HandTracker, o: TableObs) => { t.ingest(o); return t.ingest({ ...o, ts: o.ts + 200 }); };
const kinds = (t: HandTracker) => t.state.hand!.events.filter((e) => !e.kind.startsWith('post')).map((e) => `${e.seat}:${e.kind}`);

// ---- controller harness -------------------------------------------------------------

function harness(settings: Partial<Settings> = {}) {
  let cur: TableObs | null = null;
  let ts = 0;
  let live: LiveState | null = null;
  const sent: BotMessage[] = [];
  const clicks: string[] = [];
  const health: Record<string, boolean> = { seats: true, hero: true, dealer: true, blinds: true, pot: true, toAct: true, controls: true, gameType: true, timer: false };
  const deps: ControllerDeps = {
    observe: () => ({ ...(cur as TableObs), ts: (ts += 150) }),
    health: () => health,
    driver: { async click(k) { clicks.push(k); return true; }, async betOrRaise(to) { clicks.push(`raise:${to}`); return { submitted: true, readBack: to, detail: 'ok' }; } },
    send: (m) => sent.push(m), loadProfiles: async () => [], now: () => performance.now(), sleep: async () => {}, yieldFn: async () => {}, random: () => 0.5,
    render: (l) => { live = l; },
  };
  const c = new LiveController(deps, sanitizeSettings({ ...DEFAULT_SETTINGS, mode: 'recommend', assumedClockMs: 3000, ...settings }), 7);
  /** Show an observation and let the controller run until any decision in flight has finished. */
  async function show(o: TableObs): Promise<LiveState> {
    cur = o;
    for (let i = 0; i < 3; i++) { c.tick(); await new Promise((r) => setTimeout(r, 3)); }
    for (let i = 0; i < 400 && c.snapshot().recommendation.state === 'thinking'; i++) { c.tick(); await new Promise((r) => setTimeout(r, 10)); }
    return c.snapshot();
  }
  const decisions = () => sent.filter((m): m is Extract<BotMessage, { type: 'bot/decision' }> => m.type === 'bot/decision');
  const frames = (): DebugFrame[] => { c.flush(); return sent.flatMap((m) => (m.type === 'bot/frames' ? m.frames : [])); };
  return { c, show, sent, clicks, decisions, frames, health, live: () => live };
}

// ======================================================================================

describe('turn order and positions (scenarios 1, 2, 3, 9, 10, 11, 34)', () => {
  it('1. true heads-up table: the button is the small blind, acts first preflop and last postflop', () => {
    const s = new Sim(2, 0);
    const t = new HandTracker();
    feed(t, s.obs());
    const hero = t.state.hand!.seats.find((x) => x.seat === 0)!;
    expect([hero.pos!.label, hero.pos!.isSmallBlind, hero.pos!.isButton]).toEqual(['BTN', true, true]);
    expect(t.state.predictedActor).toBe(0);
    expect(t.state.turnStatus).toBe('agree');
    expect(tableCounts(t.state.hand!, 0).headsUpTable).toBe(true);
    act(s.h, 'call'); act(s.h, 'check'); s.flop();
    feed(t, s.obs());
    expect(t.state.hand!.street).toBe('flop');
    expect(t.state.predictedActor).toBe(1); // big blind first postflop
    act(s.h, 'check');
    feed(t, s.obs());
    expect(t.state.predictedActor).toBe(0);
    expect(t.state.blockers).toEqual([]);
  });

  it('2. five players, several limpers: every call is tracked in order and the big blind gets the option', () => {
    const s = new Sim(5, 2);
    const t = new HandTracker();
    feed(t, s.obs());
    for (const k of ['call', 'call', 'call', 'call'] as const) { act(s.h, k); feed(t, s.obs()); }
    expect(kinds(t)).toEqual(['3:call', '4:call', '0:call', '1:call']);
    expect(t.state.predictedActor).toBe(2);
    expect(t.state.turnStatus).toBe('agree');
    expect(t.state.legal.status).toBe('match');
    expect(t.state.legal.actions).toMatchObject({ canCheck: true, callAmount: 0, canRaise: true });
    expect(potTotal(t.state.hand!)).toBe(10);
  });

  it('3. ten players, most fold and the fold marker is not recognised: Hero in the small blind is still reached', () => {
    const s = new Sim(10, 1);
    const t = new HandTracker();
    feed(t, s.obs({ hideFolds: true }));
    // UTG..: fold x5, then a call, then fold, button folds.
    for (const k of ['fold', 'fold', 'fold', 'fold', 'fold', 'call', 'fold', 'fold'] as const) act(s.h, k);
    expect(s.h.toAct).toBe(1);
    feed(t, s.obs({ hideFolds: true }));
    expect(t.state.predictedActor).toBe(1);
    expect(t.state.turnStatus).toBe('agree');
    expect(t.state.blockers).toEqual([]);
    const c = tableCounts(t.state.hand!, 1);
    expect([c.dealtIn, c.folded, c.contesting, c.opponentsContesting]).toEqual([10, 7, 3, 2]);
    const tl = buildTimeline(t.state.hand!, t.state.meta);
    expect(tl.filter((e) => e.kind === 'fold').every((e) => e.inferred && e.source === 'turn-passed' && !e.uncertain)).toBe(true);
    expect(tl.filter((e) => e.kind === 'call').every((e) => !e.inferred && e.source === 'bet-display')).toBe(true);
  });

  it('9-11. first actor on flop, turn and river follows the players still in, not the previous street', () => {
    const s = new Sim(5, 0);
    const t = new HandTracker();
    feed(t, s.obs());
    // UTG(3) calls, CO(4) folds, BTN(0) calls, SB(1) calls, BB(2) checks.
    for (const k of ['call', 'fold', 'call', 'call', 'check'] as const) { act(s.h, k); feed(t, s.obs()); }
    s.flop(); feed(t, s.obs());
    expect([t.state.hand!.street, t.state.predictedActor]).toEqual(['flop', 1]);
    expect(t.state.hand!.seats.every((x) => x.streetCommit === 0)).toBe(true);
    expect(potTotal(t.state.hand!)).toBe(8); // earlier contributions stay in the pot
    // SB bets 4, BB folds, UTG calls, BTN calls.
    act(s.h, 'bet', 4); feed(t, s.obs());
    act(s.h, 'fold'); feed(t, s.obs());
    act(s.h, 'call'); feed(t, s.obs());
    act(s.h, 'call'); feed(t, s.obs());
    s.card(30); feed(t, s.obs());
    expect([t.state.hand!.street, t.state.predictedActor]).toEqual(['turn', 1]);
    // SB checks, UTG bets 10, BTN calls, SB folds.
    act(s.h, 'check'); feed(t, s.obs());
    act(s.h, 'bet', 10); feed(t, s.obs());
    act(s.h, 'call'); feed(t, s.obs());
    act(s.h, 'fold'); feed(t, s.obs());
    s.card(31); feed(t, s.obs());
    // The small blind is gone: first to act on the river is the next live seat left of the button.
    expect([t.state.hand!.street, t.state.predictedActor]).toEqual(['river', 3]);
    expect(t.state.turnStatus).toBe('agree');
    expect(t.state.valid).toBe(true);
    expect(potTotal(t.state.hand!)).toBe(potTotal(s.h));
  });

  it('34. the number of players changes between consecutive hands: positions are rebuilt each hand', () => {
    const s = new Sim(6, 0);
    const t = new HandTracker();
    const labels = () => t.state.hand!.seats.filter((x) => x.dealtIn).map((x) => x.pos!.label).sort();
    feed(t, s.obs());
    expect(labels()).toEqual(['BB', 'BTN', 'CO', 'HJ', 'SB', 'UTG']);
    for (let i = 0; i < 5; i++) { act(s.h, 'fold'); feed(t, s.obs()); }
    s.next(4, { button: 1, id: 'h2' }); feed(t, s.obs());
    expect(labels()).toEqual(['BB', 'BTN', 'CO', 'SB']);
    expect(t.state.hand!.buttonSeat).toBe(1);
    for (let i = 0; i < 3; i++) { act(s.h, 'fold'); feed(t, s.obs()); }
    s.next(9, { button: 2, id: 'h3' }); feed(t, s.obs());
    expect(t.state.hand!.seats.filter((x) => x.dealtIn).length).toBe(9);
    expect(t.state.predictedActor).toBe(5); // button 2, SB 3, BB 4, first to act 5
    expect(t.state.handsSeen).toBe(3);
  });
});

describe('the reported live symptoms (synthetic reproductions; scenarios 4, 5, 6)', () => {
  it('4. Hero in the small blind with 8h4h, limpers, the button folds without a recognised fold marker: Hero is to act, call 1', async () => {
    const s = new Sim(5, 1, { heroCards: '8h 4h' });
    const t = new HandTracker();
    feed(t, s.obs({ hideFolds: true }));
    act(s.h, 'call'); feed(t, s.obs({ hideFolds: true }));
    act(s.h, 'call'); feed(t, s.obs({ hideFolds: true }));
    act(s.h, 'fold'); // the button
    const first = s.obs({ hideFolds: true });
    t.ingest(first);
    // First sight: nothing is deduced from a table that may still be updating, and nothing is shown as ready.
    expect(t.state.predictedActor).toBe(0);
    expect(t.state.blockers.join(' ')).toMatch(/table still updating/);
    expect(t.state.discrepancies).toEqual([]);
    t.ingest({ ...first, ts: first.ts + 200 });
    expect(t.state.predictedActor).toBe(1);
    expect(t.state.observedActor).toBe(1);
    expect(t.state.turnStatus).toBe('agree');
    expect(t.state.blockers).toEqual([]);
    expect(t.state.legal).toMatchObject({ status: 'match', actions: { canCheck: false, callAmount: 1 } });
    const fold = buildTimeline(t.state.hand!, t.state.meta).pop()!;
    expect(fold).toMatchObject({ seat: 0, kind: 'fold', inferred: true, uncertain: false, source: 'turn-passed', text: 'BTN: Fold' });
    // End to end: the controller shows a recommendation for exactly this state.
    const hx = harness();
    const s2 = new Sim(5, 1, { heroCards: '8h 4h' });
    await hx.show(s2.obs({ hideFolds: true }));
    act(s2.h, 'call'); act(s2.h, 'call'); act(s2.h, 'fold');
    const l = await hx.show(s2.obs({ hideFolds: true }));
    expect(l.recommendation.state).toBe('ready');
    expect(l.recommendation.context).toMatchObject({ street: 'preflop', heroSeat: 1, toCall: 1, canCheck: false, opponents: 3 });
    expect(l.decision).not.toBeNull();
    expect(l.hand!.heroPosition).toBe('SB');
  });

  it('the old failure is gone: an unrecognised fold no longer becomes an invented call when the street changes', () => {
    const s = new Sim(5, 2);
    const t = new HandTracker();
    feed(t, s.obs({ hideFolds: true }));
    // UTG calls, CO calls, BTN folds (hidden), SB folds (hidden), BB checks; the tracker only sees the flop.
    for (const k of ['call', 'call', 'fold', 'fold', 'check'] as const) act(s.h, k);
    s.flop();
    feed(t, s.obs({ hideFolds: true }));
    expect(t.state.valid).toBe(true);
    expect(kinds(t)).toEqual(['3:call', '4:call', '0:fold', '1:fold', '2:check']);
    expect(potTotal(t.state.hand!)).toBe(potTotal(s.h)); // 7, not 9
    for (const e of s.h.seats) expect(t.state.hand!.seats.find((x) => x.seat === e.seat)!.stack).toBe(e.stack);
    expect(t.state.warnings.filter((w) => /pot mismatch|stack mismatch/.test(w))).toEqual([]);
    // The calls were not seen as chips in front (the bets were swept before the read): each is accepted only because the
    // stack fell by exactly the call. The folds are accepted only because the stacks did not move.
    expect(t.state.meta.filter((m) => m.inferred).map((m) => m.source)).toEqual(['stack-change', 'stack-change', 'street-advanced', 'street-advanced']);
  });

  it('a call that was never displayed is accepted across a street change only when the stack shows exactly that call', () => {
    const s = new Sim(3, 0);
    const t = new HandTracker();
    feed(t, s.obs());
    act(s.h, 'raise', 6); feed(t, s.obs());
    act(s.h, 'call'); act(s.h, 'fold'); s.flop();
    feed(t, s.obs({ hideFolds: true }));
    expect(kinds(t)).toEqual(['0:raise', '1:call', '2:fold']);
    expect(t.state.meta.slice(-2).map((m) => m.source)).toEqual(['stack-change', 'street-advanced']);
    // A stack that fits neither a call nor a fold is never papered over.
    const s2 = new Sim(3, 0);
    const t2 = new HandTracker();
    feed(t2, s2.obs());
    act(s2.h, 'raise', 6); feed(t2, s2.obs());
    act(s2.h, 'call'); act(s2.h, 'fold'); s2.flop();
    const o = s2.obs({ hideFolds: true });
    o.seats.find((x) => x.seat === 1)!.stack = 150;
    feed(t2, o);
    expect(t2.state.valid).toBe(false);
    expect(t2.state.issues.join(' ')).toMatch(/fits neither/);
  });

  it('5. big blind after limps: check or raise, never fold (free-check rule), on the table and in the engine', async () => {
    const hx = harness();
    const s = new Sim(5, 2, { heroCards: '7c 2d' });
    await hx.show(s.obs());
    for (const k of ['call', 'call', 'call', 'call'] as const) act(s.h, k);
    const l = await hx.show(s.obs());
    expect(l.recommendation.state).toBe('ready');
    expect(l.recommendation.context).toMatchObject({ canCheck: true, toCall: 0 });
    expect(l.decision!.action).not.toBe('fold');
    expect(['check', 'raise']).toContain(l.decision!.action);
    expect(l.tracker.legal.status).toBe('match');
  });

  it('never returns a fold when a check is free: every street, every position, many hands', () => {
    const agent = new BotAgent({ seed: 3 });
    let spots = 0;
    for (let n = 2; n <= 9; n += 1) {
      for (let hero = 0; hero < n; hero += Math.max(1, Math.floor(n / 3))) {
        const s = new Sim(n, hero, { heroCards: n % 2 ? '7c 2d' : 'Ts 3h' });
        // Everyone limps / checks to showdown; Hero is asked at every point where it could check.
        for (let guard = 0; guard < 80 && s.h.phase !== 'showdown' && s.h.phase !== 'complete'; guard++) {
          if (s.h.toAct === null) { if (s.h.street === 'preflop') s.flop(); else s.card(s.h.street === 'flop' ? 30 : 31); continue; }
          const la = legalActions(s.h)!;
          if (s.h.toAct === hero && la.canCheck) {
            const d = agent.decideSync(s.h, hero, s.holes.get(hero)!, 60);
            expect(d.action, `${n}-handed seat ${hero} ${s.h.street}`).not.toBe('fold');
            spots++;
          }
          act(s.h, la.canCheck ? 'check' : 'call');
        }
      }
    }
    expect(spots).toBeGreaterThan(40);
  });

  it('6. big blind facing a raise: no check, the call is the raise minus the blind, and the buttons agree', async () => {
    const hx = harness();
    const s = new Sim(5, 2, { heroCards: 'Ah Kh' });
    await hx.show(s.obs());
    act(s.h, 'raise', 7); act(s.h, 'fold'); act(s.h, 'call'); act(s.h, 'fold');
    const l = await hx.show(s.obs());
    expect(l.recommendation.context).toMatchObject({ canCheck: false, toCall: 5, canRaise: true, minRaiseTo: 12, maxRaiseTo: 200, opponents: 2 });
    expect(l.tracker.legal.status).toBe('match');
    expect(['fold', 'call', 'raise']).toContain(l.decision!.action);
    expect(l.decision!.action).not.toBe('check');
  });
});

describe('recommendation lifecycle (scenarios 7, 8, 29, 30, 31, 32)', () => {
  it('7/8/31/32. Hero calls, is raised, and gets a fresh recommendation on the same street; nothing stale is ever shown', async () => {
    const hx = harness();
    const s = new Sim(5, 0, { heroCards: 'Ts 9s' }); // Hero on the button
    await hx.show(s.obs());
    act(s.h, 'fold'); act(s.h, 'call'); // A folds, B calls
    const l1 = await hx.show(s.obs());
    expect(l1.recommendation.state).toBe('ready');
    const k1 = l1.recommendation.context!;
    expect(k1).toMatchObject({ toCall: 2, street: 'preflop' });
    act(s.h, 'call'); // Hero calls
    const l2 = await hx.show(s.obs());
    expect(l2.recommendation.state).toBe('none');
    expect(l2.decision).toBeNull(); // the previous recommendation is gone the moment Hero's turn ends
    expect(l2.status).toMatch(/^Waiting for opponent\./);
    act(s.h, 'fold'); // D (small blind) folds
    act(s.h, 'raise', 10); // E (big blind) raises
    const l3 = await hx.show(s.obs());
    expect(l3.decision).toBeNull();
    expect(l3.tracker.predictedActor).toBe(4);
    act(s.h, 'fold'); // B folds: action is back on Hero
    const l4 = await hx.show(s.obs());
    expect(l4.recommendation.state).toBe('ready');
    const k2 = l4.recommendation.context!;
    expect(k2.street).toBe('preflop');
    expect(k2.handId).toBe(k1.handId);
    expect(k2.version).toBeGreaterThan(k1.version);
    expect(k2.key).not.toBe(k1.key);
    expect(k2).toMatchObject({ toCall: 8, canCheck: false, opponents: 1 });
    expect(l4.hand!.pot).toBe(1 + 10 + 2 + 2);
    const ds = hx.decisions();
    expect(ds.length).toBe(2);
    expect(ds.map((d) => d.record.context!.version)).toEqual([k1.version, k2.version]);
    expect(ds[1].record.decision.ranges.length).toBe(1); // ranges rebuilt for the one opponent left
    expect(hx.clicks).toEqual([]); // recommendation-only: nothing is ever clicked
  });

  it('29. Hero folds: explicit status, no further decisions for the hand', async () => {
    const hx = harness();
    const s = new Sim(4, 3, { heroCards: '7c 2d' });
    await hx.show(s.obs());
    act(s.h, 'fold'); // Hero (first to act) folds
    const l = await hx.show(s.obs());
    expect(l.status).toBe(MSG.heroFolded);
    expect(l.tracker.heroStatus).toBe('folded');
    act(s.h, 'raise', 6); act(s.h, 'call');
    const l2 = await hx.show(s.obs());
    expect(l2.status).toBe(MSG.heroFolded);
    expect(l2.recommendation.state).toBe('none');
    expect(hx.decisions().length).toBeLessThanOrEqual(1);
    expect(l2.participation.find((p) => p.isHero)).toMatchObject({ folded: true, eligibleForPot: false, canAct: false });
  });

  it('30. Hero all-in: explicit status, still contests the pot, no further decisions', async () => {
    const hx = harness();
    const s = new Sim(3, 0, { heroCards: 'As Ah', stacks: [20, 200, 200] });
    await hx.show(s.obs());
    act(s.h, 'raise', 20); // Hero shoves
    const l = await hx.show(s.obs());
    expect(l.status).toBe(MSG.heroAllIn);
    expect(l.participation.find((p) => p.isHero)).toMatchObject({ allIn: true, eligibleForPot: true, canAct: false, folded: false });
    act(s.h, 'call'); act(s.h, 'call'); s.flop();
    const l2 = await hx.show(s.obs());
    expect(l2.status).toBe(MSG.heroAllIn);
    expect(l2.hand!.counts).toMatchObject({ contesting: 3, allIn: 1, canAct: 2, opponentsContesting: 2 });
    expect(hx.decisions().length).toBe(1);
  });
});

describe('participation (scenarios 12, 13, 14, 15, 16, 17, 33)', () => {
  it('12/33. a player who sits down mid-hand, or is seated without cards, is not in the hand', () => {
    const s = new Sim(4, 0);
    const t = new HandTracker();
    const o0 = s.obs();
    // Seat 8 is seated from the start but was not dealt cards.
    o0.seats.push({ seat: 8, name: 'Waiting', playerId: 'w8', stack: 300, bet: 0, folded: false, sittingOut: false, isHero: false, hasCards: false, shownCards: null });
    feed(t, o0);
    expect(t.state.participation.find((p) => p.seat === 8)).toMatchObject({ dealtIn: false, waitingForNextHand: true, sittingOut: false, canAct: false, eligibleForPot: false });
    expect(tableCounts(t.state.hand!, 0)).toMatchObject({ seated: 5, dealtIn: 4 });
    act(s.h, 'call'); // Hero (first to act 4-handed is seat 3? no: button 0, SB 1, BB 2, first seat 3)
    const o1 = s.obs();
    o1.seats.push({ ...o0.seats[o0.seats.length - 1] });
    // Seat 9 joins while the hand is in progress.
    o1.seats.push({ seat: 9, name: 'Late', playerId: 'l9', stack: 500, bet: 0, folded: false, sittingOut: false, isHero: false, hasCards: false, shownCards: null });
    feed(t, o1);
    expect(t.state.valid).toBe(true);
    expect(t.state.blockers).toEqual([]);
    expect(t.state.hand!.seats.some((x) => x.seat === 9)).toBe(false);
    expect(t.state.participation.find((p) => p.seat === 9)).toMatchObject({ present: true, dealtIn: false, waitingForNextHand: true, position: null });
    expect(tableCounts(t.state.hand!, 0).dealtIn).toBe(4);
    expect(t.state.predictedActor).toBe(s.h.toAct);
  });

  it('13/16. a player leaves between hands and another sits out: neither is in the next hand\'s order', () => {
    const s = new Sim(5, 0);
    const t = new HandTracker();
    feed(t, s.obs());
    for (let i = 0; i < 4; i++) { act(s.h, 'fold'); feed(t, s.obs()); }
    // Next hand: seat 4 has left, seat 3 sits out.
    s.next(5, { seats: [0, 1, 2, 3], sitOut: [3], button: 1, id: 'h2' });
    feed(t, s.obs());
    const h = t.state.hand!;
    expect(h.seats.filter((x) => x.dealtIn).map((x) => x.seat)).toEqual([0, 1, 2]);
    expect(h.seats.find((x) => x.seat === 1)!.pos!.label).toBe('BTN');
    expect(t.state.participation.find((p) => p.seat === 3)).toMatchObject({ dealtIn: false, sittingOut: true, waitingForNextHand: false });
    expect(t.state.participation.some((p) => p.seat === 4)).toBe(false);
    expect(t.state.predictedActor).toBe(1); // three-handed: the button acts first
    expect(t.state.turnStatus).toBe('agree');
  });

  it('14/15. a disconnected player who was dealt in stays in the hand; one who vanishes is not assumed folded; reconnecting changes nothing', () => {
    const s = new Sim(4, 0);
    const t = new HandTracker();
    const o0 = s.obs();
    o0.seats.find((x) => x.seat === 2)!.disconnected = true; // the big blind is offline but has cards and a blind
    feed(t, o0);
    expect(t.state.hand!.seats.find((x) => x.seat === 2)!.dealtIn).toBe(true);
    expect(t.state.participation.find((p) => p.seat === 2)).toMatchObject({ disconnected: true, dealtIn: true, canAct: true });
    act(s.h, 'call'); act(s.h, 'call'); act(s.h, 'call'); // seat 3, Hero, small blind call: big blind (seat 2) to act
    const gone = s.obs();
    gone.seats = gone.seats.filter((x) => x.seat !== 2); // the seat is no longer drawn at all
    gone.toActSeat = 2;
    feed(t, gone);
    const p = t.state.participation.find((x) => x.seat === 2)!;
    expect(p).toMatchObject({ present: false, left: true, folded: false, dealtIn: true, eligibleForPot: true });
    expect(t.state.predictedActor).toBe(2);
    expect(kinds(t)).toEqual(['3:call', '0:call', '1:call']);
    // Reconnects: same seat, same state, nothing replayed twice.
    const back = s.obs();
    feed(t, back);
    expect(t.state.participation.find((x) => x.seat === 2)).toMatchObject({ present: true, left: false, disconnected: false, folded: false });
    expect(kinds(t)).toEqual(['3:call', '0:call', '1:call']);
    expect(t.state.valid).toBe(true);
    // If instead the action moves past the vanished seat, the only zero-chip action is recorded, marked unconfirmed.
    act(s.h, 'check'); s.flop();
    const moved = s.obs();
    moved.seats = moved.seats.filter((x) => x.seat !== 2);
    feed(t, moved);
    const last = t.state.meta.filter((m) => m.inferred).pop()!;
    expect(last).toMatchObject({ source: 'street-advanced', uncertain: true });
    expect(t.state.hand!.street).toBe('flop');
  });

  it('17. a fold shown before the player\'s turn is applied when the action reaches that seat, in order', () => {
    const s = new Sim(5, 2);
    const t = new HandTracker();
    feed(t, s.obs());
    const early = s.obs();
    early.seats.find((x) => x.seat === 0)!.folded = true; // the button folds out of turn while seat 3 is thinking
    early.seats.find((x) => x.seat === 0)!.hasCards = false;
    feed(t, early);
    expect(kinds(t)).toEqual([]);
    expect(t.state.predictedActor).toBe(3);
    expect(t.state.valid).toBe(true);
    act(s.h, 'call'); act(s.h, 'call'); act(s.h, 'fold');
    feed(t, s.obs());
    expect(kinds(t)).toEqual(['3:call', '4:call', '0:fold']);
    expect(t.state.predictedActor).toBe(1);
  });
});

describe('all-in, side pots and chip accounting (scenarios 18, 19, 20, 25, 26)', () => {
  it('18/19/20. several all-ins of different sizes: side pots, no further actor, chips conserved, same result as the truth', () => {
    const s = new Sim(4, 3, { stacks: [50, 120, 200, 200] });
    const start = totalChips(s.h);
    const t = new HandTracker();
    feed(t, s.obs());
    act(s.h, 'raise', 6); feed(t, s.obs()); // Hero (seat 3) opens
    act(s.h, 'raise', 50); feed(t, s.obs()); // button all-in for 50
    act(s.h, 'raise', 120); feed(t, s.obs()); // small blind all-in for 120
    act(s.h, 'fold'); feed(t, s.obs()); // big blind folds
    expect(t.state.predictedActor).toBe(3);
    expect(t.state.legal.actions).toMatchObject({ callAmount: 114, canRaise: false }); // nobody left to raise against
    expect(t.state.participation.filter((p) => p.allIn).map((p) => p.seat)).toEqual([0, 1]);
    expect(t.state.participation.filter((p) => p.allIn).every((p) => p.eligibleForPot && !p.canAct)).toBe(true);
    act(s.h, 'call'); feed(t, s.obs());
    expect(t.state.predictedActor).toBeNull();
    expect(t.state.heroStatus).toBe('awaiting-board');
    s.flop(); feed(t, s.obs()); s.card(30); feed(t, s.obs());
    expect([t.state.hand!.street, t.state.predictedActor]).toEqual(['turn', null]); // run-out: nobody can bet
    s.card(31);
    const done = feed(t, s.obs()); // the hands are face up: the tracker settles the pots itself
    completeHand(s.h, (seat) => evaluateHand([...s.holes.get(seat)!, ...s.h.board]));
    const h = t.state.hand!;
    expect(h.phase).toBe('complete');
    expect(totalChips(h)).toBe(start);
    for (const e of s.h.seats) expect(h.seats.find((x) => x.seat === e.seat)!.stack).toBe(e.stack);
    expect(new Set(h.seats.map((x) => x.stack)).size).toBeGreaterThan(2); // a main pot and a side pot were paid
    expect(done.length).toBe(0); // emitted on the first of the two identical reads
  });

  it('25. a pot that does not match is reported, never adopted, and does not hide the hand', () => {
    const s = new Sim(4, 3);
    const t = new HandTracker();
    feed(t, s.obs());
    const o = s.obs();
    o.pot = (o.pot as number) + 1;
    feed(t, o);
    expect(t.state.warnings.join(' ')).toMatch(/pot mismatch: engine 3 .* table 4/);
    expect(t.state.blockers).toEqual([]);
    expect(t.state.consistency).toBe('warnings');
    expect(potTotal(t.state.hand!)).toBe(3);
    expect(t.state.discrepancies.some((d) => d.kind === 'pot' && !d.blocking)).toBe(true);
    // Both display conventions are accepted: total including bets, or chips from earlier streets only.
    act(s.h, 'call'); act(s.h, 'call'); act(s.h, 'call'); act(s.h, 'check'); s.flop(); act(s.h, 'bet', 4);
    const flop = s.obs(); flop.pot = 8;
    feed(t, flop);
    expect(t.state.warnings).toEqual([]);
  });

  it('26. a live stack that does not match blocks the decision and is not silently corrected', async () => {
    const s = new Sim(4, 3);
    const t = new HandTracker();
    feed(t, s.obs());
    const o = s.obs();
    o.seats.find((x) => x.seat === 1)!.stack = 201; // engine has 199 after the small blind
    feed(t, o);
    expect(t.state.blockers.join(' ')).toMatch(/stack mismatch seat 1 .*engine 199, table 201/);
    expect(t.state.consistency).toBe('reconciliation-required');
    expect(t.state.hand!.seats.find((x) => x.seat === 1)!.stack).toBe(199);
    const hx = harness();
    const s2 = new Sim(4, 3);
    const l0 = await hx.show(s2.obs());
    expect(l0.recommendation.state).toBe('ready');
    const o2 = s2.obs();
    o2.seats.find((x) => x.seat === 1)!.stack = 201;
    const l = await hx.show(o2);
    expect(l.recommendation.state).toBe('blocked');
    expect(l.status.startsWith(MSG.unavailable)).toBe(true);
    expect(l.decision).toBeNull(); // the recommendation made a moment earlier is not left on screen
    expect(l.readiness.consistency.level).toBe('bad');
    expect(hx.sent.some((m) => m.type === 'bot/diag' && /recommendation suppressed/.test(m.record.message))).toBe(true);
  });

  it('a blind the engine posts where the table shows none is a blocker with an explanation (wrong button or dead blind)', () => {
    const s = new Sim(4, 3);
    const t = new HandTracker(4000, 0.011, 120, 0); // no start-up wait
    const o = s.obs();
    // The table shows the blinds one seat further round than the button implies.
    o.seats.find((x) => x.seat === 1)!.bet = 0; o.seats.find((x) => x.seat === 1)!.stack = 200;
    o.seats.find((x) => x.seat === 3)!.bet = 2; o.seats.find((x) => x.seat === 3)!.stack = 198;
    o.seats.find((x) => x.seat === 2)!.bet = 1; o.seats.find((x) => x.seat === 2)!.stack = 199;
    o.toActSeat = null; o.heroToAct = false; o.controls = { fold: false, check: false, call: null, raise: false, minRaiseTo: null, maxRaiseTo: null };
    feed(t, o);
    expect(t.state.blockers.join(' ')).toMatch(/engine has seat 1 .* with 1 in front this street, table shows 0/);
    expect(t.state.consistency).toBe('reconciliation-required');
  });
});

describe('observed versus predicted actor (scenarios 21, 22, 23, 24)', () => {
  it('21. the table shows a seat acting that the engine has as folded: reported as a disagreement, nothing is forced', async () => {
    const s = new Sim(5, 2);
    const t = new HandTracker();
    feed(t, s.obs());
    act(s.h, 'fold'); feed(t, s.obs());
    const o = s.obs();
    o.toActSeat = 3; // the seat that folded
    feed(t, o);
    // For a moment this is what PokerNow really shows (the highlight lags on the seat that just acted): not a finding yet.
    expect([t.state.observedActor, t.state.predictedActor, t.state.turnStatus, t.state.actorLagging]).toEqual([3, 4, 'unobserved', true]);
    expect(t.state.blockers).toEqual([]);
    t.ingest({ ...o, ts: o.ts + 2000 }); // it stays there: now it is a disagreement
    expect([t.state.observedActor, t.state.predictedActor, t.state.turnStatus]).toEqual([3, 4, 'disagree']);
    expect(t.state.blockers.join(' ')).toMatch(/table shows seat 3 to act, engine expects seat 4/);
    expect(t.state.discrepancies.some((d) => d.kind === 'turn' && d.blocking)).toBe(true);
    expect(kinds(t)).toEqual(['3:fold']); // no action was invented to make them agree
    // Hero's turn shown while the engine expects someone whose chips say they did act but show no bet.
    const hx = harness();
    const s2 = new Sim(5, 2);
    await hx.show(s2.obs());
    const bad = s2.obs();
    bad.heroToAct = true; bad.toActSeat = 2;
    bad.controls = { fold: true, check: true, call: null, raise: true, minRaiseTo: 4, maxRaiseTo: 200 };
    bad.seats.find((x) => x.seat === 3)!.stack = 190; // chips left the stack, no bet is shown
    const l = await hx.show(bad);
    expect(l.recommendation.state).toBe('blocked');
    expect(l.status.startsWith(MSG.unavailable)).toBe(true);
    expect(l.readiness.turn.level).toBe('bad');
    expect(l.readiness.decision.level).toBe('bad');
    expect(l.tracker.turnStatus).toBe('disagree');
    expect(l.decision).toBeNull();
  });

  it('deductions are withdrawn when they contradict Hero\'s buttons', () => {
    const s = new Sim(5, 1);
    const t = new HandTracker();
    feed(t, s.obs({ hideFolds: true }));
    act(s.h, 'call'); act(s.h, 'call'); act(s.h, 'fold');
    const o = s.obs({ hideFolds: true });
    o.controls.call = 9; // the button says 9 to call: something bigger was missed
    feed(t, o);
    expect(t.state.blockers.join(' ')).toMatch(/call button shows 9: deductions withdrawn/);
    expect(t.state.predictedActor).toBe(0); // the confirmed state is kept
    expect(kinds(t)).toEqual(['3:call', '4:call']);
    expect(t.state.meta.some((m) => m.inferred)).toBe(false);
  });

  it('22. actions missed between two reads are replayed in order from the chips on the table', () => {
    const s = new Sim(6, 2);
    const t = new HandTracker();
    feed(t, s.obs());
    act(s.h, 'raise', 6); act(s.h, 'call'); act(s.h, 'fold'); act(s.h, 'raise', 20); act(s.h, 'fold');
    feed(t, s.obs());
    expect(kinds(t)).toEqual(['3:raise', '4:call', '5:fold', '0:raise', '1:fold']);
    expect(t.state.predictedActor).toBe(2);
    expect(t.state.legal.actions!.callAmount).toBe(18);
    expect(t.state.meta.every((m) => !m.inferred)).toBe(true);
  });

  it('23. the same observation many times produces each action once', () => {
    const s = new Sim(5, 2);
    const t = new HandTracker();
    feed(t, s.obs());
    act(s.h, 'call'); act(s.h, 'raise', 8);
    const o = s.obs();
    for (let i = 0; i < 25; i++) t.ingest({ ...o, ts: o.ts + i * 40 });
    expect(kinds(t)).toEqual(['3:call', '4:raise']);
    expect(new Set(t.state.hand!.events.map((e) => e.id)).size).toBe(t.state.hand!.events.length);
    expect(t.state.meta.length).toBe(t.state.hand!.events.length);
  });

  it('24. stale action buttons after Hero acted are not a new turn and never revive the old recommendation', async () => {
    const hx = harness();
    const s = new Sim(4, 3, { heroCards: 'Ad Kd' });
    const l1 = await hx.show(s.obs());
    expect(l1.recommendation.state).toBe('ready');
    const stale = s.obs(); // the page still shows Hero's buttons ...
    act(s.h, 'raise', 6);
    const after = s.obs();
    stale.seats = after.seats; stale.pot = after.pot; // ... but Hero's chips have already gone in
    const l2 = await hx.show(stale);
    expect(l2.decision).toBeNull();
    expect(l2.recommendation.state).not.toBe('ready');
    const l3 = await hx.show(after);
    expect(l3.recommendation.state).toBe('none');
    expect(l3.tracker.blockers).toEqual([]);
    expect(hx.decisions().length).toBe(1);
  });
});

describe('snapshots in transition (scenarios 27, 28, 35)', () => {
  it('27. a missing timer does not block a decision', async () => {
    const hx = harness();
    const s = new Sim(3, 0, { heroCards: 'Qs Qd' });
    const o = s.obs();
    expect(o.timeRemainingMs).toBeNull();
    const l = await hx.show(o);
    expect(hx.health.timer).toBe(false);
    expect(l.recommendation.state).toBe('ready');
    expect(l.readiness.observation.level).toBe('ok');
    expect(l.readiness.observation.detail).toMatch(/timer/);
    expect(l.deadlineMs).not.toBeNull();
  });

  it('28. a new hand begins while the old board is still on screen: the new hand starts cleanly once the table clears', () => {
    const s = new Sim(4, 0);
    const t = new HandTracker();
    feed(t, s.obs());
    act(s.h, 'call'); act(s.h, 'call'); act(s.h, 'call'); act(s.h, 'check'); s.flop();
    feed(t, s.obs());
    const oldBoard = s.h.board.slice();
    s.next(4, { button: 1, id: 'h2' });
    s.holes.set(0, [36, 37]);
    const mixed = s.obs();
    mixed.board = oldBoard; // new cards and blinds, old board
    const done = feed(t, mixed);
    expect(t.state.hand).toBeNull();
    expect(t.state.waitingReason).toMatch(/previous board is still showing/);
    expect(done.length).toBe(0);
    feed(t, s.obs());
    expect(t.state.hand!.buttonSeat).toBe(1);
    expect(t.state.hand!.board.length).toBe(0);
    expect(t.state.predictedActor).toBe(s.h.toAct);
    expect(t.state.handsSeen).toBe(2);
  });

  it('35. new cards with the button still drawn on its old seat: the hand waits ("initialising") instead of starting with wrong blinds', () => {
    const s = new Sim(4, 0);
    const t = new HandTracker();
    feed(t, s.obs());
    for (let i = 0; i < 3; i++) { act(s.h, 'fold'); feed(t, s.obs()); }
    s.next(4, { button: 1, id: 'h2' });
    s.holes.set(0, [36, 37]);
    const mixed = s.obs();
    mixed.dealerSeat = 0; // the button has not moved yet in this snapshot
    t.ingest(mixed);
    expect(t.state.hand).toBeNull();
    expect(t.state.phase).toBe('initialising');
    expect(t.state.waitingReason).toMatch(/hand starting: the button on seat 0 puts a blind of 1 on seat 1/);
    const clean = s.obs();
    clean.ts = mixed.ts + 300;
    feed(t, clean);
    const h = t.state.hand!;
    expect(h.buttonSeat).toBe(1);
    expect(h.seats.find((x) => x.pos?.isSmallBlind)!.seat).toBe(2);
    expect(h.seats.find((x) => x.pos?.isBigBlind)!.seat).toBe(3);
    expect(t.state.blockers).toEqual([]);
    expect(t.state.handsSeen).toBe(2);
  });
});

describe('diagnostic recorder, debug bundle and replay', () => {
  async function recordedSession() {
    const hx = harness();
    const s = new Sim(5, 1, { heroCards: '8h 4h' });
    await hx.show(s.obs({ hideFolds: true }));
    act(s.h, 'call'); await hx.show(s.obs({ hideFolds: true }));
    act(s.h, 'call'); act(s.h, 'fold'); await hx.show(s.obs({ hideFolds: true }));
    act(s.h, 'call'); act(s.h, 'check'); s.flop(); await hx.show(s.obs({ hideFolds: true }));
    act(s.h, 'check'); await hx.show(s.obs({ hideFolds: true }));
    return { hx, s };
  }

  it('records one frame per meaningful change with observation, both actors, legal actions and the decision or the reason it was withheld', async () => {
    const { hx } = await recordedSession();
    const frames = hx.frames();
    expect(frames.length).toBeGreaterThan(5);
    expect(frames.length).toBeLessThan(40); // unchanged reads are not recorded
    expect(frames.map((f) => f.n)).toEqual(frames.map((_, i) => i));
    const ready = frames.find((f) => f.decision.state === 'ready')!;
    expect(ready.tracker).toMatchObject({ observedActor: 1, predictedActor: 1, turnStatus: 'agree', heroSeat: 1, heroCards: ['8h', '4h'], buttonSeat: 0, smallBlindSeat: 1, bigBlindSeat: 2 });
    expect(ready.tracker.legal.actions).toMatchObject({ callAmount: 1 });
    expect(ready.decision.label).toBeTruthy();
    expect(ready.obs.controls.call).toBe(1);
    expect(ready.tracker.participation.length).toBe(5);
    // First sight of the hidden fold: not yet a finding, nothing shown, and the reason is on record.
    const waiting = frames.find((f) => f.obs.heroToAct && f.decision.state === 'none');
    expect(waiting?.decision.reason).toMatch(/waiting for a stable snapshot.*table still updating/);
    expect(frames.some((f) => f.decision.state === 'blocked')).toBe(false);
    const all = frames.flatMap((f) => f.events);
    expect(all.map((e) => e.seq)).toEqual(all.map((_, i) => i)); // every action exactly once, in order
    expect(all.find((e) => e.kind === 'fold' && e.seat === 0)).toMatchObject({ inferred: true, source: 'turn-passed' });
    // Nothing beyond what the player sees.
    expect(JSON.stringify(frames)).not.toMatch(/cookie|token|password|authorization/i);
    expect(frames.every((f) => f.obs.seats.every((x) => x.isHero || x.shownCards === null))).toBe(true);
  });

  it('exports a bundle (all hands, one hand, anonymised) that survives JSON and replays to the same reconstruction', async () => {
    const { hx } = await recordedSession();
    const frames = hx.frames();
    const live = hx.c.tracker.state;
    const bundle = buildBundle(frames, { hands: 'all', anonymise: false, extensionVersion: '0.4.0-test', settings: { mode: 'recommend' }, diagnostics: hx.sent.filter((m) => m.type === 'bot/diag') });
    expect(bundle.hands.length).toBe(1);
    expect(bundle.hands[0].startsAtHandStart).toBe(true);
    expect(bundle.build.extensionVersion).toBe('0.4.0-test');
    expect(bundle.dropped.sequenceGaps).toBe(0);
    const parsed = parseBundle(JSON.parse(JSON.stringify(bundle)));
    const r = replayObservations(parsed.hands[0].frames);
    expect(r.hands.length).toBe(1);
    expect(r.hands[0].timeline.map((e) => e.text)).toEqual(buildTimeline(live.hand!, live.meta).map((e) => e.text));
    expect(r.hands[0].timeline.map((e) => [e.inferred, e.source])).toEqual(buildTimeline(live.hand!, live.meta).map((e) => [e.inferred, e.source]));
    expect(r.hands[0].firstDivergence).toBeNull();
    expect(r.framesHeroTurnUsable).toBeGreaterThan(0);
    const text = formatReplay(r);
    expect(text).toMatch(/Preflop:/);
    expect(text).toMatch(/BTN: Fold .*\[deduced\]/);
    expect(formatTimeline(r.hands[0].timeline)).toMatch(/Flop:/);
    // One hand by key, and a wrong key gives an empty, still valid bundle.
    expect(buildBundle(frames, { hands: { handKey: bundle.hands[0].handKey as string }, anonymise: false, extensionVersion: 't' }).hands.length).toBe(1);
    expect(buildBundle(frames, { hands: { handKey: 'nope' }, anonymise: false, extensionVersion: 't' }).hands.length).toBe(0);
    // Anonymised: no player name or table id remains, and it still replays identically.
    const anon = buildBundle(frames, { hands: 1, anonymise: true, extensionVersion: 't' });
    const json = JSON.stringify(anon);
    expect(json).not.toMatch(/p0|p1|p2|p3|p4|"test"/);
    expect(replayObservations(parseBundle(JSON.parse(json)).hands[0].frames).hands[0].timeline.map((e) => e.text)).toEqual(r.hands[0].timeline.map((e) => e.text));
    expect(() => parseBundle({ format: 'something-else' })).toThrow(/not a poker-bot-debug-bundle/);
  });

  it('replay pinpoints the first frame where the table and the reconstruction part ways', async () => {
    const s = new Sim(5, 2);
    const obs: TableObs[] = [];
    const push = (o: TableObs) => { obs.push(o, { ...o, ts: o.ts + 200 }); };
    push(s.obs());
    act(s.h, 'call'); push(s.obs());
    const bad = s.obs(); bad.seats.find((x) => x.seat === 4)!.stack = 150; bad.toActSeat = 0; push(bad); // chips vanish from seat 4, action shown on the button
    const r = replayObservations(obs.map((o) => ({ obs: o })));
    expect(r.hands[0].firstDivergence).not.toBeNull();
    expect(r.hands[0].firstDivergence!.index).toBe(5);
    expect(r.hands[0].firstDivergence!.message).toMatch(/table shows seat 0 to act, engine expects seat 4|stack mismatch seat 4/);
    expect(r.hands[0].timeline.filter((e) => !e.kind.startsWith('post')).map((e) => e.text)).toEqual(['HJ: Call 2']);
  });

  it('stores frames locally with a hard cap and counts what was pruned', async () => {
    const { hx } = await recordedSession();
    const frames = hx.frames();
    const store = new BotStorage(new IDBFactory());
    expect(frames.length).toBeGreaterThan(6);
    await store.saveFrames(frames, 5);
    const kept = await store.recentFrames();
    expect(kept.length).toBe(5);
    expect(kept.map((f) => f.n)).toEqual(frames.slice(-5).map((f) => f.n)); // oldest first, newest kept
    expect(await store.framesPruned()).toBe(frames.length - 5);
    const b = buildBundle(kept, { hands: 'all', anonymise: false, extensionVersion: 't', framesPruned: await store.framesPruned() });
    expect(b.hands[0].startsAtHandStart).toBe(false);
    expect(b.dropped.note).toMatch(/do not start at the hand's first observation/);
    await store.clear(['frames', 'meta']);
    expect((await store.recentFrames()).length).toBe(0);
  });

  it('recording can be switched off', async () => {
    const hx = harness({ recordDiagnostics: false });
    const s = new Sim(3, 0);
    await hx.show(s.obs());
    expect(hx.frames()).toEqual([]);
    expect(hx.c.snapshot().recorder).toMatchObject({ enabled: false, recorded: 0 });
  });
});

describe('page reading', () => {
  it('an offline marker is not "sitting out", and the raw class list and button texts are kept for diagnostics', () => {
    const s = new Sim(4, 3);
    const o = s.obs();
    const html = toHtml(o).replace('table-player table-player-2', 'table-player table-player-2 offline');
    const dom = new JSDOM(`<body>${html}</body>`, { url: 'https://www.pokernow.club/games/abc' });
    const read = new PokerNowDom(dom.window.document).observe(5);
    const bb = read.seats.find((x) => x.seat === 2)!;
    expect(bb).toMatchObject({ disconnected: true, sittingOut: false, hasCards: true, bet: 2 });
    expect(bb.cls).toMatch(/table-player-2 offline/);
    expect(read.raw!.buttons.join(' ')).toMatch(/call\|Call 2/);
    expect(read.raw!.signal).toBe('Your Turn');
    const t = new HandTracker();
    feed(t, read);
    expect(t.state.hand!.seats.find((x) => x.seat === 2)!.dealtIn).toBe(true);
    expect(t.state.predictedActor).toBe(3);
  });
});
