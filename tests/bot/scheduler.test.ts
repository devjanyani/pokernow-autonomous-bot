// Authorised-play action scheduling (0.9.1): the timing rules of ActionScheduler, and the whole live controller on a
// simulated table with an injected manual clock and seeded randomness (deterministic: no real timers decide anything).
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { CardId, parseCards, Rng, shuffledDeck } from '../../src/bot/cards';
import { evaluateHand } from '../../src/core/equity/hand-eval';
import { GuardedExecutor } from '../../src/bot/adapter/executor';
import { HandTracker } from '../../src/bot/adapter/tracker';
import { ControllerDeps, LiveController } from '../../src/bot/ext/controller';
import { popupView } from '../../src/bot/ext/popup';
import { BotMessage, DecisionRecord, DEFAULT_SETTINGS, executionStatus, LiveState, mayAct, sanitizeSettings, Settings } from '../../src/bot/ext/records';
import { ActionScheduler, drawDelay, TimingPolicy } from '../../src/bot/ext/scheduler';
import { BotStorage } from '../../src/bot/ext/storage';
import { scheduleRows, strategyTag } from '../../src/bot/ext/view';
import { archetypePolicy } from '../../src/bot/sim/policies';
import { Policy } from '../../src/bot/sim/table';
import { applyAction, awaitingBoard, completeHand, createHand, dealBoard, HandState, legalActions, totalChips } from '../../src/bot/table/engine';
import { render } from './render';

const POLICY: TimingPolicy = { mode: 'random', minDelayMs: 4000, maxDelayMs: 20000, deadlineMarginMs: 3000, assumedClockMs: 20000 };

describe('ActionScheduler timing rules (pure, injected clock and random source)', () => {
  it('draws one delay per opportunity, uniform within the bounds, and never redraws it for repeated reads', () => {
    let t = 1000;
    const rng = new Rng(4);
    const s = new ActionScheduler(() => t, () => rng.next());
    const ds: number[] = [];
    for (let k = 0; k < 400; k++) {
      const p = s.plan(`h${k}|flop|7`, t, { at: t + 60000, observed: true }, POLICY, false);
      ds.push(p.targetDelayMs);
      expect(p.dueAt).toBe(p.startedAt + p.targetDelayMs);
      expect(p.conflict).toBeNull();
      // Many more frames of the same opportunity: same plan, same start, same delay.
      t += 300;
      for (let i = 0; i < 5; i++) expect(s.plan(`h${k}|flop|7`, t + i, { at: null, observed: false }, POLICY, false)).toMatchObject({ startedAt: p.startedAt, targetDelayMs: p.targetDelayMs });
    }
    expect(Math.min(...ds)).toBeGreaterThanOrEqual(4000);
    expect(Math.max(...ds)).toBeLessThanOrEqual(20000);
    // Spread over the whole range (uniform: each quarter gets roughly a quarter).
    for (let q = 0; q < 4; q++) {
      const n = ds.filter((d) => d >= 4000 + q * 4000 && d < 8000 + q * 4000).length;
      expect(n).toBeGreaterThan(60);
      expect(n).toBeLessThan(140);
    }
    // Randomisation off: always the minimum.
    expect(drawDelay({ ...POLICY, maxDelayMs: 4000 }, () => 0.99)).toBe(4000);
    expect(drawDelay({ ...POLICY, mode: 'instant' }, () => 0.99)).toBe(0);
  }, 60000);

  it('a deadline shorter than the minimum: the minimum is not met, the action is due at the latest safe moment, the conflict is stated', () => {
    const s = new ActionScheduler(() => 0, () => 0.9);
    const p = s.plan('k', 0, { at: 5000, observed: true }, POLICY, false);
    expect(p.dueAt).toBe(2000); // 5 s clock − 3 s margin
    expect(p.conflict).toMatch(/observed deadline leaves 2\.0 s before the 3\.0 s safety margin, less than the 4\.0 s minimum/);
    // Already inside the margin: due at once.
    expect(s.plan('k2', 0, { at: 2000, observed: true }, POLICY, false).dueAt).toBe(0);
  }, 60000);

  it('unknown deadline: the assumed clock from the start of the turn, never unlimited; a long draw is shortened to it', () => {
    const s = new ActionScheduler(() => 0, () => 0.99);
    const p = s.plan('k', 0, { at: null, observed: false }, POLICY, false);
    expect(p.deadlineSource).toBe('assumed');
    expect(p.deadlineAt).toBe(20000);
    expect(p.dueAt).toBe(17000);
    expect(p.capped).toMatch(/shortened to 17\.0 s by the assumed deadline/);
    // A clock that appears later moves only the deadline, not the start or the delay.
    const q = s.plan('k', 999, { at: 12000, observed: true }, POLICY, false);
    expect(q).toMatchObject({ startedAt: 0, deadlineSource: 'observed', dueAt: 9000 });
    // Opened during Hero's turn with no clock shown: only the minimum (the turn may have begun earlier).
    expect(s.plan('j', 0, { at: null, observed: false }, POLICY, true)).toMatchObject({ targetDelayMs: 4000, dueAt: 4000, deadlineSource: 'assumed, joined mid-turn' });
  }, 60000);

  it('cancel() wakes a waiting action at once, records the reason, and the action is not due any more', async () => {
    let t = 0;
    const s = new ActionScheduler(() => t, () => 0.5);
    s.plan('k', 0, { at: null, observed: false }, POLICY, false);
    s.arm({ key: 'k', label: 'CALL', decidedBy: 'v2', fallback: null, computeMs: 100 });
    // A sleep that never ends on its own: only cancel() can end the wait.
    const w = s.waitUntilDue('k', () => new Promise<void>(() => {}), () => false);
    t = 1500;
    s.cancel('emergency stop');
    expect(await w).toBe(false);
    expect(s.pending).toBeNull();
    expect(s.lastCancel).toMatchObject({ key: 'k', label: 'CALL', reason: 'emergency stop', at: 1500 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The live controller on a simulated table, with a manual clock.

const AUTH = { mode: 'autonomous' as const, authorizationConfirmed: true, authorizedTables: ['test'] };

class Rig {
  t = 0;
  private sleeps: { at: number; resolve: () => void }[] = [];
  h!: HandState;
  holes = new Map<number, [CardId, CardId]>();
  readonly clicks: { kind: string; at: number; key: string }[] = [];
  readonly sent: BotMessage[] = [];
  readonly store = new BotStorage(new IDBFactory());
  /** Observed action clock in ms (null: the page shows none). Counted from when Hero's turn began on the table. */
  clockMs: number | null = null;
  private turnId = '';
  private turnSince = 0;
  /** When false the table ignores the bot's clicks (to test that nothing is clicked twice). */
  register = true;
  /** Reads that do not show Hero's turn yet (the page was open before the turn began). */
  hideTurn = 0;
  controller: LiveController;
  readonly deps: ControllerDeps;
  private readonly rng: Rng;

  constructor(public settings: Settings, seed = 1) {
    this.rng = new Rng(seed);
    this.deps = {
      observe: () => {
        const o = render(this.h, 0, this.holes, this.t);
        if (this.hideTurn > 0) { this.hideTurn--; o.heroToAct = false; o.toActSeat = null; }
        const id = `${this.h.handId}|${this.h.events.length}|${this.h.toAct}`;
        if (id !== this.turnId) { this.turnId = id; this.turnSince = this.t; }
        if (o.heroToAct && this.clockMs !== null) o.timeRemainingMs = Math.max(0, this.turnSince + this.clockMs - this.t);
        return o;
      },
      health: () => ({ seats: true }),
      driver: {
        click: async (kind) => { this.clicks.push({ kind, at: this.t, key: this.key() }); if (this.register) applyAction(this.h, { seat: 0, kind }); return true; },
        betOrRaise: async (to) => { this.clicks.push({ kind: `raise:${to}`, at: this.t, key: this.key() }); if (this.register) applyAction(this.h, { seat: 0, kind: legalActions(this.h)!.raiseKind, to }); return { submitted: true, readBack: to, detail: 'ok' }; },
      },
      send: (m) => { this.sent.push(m); if (m.type === 'bot/hand') void this.store.saveHand(m.hand, m.profiles); },
      loadProfiles: (ids) => this.store.loadProfiles(ids),
      now: () => this.t,
      sleep: (ms) => new Promise<void>((resolve) => { this.sleeps.push({ at: this.t + ms, resolve }); }),
      // Computation takes (virtual) time: 5 ms per batch.
      yieldFn: async () => { this.t += 5; },
      random: () => this.rng.next(),
      render: () => {},
    };
    this.controller = new LiveController(this.deps, settings, 3);
  }
  key() { return `${this.h.handId}|${this.h.street}|${this.h.events.length}`; }
  set(s: Partial<Settings>) { this.settings = sanitizeSettings({ ...this.settings, ...s }); this.controller.updateSettings(this.settings); }
  async flush() { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); }
  /** Advance the clock in 50 ms steps; the page is read at every step (identical frames while nothing changes). */
  async advance(ms: number) {
    const end = this.t + ms;
    while (this.t < end) {
      this.t = Math.min(end, this.t + 50);
      const due = this.sleeps.filter((s) => s.at <= this.t);
      this.sleeps = this.sleeps.filter((s) => s.at > this.t);
      for (const s of due) s.resolve();
      await this.flush();
      this.controller.tick();
      await this.flush();
    }
  }
  /** A hand at a three-seat table, Hero in seat 0 (on the button: first to act preflop). */
  deal(id: string, heroCards = 'Ah Ad', button = 0, openBefore = true) {
    if (openBefore) this.hideTurn = 1;
    this.h = createHand({ handId: id, buttonSeat: button, smallBlind: 10, bigBlind: 20, seats: [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, stack: 2000 })) });
    const deck = shuffledDeck(new Rng(7)).filter((c) => !parseCards(heroCards).includes(c));
    this.holes = new Map([[0, parseCards(heroCards) as [CardId, CardId]], [1, [deck[0], deck[1]]], [2, [deck[2], deck[3]]]]);
  }
  opp(kind: 'fold' | 'check' | 'call' | 'bet' | 'raise', to?: number) { if (this.h.toAct === 0) throw new Error('Hero to act'); applyAction(this.h, { seat: this.h.toAct!, kind, to }); }
  hero(kind: 'fold' | 'check' | 'call' | 'bet' | 'raise', to?: number) { applyAction(this.h, { seat: 0, kind, to }); }
  board(cards: string) { dealBoard(this.h, parseCards(cards)); }
  live(): LiveState { return this.controller.snapshot(); }
  decisions(): DecisionRecord[] { return this.sent.filter((m): m is Extract<BotMessage, { type: 'bot/decision' }> => m.type === 'bot/decision').map((m) => m.record); }
  /** Advance until the controller has an action waiting (or fail). */
  async untilPending(maxMs = 3000) {
    for (let i = 0; i < maxMs / 50; i++) { if (this.controller.scheduler.pending) return this.controller.scheduler.pending; await this.advance(50); }
    throw new Error(`no pending action: ${this.live().status}`);
  }
  plan() { const p = this.controller.scheduler.pending; return p ? this.controller.scheduler.get(p.key)! : null; }
}

/** Hand v3hu: Hero (BTN) raises preflop through the scheduler, BB calls, BB checks the flop: Hero heads-up after the flop. */
async function toHeadsUpFlop(r: Rig) {
  r.deal('hu', 'Ah Ad');
  await r.advance(50);
  await r.untilPending();
  await r.advance(21000);
  expect(r.clicks.length).toBe(1);
  r.opp('fold'); r.opp('call');
  r.board('Kd 7s 2c');
  r.opp('check');
  await r.advance(50);
}

describe('scheduled execution through the live controller (manual clock, seeded randomness)', () => {
  it('1-2. every action type (fold, check, call, bet, raise) is scheduled by the same policy, within 4-20 s when the clock allows', async () => {
    const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH }), 11);
    r.clockMs = 30000; // an observed 30 s clock leaves the whole 4-20 s range before the 3 s margin
    const rng = new Rng(5);
    const pol: Policy[] = [archetypePolicy('loose-aggressive'), archetypePolicy('loose-aggressive'), archetypePolicy('loose-passive')];
    for (let n = 0; n < 30; n++) {
      r.h = createHand({ handId: `all${n}`, buttonSeat: n % 3, smallBlind: 10, bigBlind: 20, seats: [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, stack: 2000 })) });
      const deck = shuffledDeck(rng);
      r.holes = new Map([0, 1, 2].map((s) => [s, [deck[2 * s], deck[2 * s + 1]] as [CardId, CardId]]));
      const chips = totalChips(r.h);
      await r.advance(50);
      for (let guard = 0; guard < 200 && r.h.phase !== 'complete' && r.h.phase !== 'showdown'; guard++) {
        if (r.h.toAct === 0) { const before = r.h.events.length; await r.advance(1000); if (r.h.events.length === before && r.t > 1e9) break; continue; }
        if (r.h.toAct !== null) { const seat = r.h.toAct; applyAction(r.h, { seat, ...(await pol[seat].act({ h: r.h, seat, hole: r.holes.get(seat)!, la: legalActions(r.h)!, rng: rng.fork(guard) })) }); }
        else if (awaitingBoard(r.h)) dealBoard(r.h, r.h.street === 'preflop' ? deck.slice(40, 43) : [deck[40 + r.h.board.length]]);
        await r.advance(50);
      }
      if (r.h.phase === 'showdown') completeHand(r.h, (s) => evaluateHand([...r.holes.get(s)!, ...r.h.board]));
      await r.advance(100);
      expect(totalChips(r.h)).toBe(chips);
    }
    const ex = r.decisions().filter((d) => d.execution);
    const kinds = new Set(ex.map((d) => d.decision.action));
    for (const k of ['fold', 'check', 'call', 'bet', 'raise']) expect(kinds, `executed kinds ${[...kinds]}`).toContain(k);
    for (const d of ex) {
      const tm = d.execution!.timing!;
      expect(d.execution!.status).toBe('accepted');
      expect(tm.deadlineSource).toBe('observed');
      expect(tm.conflict).toBeNull();
      expect(tm.targetDelayMs).toBeGreaterThanOrEqual(4000);
      expect(tm.targetDelayMs).toBeLessThanOrEqual(20000);
      // Executed when due: within one 50 ms read of the drawn delay (computation is part of the delay).
      expect(tm.actualDelayMs).toBeGreaterThanOrEqual(tm.targetDelayMs);
      expect(tm.actualDelayMs).toBeLessThanOrEqual(tm.targetDelayMs + 60);
      expect(tm.computeMs + tm.waitedMs).toBeCloseTo(tm.actualDelayMs, 0);
      expect(tm.computeMs).toBeLessThan(tm.targetDelayMs);
    }
    // The delay does not depend on the action: the spread is similar for passive and aggressive actions.
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const passive = ex.filter((d) => ['fold', 'check', 'call'].includes(d.decision.action)).map((d) => d.execution!.timing!.targetDelayMs);
    const aggressive = ex.filter((d) => ['bet', 'raise'].includes(d.decision.action)).map((d) => d.execution!.timing!.targetDelayMs);
    expect(passive.length).toBeGreaterThan(5); expect(aggressive.length).toBeGreaterThan(5);
    expect(Math.abs(mean(passive) - mean(aggressive))).toBeLessThan(4500);
    // Each bot click belongs to a different decision point.
    expect(new Set(r.clicks.map((c) => c.key)).size).toBe(r.clicks.length);
  }, 120000);

  it('3. a clock shorter than the minimum: acts at the latest safe moment, not after 4 s, and says so', async () => {
    const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH }), 2);
    r.clockMs = 5000;
    r.deal('short');
    await r.advance(50);
    await r.untilPending();
    expect(r.live().schedule!.pending!.conflict).toMatch(/less than the 4\.0 s minimum: acting at the latest safe moment/);
    expect(scheduleRows(r.live()).find(([k]) => k === 'Deadline conflict')).toBeTruthy();
    await r.advance(4000);
    expect(r.clicks.length).toBe(1);
    expect(r.clicks[0].at).toBeLessThanOrEqual(2000 + 60);
    const tm = r.decisions()[0].execution!.timing!;
    expect(tm.actualDelayMs).toBeLessThan(4000);
    expect(tm.conflict).toMatch(/minimum/);
    expect(r.sent.some((m) => m.type === 'bot/diag' && /deadline conflict/.test(m.record.message))).toBe(true);
  }, 60000);

  it('4. no clock on the page: the assumed clock is used from the start of the turn (17 s latest with the defaults)', async () => {
    const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH, minDelayMs: 18000, maxDelayMs: 20000 }), 3);
    r.deal('noclock');
    await r.advance(50);
    await r.untilPending();
    const p = r.live().schedule!.pending!;
    expect(p.deadlineSource).toBe('assumed');
    // Minimum 18 s cannot fit in 20 s − 3 s: conflict, act at 17 s.
    expect(p.conflict).toMatch(/assumed deadline leaves 17\.0 s/);
    await r.advance(18000);
    expect(r.clicks.length).toBe(1);
    expect(r.clicks[0].at).toBeGreaterThanOrEqual(17000);
    expect(r.clicks[0].at).toBeLessThanOrEqual(17000 + 110);
  }, 60000);

  it('5. repeated identical frames (and a one-frame flicker) never restart the timer or redraw the delay; one click', async () => {
    const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH }), 4);
    r.deal('frames');
    await r.advance(50);
    await r.untilPending();
    const plan = { ...r.plan()! };
    await r.advance(1500); // 30 identical reads
    expect(r.plan()).toMatchObject({ startedAt: plan.startedAt, targetDelayMs: plan.targetDelayMs, dueAt: plan.dueAt });
    // One frame where the page briefly does not show Hero's turn, then the same decision point again.
    const save = r.h.toAct;
    r.h.toAct = 1; r.controller.tick(); r.h.toAct = save;
    await r.advance(30000);
    expect(r.clicks.length).toBe(1);
    expect(r.clicks[0].at).toBeGreaterThanOrEqual(plan.dueAt);
    expect(r.clicks[0].at).toBeLessThanOrEqual(plan.dueAt + 110);
  }, 60000);

  it('6. the actor changes while waiting (the seat acted by hand): the pending action is cancelled and never executed', async () => {
    const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH }), 5);
    r.deal('actor');
    await r.advance(50);
    await r.untilPending();
    r.hero('call'); // clicked by hand on the table
    await r.advance(50);
    expect(r.controller.scheduler.pending).toBeNull();
    expect(r.live().schedule!.lastCancel!.reason).toMatch(/no longer Hero's turn/);
    await r.advance(25000);
    expect(r.clicks).toEqual([]);
  }, 60000);

  it('7. the street changes while waiting: the old action is cancelled; the new street gets its own, newly drawn delay', async () => {
    const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH, mode: 'recommend' }), 6);
    r.deal('street', 'Ah Ad', 1); // button seat 1: Hero (seat 0) is the big blind
    await r.advance(50);
    r.opp('call'); r.opp('call'); // BTN and SB limp; Hero (BB) may check
    await r.advance(50);
    r.hero('check'); r.board('Kd 7s 2c'); r.opp('check');
    await r.advance(50);
    r.set(AUTH);
    await r.untilPending();
    const flop = { ...r.plan()! };
    expect(flop.key).toMatch(/\|flop\|/);
    // By hand: Hero checks, the other two check, the turn comes: Hero first to act on the turn.
    r.hero('check'); r.opp('check'); r.board('5h');
    r.opp('check');
    await r.advance(50);
    expect(r.live().schedule!.lastCancel!.reason).toBe('the street changed');
    const turn = r.plan()!;
    expect(turn.key).toMatch(/\|turn\|/);
    expect(turn.startedAt).toBeGreaterThan(flop.startedAt);
    expect(turn.targetDelayMs).not.toBe(flop.targetDelayMs);
    await r.advance(25000);
    expect(r.clicks.length).toBe(1);
    expect(r.clicks[0].key).toMatch(/\|turn\|/);
  }, 60000);

  it('8. the opponent raises before execution: the stale action is cancelled; the new decision point is decided and timed afresh', async () => {
    const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH }), 7);
    await toHeadsUpFlop(r);
    await r.untilPending();
    const first = { ...r.plan()! };
    // By hand Hero bets; the opponent raises; Hero to act again on the same street, all before the next read.
    r.hero('bet', 40); r.opp('raise', 160);
    await r.advance(50);
    expect(r.live().schedule!.lastCancel!.reason).toMatch(/new action at the table \(state version \d+ -> \d+\)/);
    const second = r.plan()!;
    expect(second.key).not.toBe(first.key);
    await r.advance(25000);
    expect(r.clicks.length).toBe(2); // the preflop raise and one action facing the raise
    expect(r.clicks[1].key.endsWith(second.key.slice(second.key.indexOf('|')))).toBe(true);
  }, 60000);

  it('9-10. authorisation revoked or emergency stop while waiting: cancelled at once, nothing clicked', async () => {
    for (const [change, reason] of [
      [{ authorizedTables: [] }, /execution no longer permitted \(this table is not authorised\)/],
      [{ authorizationConfirmed: false }, /organiser-authorisation confirmation/],
      [{ estop: true }, /^emergency stop$/],
      [{ mode: 'recommend' as const }, /mode changed to recommend/],
    ] as [Partial<Settings>, RegExp][]) {
      const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH }), 8);
      r.deal('revoke');
      await r.advance(50);
      await r.untilPending();
      const at = r.t;
      r.set(change);
      expect(r.controller.scheduler.pending).toBeNull();
      expect(r.controller.scheduler.lastCancel).toMatchObject({ at });
      expect(r.controller.scheduler.lastCancel!.reason).toMatch(reason);
      await r.advance(25000);
      expect(r.clicks).toEqual([]);
      expect(r.live().execution!.enabled).toBe(false);
    }
  }, 60000);

  it('11. strategy switched from v3 to v2 while waiting: v3\'s action is dropped; v2 decides and acts at the same scheduled time', async () => {
    const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH, strategyEngine: 'v3', v3ExecutionOptIn: true }), 9);
    await toHeadsUpFlop(r);
    const p = await r.untilPending();
    expect(p.decidedBy).toBe('v3');
    const due = r.plan()!.dueAt;
    r.set({ strategyEngine: 'v2' });
    expect(r.controller.scheduler.lastCancel!.reason).toBe('strategy changed from v3 to v2');
    await r.advance(25000);
    expect(r.clicks.length).toBe(2);
    expect(r.clicks[1].at).toBeGreaterThanOrEqual(due);
    expect(r.clicks[1].at).toBeLessThanOrEqual(due + 160);
    const last = r.decisions().at(-1)!;
    expect(last.decision.strategy).toMatchObject({ requested: 'v2', used: 'v2' });
  }, 60000);

  it('12. v3 with its execution permission: heads-up after the flop v3 acts; preflop v2 acts, labelled as the fallback', async () => {
    const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH, strategyEngine: 'v3', v3ExecutionOptIn: true }), 10);
    await toHeadsUpFlop(r);
    expect(r.live().execution).toMatchObject({ enabled: true, reason: expect.stringMatching(/version 3 execution permission on/) });
    const pre = r.decisions()[0];
    expect(pre.decision.strategy).toMatchObject({ requested: 'v3', used: 'v2', fallback: expect.stringMatching(/^preflop/) });
    expect(pre.execution!.status).toBe('accepted');
    await r.untilPending();
    expect(strategyTag(r.live())!.text).toBe('v3 experimental');
    await r.advance(25000);
    const flop = r.decisions()[1];
    expect(flop.decision.strategy).toMatchObject({ requested: 'v3', used: 'v3', fallback: null });
    expect(flop.execution!.status).toBe('accepted');
    expect(r.clicks.length).toBe(2);
    expect(r.live().schedule!.lastExecuted!.label).not.toMatch(/fallback/);
    // The preflop execution was labelled.
    expect(r.sent.some((m) => m.type === 'bot/decision' && m.record.execution && m.record.decision.strategy?.fallback)).toBe(true);
  }, 60000);

  it('12b. without the separate permission, or without the organiser confirmation, v3 never clicks', async () => {
    const base = { ...DEFAULT_SETTINGS, ...AUTH, strategyEngine: 'v3' as const };
    expect(mayAct(sanitizeSettings(base), 'test')).toBe(false);
    expect(executionStatus(sanitizeSettings(base), 'test').reason).toMatch(/recommendation-only unless/);
    // The permission cannot stand without the confirmation, and selecting v3 never sets it.
    expect(sanitizeSettings({ ...base, v3ExecutionOptIn: true, authorizationConfirmed: false }).v3ExecutionOptIn).toBe(false);
    expect(sanitizeSettings({ strategyEngine: 'v3' }).v3ExecutionOptIn).toBe(false);
    expect(DEFAULT_SETTINGS.v3ExecutionOptIn).toBe(false);
    expect(mayAct(sanitizeSettings({ ...base, v3ExecutionOptIn: true, authorizedTables: ['other'] }), 'test')).toBe(false);
    expect(popupView(sanitizeSettings(base), 'test', '').state).toMatch(/recommendation-only/);
    expect(popupView(sanitizeSettings({ ...base, v3ExecutionOptIn: true }), 'test', '').state).toMatch(/ACTING automatically on this table with experimental version 3/);
    const r = new Rig(sanitizeSettings(base), 12);
    await toHeadsUpFlopNoClick(r);
    expect(r.clicks).toEqual([]);
  }, 60000);

  it('13. a stale recommendation is never executed: the executor re-reads the table and rejects an older state version', async () => {
    const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH }), 13);
    r.deal('stale');
    const tracker = new HandTracker();
    const ex = new GuardedExecutor(r.deps.driver, () => { const obs = r.deps.observe(); tracker.ingest(obs); return { obs, state: tracker.state }; }, { sleep: async () => {}, now: () => r.t });
    ex.armed = true;
    for (let i = 0; i < 3; i++) tracker.ingest(r.deps.observe());
    const old = { action: 'call' as const, handId: tracker.state.hand!.handId, street: 'preflop' as const, eventCount: tracker.state.eventCount - 1 };
    expect((await ex.execute(old)).reason).toMatch(/stale/);
    expect(r.clicks).toEqual([]);
  }, 60000);

  it('14. never two clicks for one decision point, even when the table does not register the first', async () => {
    const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH }), 14);
    r.register = false; // the page swallows the click: Hero's turn stays shown with the same state
    r.deal('dup');
    await r.advance(50);
    await r.untilPending();
    await r.advance(60000);
    expect(r.clicks.length).toBe(1);
    expect(r.decisions().filter((d) => d.execution).length).toBe(1);
    expect(r.decisions().find((d) => d.execution)!.execution!.status).toBe('unverified');
    // And two concurrent requests for the same point: one click.
    const tracker = new HandTracker();
    const ex = new GuardedExecutor(r.deps.driver, () => { const obs = r.deps.observe(); tracker.ingest(obs); return { obs, state: tracker.state }; }, { sleep: async () => {}, now: () => r.t, verifyTimeoutMs: 0 });
    ex.armed = true;
    for (let i = 0; i < 3; i++) tracker.ingest(r.deps.observe());
    const req = { action: 'fold' as const, handId: tracker.state.hand!.handId, street: 'preflop' as const, eventCount: tracker.state.eventCount };
    const out = await Promise.all([ex.execute(req), ex.execute(req)]);
    expect(out.filter((o) => o.clicked).length).toBe(1);
    expect(out.map((o) => o.reason)).toContain('this decision point was already acted on');
  }, 60000);

  it('15. page reload during a pending action: the old page\'s action is cancelled; the new page waits only the minimum (start unknown) and acts once', async () => {
    const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH }), 15);
    r.deal('reload', 'Ah Ad', 0, false);
    await r.advance(50);
    await r.untilPending();
    const old = r.controller;
    old.cancelPending('the page was closed or reloaded'); // what pagehide does
    expect(old.scheduler.lastCancel!.reason).toBe('the page was closed or reloaded');
    // The reloaded page: a new controller reading the same table, mid-turn.
    r.controller = new LiveController(r.deps, r.settings, 3);
    const start = r.t;
    await r.advance(50);
    const p = await r.untilPending();
    expect(r.controller.scheduler.get(p.key)).toMatchObject({ deadlineSource: 'assumed, joined mid-turn', targetDelayMs: 4000 });
    await r.advance(30000); // the old page's wait, still pending on the shared clock, must not act
    expect(r.clicks.length).toBe(1);
    expect(r.clicks[0].at - start).toBeGreaterThanOrEqual(4000);
    expect(r.clicks[0].at - start).toBeLessThanOrEqual(4000 + 160);
  });
});

/** As toHeadsUpFlop, but nothing is clicked by the bot: the test plays Hero's preflop raise by hand. */
async function toHeadsUpFlopNoClick(r: Rig) {
  r.deal('hu', 'Ah Ad');
  await r.advance(500);
  // Played by hand, one table update per read (as the page would show them).
  for (const step of [() => r.hero('raise', 60), () => r.opp('fold'), () => r.opp('call'), () => r.board('Kd 7s 2c'), () => r.opp('check')]) { step(); await r.advance(100); }
  await r.advance(30000);
  expect(r.live().decision?.strategy?.used ?? r.decisions().at(-1)?.decision.strategy?.used).toBe('v3');
}

// ---------------------------------------------------------------------------------------------------------------
// 0.9.2: two mutually exclusive timing modes, Instant and Random.

describe('timing modes: Instant and Random (0.9.2)', () => {
  it('settings: Random is the default; 0.9.1 settings are migrated without losing the user choice', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ timingMode: 'random', minDelayMs: 4000, maxDelayMs: 20000 });
    expect(sanitizeSettings({})).toMatchObject({ timingMode: 'random', minDelayMs: 4000, maxDelayMs: 20000 });
    // 0.9.1 with the randomised delay on (its default): Random with the stored bounds.
    expect(sanitizeSettings({ randomDelay: true, minDelayMs: 5000, maxDelayMs: 9000 })).toMatchObject({ timingMode: 'random', minDelayMs: 5000, maxDelayMs: 9000 });
    // 0.9.1 with randomisation off and a 0 s minimum was "no waiting": Instant.
    expect(sanitizeSettings({ randomDelay: false, minDelayMs: 0, maxDelayMs: 20000 })).toMatchObject({ timingMode: 'instant', minDelayMs: 4000, maxDelayMs: 20000 });
    // 0.9.1 with randomisation off and a positive minimum was a fixed delay: kept as Random min = max.
    expect(sanitizeSettings({ randomDelay: false, minDelayMs: 6000, maxDelayMs: 20000 })).toMatchObject({ timingMode: 'random', minDelayMs: 6000, maxDelayMs: 6000 });
    // An explicit mode wins over the old field; anything else reads as the default.
    expect(sanitizeSettings({ timingMode: 'instant', randomDelay: true }).timingMode).toBe('instant');
    expect(sanitizeSettings({ timingMode: 'fast' }).timingMode).toBe('random');
    expect('randomDelay' in sanitizeSettings({ randomDelay: false })).toBe(false);
    // Round trip (what storage writes is what it reads back).
    const s = sanitizeSettings({ timingMode: 'instant', minDelayMs: 7000, maxDelayMs: 8000 });
    expect(sanitizeSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('scheduler: Instant draws no delay and never reports a minimum conflict; replan() keeps start and deadline', () => {
    const instant: TimingPolicy = { ...POLICY, mode: 'instant' };
    const s = new ActionScheduler(() => 1000, () => 0.9);
    const p = s.plan('k', 1000, { at: 3500, observed: true }, instant, false); // 2.5 s clock: less than the 3 s margin
    expect(p).toMatchObject({ targetDelayMs: 0, dueAt: 1000, conflict: null });
    const q = s.plan('k2', 1000, { at: null, observed: false }, instant, true); // joined mid-turn
    expect(q.targetDelayMs).toBe(0);
    const r = s.plan('k3', 1000, { at: 3500, observed: true }, POLICY, false);
    expect(r.conflict).toMatch(/less than the 4.0 s minimum/);
    s.replan(POLICY);
    expect(s.get('k')).toMatchObject({ startedAt: 1000, deadlineAt: 3500 });
    expect(s.get('k')!.conflict).toMatch(/minimum/);
    s.replan(instant);
    expect(s.get('k3')).toMatchObject({ targetDelayMs: 0, dueAt: 1000, conflict: null });
  });

  it('Instant with version 2: the action is executed as soon as it is computed and checked, with no intentional wait', async () => {
    const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH, timingMode: 'instant' }), 21);
    r.clockMs = 30000;
    r.deal('inst');
    await r.advance(50);
    const start = r.t;
    await r.advance(2000);
    expect(r.clicks.length).toBe(1);
    expect(r.clicks[0].at - start).toBeLessThan(600);
    const tm = r.decisions().find((d) => d.execution)!.execution!.timing!;
    expect(tm.targetDelayMs).toBe(0);
    expect(tm.waitedMs).toBeLessThanOrEqual(60);
    expect(tm.conflict).toBeNull();
    expect(r.live().schedule!.policy.timingMode).toBe('instant');
    expect(scheduleRows(r.live()).find(([k]) => k === 'Timing mode')![1]).toBe('Instant');
  }, 60000);

  it('Instant with version 3 (permission on): v3 acts heads-up after the flop without waiting; without the permission it never clicks', async () => {
    const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH, timingMode: 'instant', strategyEngine: 'v3', v3ExecutionOptIn: true }), 22);
    await toHeadsUpFlop(r);
    await r.advance(3000);
    expect(r.clicks.length).toBe(2);
    const last = r.decisions().filter((d) => d.execution).at(-1)!;
    expect(last.decision.strategy).toMatchObject({ used: 'v3' });
    expect(last.execution!.timing!.targetDelayMs).toBe(0);
    expect(last.execution!.timing!.actualDelayMs).toBeLessThan(2000);
    expect(last.execution!.timing!.waitedMs).toBeLessThanOrEqual(60);
    const off = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH, timingMode: 'instant', strategyEngine: 'v3' }), 23);
    await toHeadsUpFlopNoClick(off);
    expect(off.clicks).toEqual([]);
  }, 60000);

  it('recommendation-only (and manual) never click, whatever the timing mode', async () => {
    for (const mode of ['recommend', 'manual'] as const) {
      for (const timingMode of ['instant', 'random'] as const) {
        const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH, mode, timingMode }), 24);
        r.deal('ro');
        await r.advance(25000);
        expect(r.clicks).toEqual([]);
        expect(r.controller.scheduler.pending).toBeNull();
      }
    }
  }, 60000);

  it('switching Random -> Instant while an action is pending: cancelled with the reason, decided again, executed once without waiting', async () => {
    const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH }), 25);
    r.clockMs = 30000;
    r.deal('switch');
    await r.advance(50);
    await r.untilPending();
    expect(r.plan()!.targetDelayMs).toBeGreaterThanOrEqual(4000);
    const at = r.t;
    r.set({ timingMode: 'instant' });
    expect(r.controller.scheduler.pending).toBeNull();
    expect(r.controller.scheduler.lastCancel).toMatchObject({ at, reason: 'timing mode changed to instant' });
    await r.advance(25000);
    expect(r.clicks.length).toBe(1);
    expect(r.clicks[0].at - at).toBeLessThan(600);
  }, 60000);

  it('changing the Random bounds while pending, and Instant -> Random: the new bounds govern; one click each', async () => {
    const r = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH, minDelayMs: 10000, maxDelayMs: 12000 }), 26);
    r.clockMs = 30000;
    r.deal('bounds');
    await r.advance(50);
    const start = r.t;
    await r.untilPending();
    r.set({ minDelayMs: 5000, maxDelayMs: 6000 });
    expect(r.controller.scheduler.lastCancel!.reason).toBe('settings changed');
    await r.advance(25000);
    expect(r.clicks.length).toBe(1);
    expect(r.clicks[0].at - start).toBeGreaterThanOrEqual(5000);
    expect(r.clicks[0].at - start).toBeLessThanOrEqual(6000 + 160);
    const q = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH, timingMode: 'instant' }), 27);
    q.clockMs = 30000;
    q.set({ timingMode: 'random' });
    q.deal('back');
    await q.advance(50);
    const s0 = q.t;
    await q.advance(25000);
    expect(q.clicks.length).toBe(1);
    expect(q.clicks[0].at - s0).toBeGreaterThanOrEqual(4000);
  }, 60000);
});
