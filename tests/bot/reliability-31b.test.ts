// Phase 3.1b: live execution and tracking reliability (the four confirmed defects of the 2026-11-21 forensic audit).
//
//   D1 background-tab timer throttling: late wake-ups, suspension, unknown deadlines, emergency stop and state changes
//      during a pause, and the visible warning
//   D2 returning-player blind posts (recorded hand 45: Hero posts 2 live + 1 dead at CO after sitting out)
//   D3/D4 the duplicate attempt (recorded hand 17): one decision point, one attempt, one record, its own timing
//   D5 decision lifecycle records: cancellations, manual overrides (observed or inferred), export compatibility
//
// Deterministic: a manual page clock, a separate wall clock, seeded randomness; no real timer decides anything.
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { PokerNowDom } from '../../src/bot/adapter/pokernow/dom';
import { CardId, parseCards, Rng, shuffledDeck } from '../../src/bot/cards';
import { TableObs } from '../../src/bot/adapter/observation';
import { HandTracker } from '../../src/bot/adapter/tracker';
import { rebuildHand } from '../../src/bot/diag/rebuild';
import { buildBundle, parseBundle } from '../../src/bot/diag/recorder';
import { ControllerDeps, LiveController } from '../../src/bot/ext/controller';
import { BotMessage, DecisionRecord, DEFAULT_SETTINGS, LiveState, parseBotMessage, sanitizeSettings, Settings, toHandRecord } from '../../src/bot/ext/records';
import { ActionScheduler, TimingPolicy } from '../../src/bot/ext/scheduler';
import { BotStorage } from '../../src/bot/ext/storage';
import { scheduleRows, statusPill } from '../../src/bot/ext/view';
import { extractHandDeltas } from '../../src/bot/opponents/profile';
import { applyAction, createHand, HandState, legalActions, potTotal } from '../../src/bot/table/engine';
import { render, toHtml } from './render';

const POLICY: TimingPolicy = { mode: 'random', minDelayMs: 4000, maxDelayMs: 20000, deadlineMarginMs: 3000, assumedClockMs: 20000 };
const AUTH = { mode: 'autonomous' as const, authorizationConfirmed: true, authorizedTables: ['test'] };
const auth = (s: Partial<Settings> = {}) => sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTH, ...s });

// ---------------------------------------------------------------------------------------------------------------
describe('3.1b scheduler: late wake-ups, suspension and unknown deadlines (pure, injected clocks)', () => {
  it('a wake-up after the latest safe moment expires the attempt: never reported due, settled once with the reason', async () => {
    let t = 0;
    const s = new ActionScheduler(() => t, () => 0.1);
    const plan = s.plan('k', 0, { at: null, observed: false }, POLICY, false);
    expect(plan.dueAt).toBeCloseTo(5600, 6); // 4 s + 0.1 x 16 s
    expect(plan.latestSafeAt).toBe(17000);
    const settled: [string, string][] = [], late: number[] = [];
    s.onSettle = (_p, kind, reason) => settled.push([kind, reason]);
    s.onLate = (_p, ms) => late.push(ms);
    const p = s.arm({ key: 'k', label: 'CALL', decidedBy: 'v2', fallback: null, computeMs: 5 })!;
    // Every timer comes back 20 s late (the 2026-11-21 hand 5 pattern).
    const r = await s.waitFor(p, async (ms) => { t += ms + 20000; }, () => false);
    expect(r).toBe('expired');
    expect(settled).toHaveLength(1);
    expect(settled[0][0]).toBe('expired');
    expect(settled[0][1]).toMatch(/past the latest safe moment \(17\.0 s into the turn, assumed deadline\); the browser delayed the page's timers by up to 20\.0 s: an expired decision is never executed/);
    expect(late).toEqual([20000]);
    expect(s.pending).toBeNull();
    expect(s.lastCancel).toMatchObject({ kind: 'expired', attempt: p.id });
    // Cancelling afterwards settles nothing again.
    s.cancel('later');
    expect(settled).toHaveLength(1);
  });

  it('a late wake-up before the latest safe moment is reported, and the attempt is still executed once due', async () => {
    let t = 0;
    const s = new ActionScheduler(() => t, () => 0.1);
    s.plan('k', 0, { at: null, observed: false }, POLICY, false);
    const p = s.arm({ key: 'k', label: 'CALL', decidedBy: 'v2', fallback: null, computeMs: 5 })!;
    let first = true;
    const r = await s.waitFor(p, async (ms) => { t += ms + (first ? 3000 : 0); first = false; }, () => false);
    expect(r).toBe('due');
    expect(p.maxLateMs).toBe(3000);
    expect(p.lateWakeups).toBe(1);
    expect(t).toBeGreaterThanOrEqual(5600);
    expect(t).toBeLessThanOrEqual(17000);
    expect(s.verdict(p)).toBeNull();
  });

  it('page or computer suspended: the wall clock moves 30 s more than the page clock, so the time left is unknown', async () => {
    let t = 0, wallExtra = 0;
    const s = new ActionScheduler(() => t, () => 0.1, () => 1_000_000 + t + wallExtra);
    s.plan('k', 0, { at: null, observed: false }, POLICY, false);
    const p = s.arm({ key: 'k', label: 'FOLD', decidedBy: 'v2', fallback: null, computeMs: 5 })!;
    let first = true;
    const r = await s.waitFor(p, async (ms) => { t += ms; if (first) wallExtra += 30000; first = false; }, () => false);
    expect(r).toBe('expired');
    expect(p.clockJumpMs).toBe(30000);
    expect(p.expiry).toMatch(/wall clock and the page clock moved apart by 30\.0 s while waiting \(the page or the computer was suspended\)/);
  });

  it('no clock shown and the turn start uncertain by 6 s: the deadline cannot be established, the attempt never runs; a clock shown later makes it reliable', async () => {
    let t = 6000;
    const s = new ActionScheduler(() => t, () => 0.1);
    const plan = s.plan('k', 6000, { at: null, observed: false }, POLICY, false, 6000);
    expect(plan.deadlineAt).toBe(20000); // counted from the earliest possible start (0), not from the read (6000)
    expect(plan.unreliable).toMatch(/first read 6\.0 s after the previous read of the table .* no clock is shown/);
    const p = s.arm({ key: 'k', label: 'CALL', decidedBy: 'v2', fallback: null, computeMs: 5 })!;
    expect(await s.waitFor(p, async (ms) => { t += ms; }, () => false)).toBe('expired');
    // The same uncertainty with an observed clock: reliable.
    const q = s.plan('j', 6000, { at: 30000, observed: true }, POLICY, false, 6000);
    expect(q.unreliable).toBeNull();
    // A clock that appears later on an unreliable plan makes it reliable.
    s.plan('m', 6000, { at: null, observed: false }, POLICY, false, 6000);
    expect(s.plan('m', 6500, { at: 26000, observed: true }, POLICY, false).unreliable).toBeNull();
    // Normal polling (no uncertainty) is never unreliable.
    expect(s.plan('n', 0, { at: null, observed: false }, POLICY, false).unreliable).toBeNull();
  });

  it('attempt identity: nothing can be armed while an attempt is executing, and timing belongs to its own attempt', () => {
    let t = 0;
    const s = new ActionScheduler(() => t, () => 0.5);
    s.plan('k', 0, { at: null, observed: false }, POLICY, false);
    const p1 = s.arm({ key: 'k', label: 'CHECK', decidedBy: 'v2', fallback: null, computeMs: 5 })!;
    t = 12000;
    s.firing(p1);
    t = 12050;
    // A duplicate callback for the same point while the click is in flight (2026-11-21 hand 17): refused.
    expect(s.arm({ key: 'k', label: 'CHECK', decidedBy: 'v2', fallback: null, computeMs: 12050 })).toBeNull();
    t = 12900;
    const f = s.fired(p1, 'CHECK', 'accepted: table shows Hero check');
    expect(f).toMatchObject({ attempt: p1.id, computeMs: 5, delayMs: 12000, waitedMs: 11995 });
    expect(s.pending).toBeNull();
    // A later attempt gets a new identity.
    s.plan('k2', 13000, { at: null, observed: false }, POLICY, false);
    expect(s.arm({ key: 'k2', label: 'FOLD', decidedBy: 'v2', fallback: null, computeMs: 1 })!.id).toBe(p1.id + 1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The live controller on a simulated table: a manual page clock, a separate wall clock, and a page whose timers and
// reads can be held (a background tab) or frozen (a suspended page or computer).

class Rig {
  t = 0;
  wallExtra = 0;
  visible = true;
  private sleeps: { at: number; resolve: () => void }[] = [];
  h!: HandState;
  holes = new Map<number, [CardId, CardId]>();
  readonly clicks: { kind: string; at: number; key: string }[] = [];
  readonly sent: BotMessage[] = [];
  readonly store = new BotStorage(new IDBFactory());
  clockMs: number | null = null;
  private turnId = '';
  private turnSince = 0;
  /** When false the table does not register the bot's click at once; `applyAfterMs` registers it later. */
  register = true;
  applyAfterMs: number | null = null;
  private applyAt: { at: number; kind: string; to?: number } | null = null;
  /** Called after each bot click (to stage what the page shows next). */
  afterClick: (() => void) | null = null;
  /** Page time that passes while a bet amount is being entered (timers held during bet entry). */
  betEntryMs = 0;
  hideTurn = 0;
  /** The settings as stored (what loadSettings returns): may differ from the controller's while a page is suspended. */
  stored: Settings;
  loadCalls = 0;
  controller: LiveController;
  readonly deps: ControllerDeps;
  private readonly rng: Rng;

  constructor(public settings: Settings, seed = 1) {
    this.rng = new Rng(seed);
    this.stored = settings;
    const clickedNow = (kind: string, to?: number) => {
      this.clicks.push({ kind: to === undefined ? kind : `raise:${to}`, at: this.t, key: this.key() });
      if (this.register) applyAction(this.h, { seat: 0, kind: kind as 'fold', to });
      else if (this.applyAfterMs !== null) this.applyAt = { at: this.t + this.applyAfterMs, kind, to };
      this.afterClick?.();
    };
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
        click: async (kind) => { clickedNow(kind); return true; },
        betOrRaise: async (to, onTime) => {
          this.t += this.betEntryMs;
          const late = onTime?.() ?? null;
          if (late) return { submitted: false, readBack: to, detail: `not submitted: ${late}` };
          clickedNow(legalActions(this.h)!.raiseKind, to);
          return { submitted: true, readBack: to, detail: 'ok' };
        },
      },
      send: (m) => { this.sent.push(m); },
      loadProfiles: async () => [],
      now: () => this.t,
      sleep: (ms) => new Promise<void>((resolve) => { this.sleeps.push({ at: this.t + ms, resolve }); }),
      yieldFn: async () => { this.t += 5; },
      random: () => this.rng.next(),
      render: () => {},
      wallNow: () => 1_800_000_000_000 + this.t + this.wallExtra,
      visible: () => this.visible,
      loadSettings: async () => { this.loadCalls++; return this.stored; },
    };
    this.controller = new LiveController(this.deps, settings, 3);
  }
  key() { return `${this.h.handId}|${this.h.street}|${this.h.events.length}`; }
  set(s: Partial<Settings>) { this.settings = sanitizeSettings({ ...this.settings, ...s }); this.stored = this.settings; this.controller.updateSettings(this.settings); }
  async flush() { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); }
  private fireDue() {
    const due = this.sleeps.filter((s) => s.at <= this.t);
    this.sleeps = this.sleeps.filter((s) => s.at > this.t);
    for (const s of due) s.resolve();
    if (this.applyAt && this.applyAt.at <= this.t) { const a = this.applyAt; this.applyAt = null; applyAction(this.h, { seat: 0, kind: a.kind as 'fold', to: a.to }); }
  }
  /** Advance the clock in 50 ms steps: timers due are released and the page is read at every step. */
  async advance(ms: number) {
    const end = this.t + ms;
    while (this.t < end) {
      this.t = Math.min(end, this.t + 50);
      this.fireDue();
      await this.flush();
      this.controller.tick();
      await this.flush();
    }
  }
  /**
   * The page's timers and reads are held for `ms` (a background tab), or the whole page is frozen (`wallJump`: the
   * wall clock moves on further than the page clock, as after a suspended computer). `during` changes the table
   * meanwhile. On release, either the held timers run first or the first read does.
   */
  async suspend(ms: number, o: { wallJump?: number; during?: () => void; order?: 'timers-first' | 'read-first' } = {}) {
    this.t += ms;
    this.wallExtra += o.wallJump ?? 0;
    o.during?.();
    if (o.order === 'read-first') { this.controller.tick(); await this.flush(); this.fireDue(); await this.flush(); }
    else { this.fireDue(); await this.flush(); this.controller.tick(); await this.flush(); }
  }
  deal(id: string, heroCards = 'Ah Ad') {
    this.hideTurn = 1;
    this.h = createHand({ handId: id, buttonSeat: 0, smallBlind: 10, bigBlind: 20, seats: [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, stack: 2000 })) });
    const deck = shuffledDeck(new Rng(7)).filter((c) => !parseCards(heroCards).includes(c));
    this.holes = new Map([[0, parseCards(heroCards) as [CardId, CardId]], [1, [deck[0], deck[1]]], [2, [deck[2], deck[3]]]]);
  }
  hero(kind: 'fold' | 'check' | 'call' | 'bet' | 'raise', to?: number) { applyAction(this.h, { seat: 0, kind, to }); }
  live(): LiveState { return this.controller.snapshot(); }
  decisions(): DecisionRecord[] { return this.sent.filter((m): m is Extract<BotMessage, { type: 'bot/decision' }> => m.type === 'bot/decision').map((m) => m.record); }
  diags(): string[] { return this.sent.filter((m): m is Extract<BotMessage, { type: 'bot/diag' }> => m.type === 'bot/diag').map((m) => m.record.message); }
  async untilPending(maxMs = 3000) {
    for (let i = 0; i < maxMs / 50; i++) { if (this.controller.scheduler.pending) return this.controller.scheduler.pending; await this.advance(50); }
    throw new Error(`no pending action: ${this.live().status}`);
  }
}

/** A rig whose Hero (button, first to act preflop at a three-seat table) has an action pending, due 5 s into the turn. */
async function pendingAt5s(s: Partial<Settings> = {}, seed = 1) {
  const r = new Rig(auth({ minDelayMs: 5000, maxDelayMs: 5000, ...s }), seed);
  r.deal('d1');
  await r.advance(50);
  const p = await r.untilPending();
  const plan = r.controller.scheduler.get(p.key)!;
  return { r, p, plan };
}

describe('3.1b live controller: background tabs and suspended pages (D1)', () => {
  it('timers held 25 s while an action waits: the late wake-up does not execute it; recorded as expired with the reason', async () => {
    for (const order of ['timers-first', 'read-first'] as const) {
      const { r, p, plan } = await pendingAt5s();
      expect(plan.latestSafeAt - plan.startedAt).toBe(17000);
      await r.suspend(25000, { order });
      await r.advance(3000);
      expect(r.clicks, order).toEqual([]);
      const recs = r.decisions().filter((d) => d.context?.key === p.key);
      expect(recs).toHaveLength(1);
      const lc = recs[0].lifecycle!;
      expect(recs[0].execution).toBeNull();
      expect(lc).toMatchObject({ schema: 2, outcome: 'expired', attempt: p.id, executionPermitted: true, attemptedAfterMs: null, tableConfirmed: null });
      expect(lc.reason).toMatch(/past the latest safe moment/);
      expect(lc.schedule).toMatchObject({ timingMode: 'random', targetDelayMs: 5000, plannedAfterMs: 5000, latestSafeAfterMs: 17000, deadlineSource: 'assumed' });
      expect(r.diags().some((m) => /action not executed \(expired\)/.test(m))).toBe(true);
      expect(r.live().schedule!.lastCancel).toMatchObject({ kind: 'expired' });
      expect(scheduleRows(r.live()).some(([k]) => k === 'Last expired')).toBe(true);
      // The long gap between reads is reported, and while it is recent the dashboard warns.
      expect(r.diags().some((m) => /page timers delayed: the table was not read for 25\.0 s/.test(m))).toBe(true);
      const tm = r.live().timing!;
      expect(tm.throttled).toBe(true);
      expect(tm.warning).toMatch(/delayed this page's timers \(up to 25\.0 s in the last minute\)/);
      expect(statusPill(r.live(), Date.now()).tone).toBe('warn');
    }
  }, 60000);

  it('timers held 8 s, released before the latest safe moment: executed once, its late wake-up recorded on its own attempt; stored settings re-read first', async () => {
    const { r, p } = await pendingAt5s();
    await r.suspend(8000);
    await r.advance(2000);
    expect(r.clicks).toHaveLength(1);
    expect(r.loadCalls).toBe(1);
    const rec = r.decisions().find((d) => d.context?.key === p.key)!;
    expect(rec.execution!.status).toBe('accepted');
    expect(rec.execution!.timing!.attempt).toBe(p.id);
    expect(rec.execution!.timing!.maxTimerLateMs).toBeGreaterThanOrEqual(7000);
    expect(rec.execution!.timing!.actualDelayMs).toBeGreaterThanOrEqual(8000);
    expect(rec.execution!.timing!.actualDelayMs).toBeLessThan(17000);
    expect(rec.lifecycle).toMatchObject({ outcome: 'executed', tableConfirmed: true, heroAction: { evidence: 'bot' } });
    expect(rec.lifecycle!.timers.maxLateMs).toBeGreaterThanOrEqual(7000);
  }, 60000);

  it('page or computer suspended (page clock +1 s, wall clock +61 s): expired with the clock reason, nothing clicked', async () => {
    const { r } = await pendingAt5s();
    await r.suspend(1000, { wallJump: 60000 });
    await r.advance(20000);
    expect(r.clicks).toEqual([]);
    expect(r.decisions().at(-1)!.lifecycle).toMatchObject({ outcome: 'expired' });
    expect(r.decisions().at(-1)!.lifecycle!.reason).toMatch(/moved apart by 60\.0 s/);
  }, 60000);

  it('Hero\'s turn first read 6 s after the previous read, no clock shown: the deadline is unknown, so nothing is clicked; with a clock shown the action runs', async () => {
    const r = new Rig(auth({ minDelayMs: 5000, maxDelayMs: 5000 }));
    r.deal('gap');
    await r.advance(50); // a read that does not show Hero's turn yet
    await r.suspend(6000); // no read for 6 s; then the first read shows Hero's turn
    await r.advance(20000);
    expect(r.clicks).toEqual([]);
    const lc = r.decisions().at(-1)!.lifecycle!;
    expect(lc.outcome).toBe('expired');
    expect(lc.reason).toMatch(/first read 6\.0 s after the previous read of the table/);
    expect(lc.schedule!.startUncertaintyMs).toBe(6000);

    const c = new Rig(auth({ minDelayMs: 5000, maxDelayMs: 5000 }));
    c.clockMs = 25000;
    c.deal('gap-clock');
    await c.advance(50);
    await c.suspend(6000);
    await c.advance(20000);
    expect(c.clicks).toHaveLength(1);
    expect(c.decisions().at(-1)!.lifecycle!.schedule!.deadlineSource).toBe('observed');
  }, 60000);

  it('emergency stop set while the page was suspended, not yet delivered: read from storage before the click; nothing clicked', async () => {
    const { r, p } = await pendingAt5s();
    await r.suspend(6000, { during: () => { r.stored = { ...r.settings, estop: true }; } });
    await r.advance(20000);
    expect(r.loadCalls).toBe(1);
    expect(r.clicks).toEqual([]);
    const lc = r.decisions().find((d) => d.lifecycle?.attempt === p.id)!.lifecycle!;
    expect(lc.outcome).toBe('cancelled');
    expect(lc.reason).toBe('emergency stop');
    expect(r.live().estop).toBe(true);
  }, 60000);

  it('the table timed Hero out during the suspension: never clicked, whichever runs first; Hero\'s fold is recorded as inferred, not observed', async () => {
    for (const order of ['timers-first', 'read-first'] as const) {
      const { r, p } = await pendingAt5s();
      await r.suspend(6000, { order, during: () => r.hero('fold') });
      await r.advance(3000);
      expect(r.clicks, order).toEqual([]);
      const recs = r.decisions().filter((d) => d.context?.key === p.key);
      expect(recs, order).toHaveLength(1);
      const lc = recs[0].lifecycle!;
      expect(lc.outcome, order).toBe(order === 'timers-first' ? 'rejected' : 'cancelled');
      expect(lc.heroAction.evidence).toBe('manual-inferred');
      expect(lc.heroAction.kind).toBe('fold');
      expect(lc.heroAction.detail).toMatch(/time-out/);
      if (order === 'timers-first') expect(recs[0].execution!.reason).toMatch(/stale|not Hero's turn|hand changed/);
    }
  }, 60000);

  it('timers held while a raise amount is being entered: the submit is withheld, the passive fallback is refused too; nothing clicked', async () => {
    const { r, p } = await pendingAt5s();
    expect(p.label).toMatch(/^raise/i);
    r.betEntryMs = 20000;
    await r.advance(6000);
    expect(r.clicks).toEqual([]);
    const lc = r.decisions().find((d) => d.lifecycle?.attempt === p.id)!.lifecycle!;
    expect(lc.outcome).toBe('expired');
    expect(lc.reason).toMatch(/past the latest safe moment/);
    expect(lc.events.map((e) => e.what).join(' | ')).toMatch(/bet entry failed \(bet entry failed: not submitted: .*past the latest safe moment/);
  }, 60000);

  it('the table tab is hidden while autonomous play is armed: a visible warning and a log line; none in recommendation mode', async () => {
    const { r } = await pendingAt5s();
    r.visible = false;
    r.controller.noteVisibility(false);
    const l = r.live();
    expect(l.timing!.pageVisible).toBe(false);
    expect(l.timing!.warning).toMatch(/table tab is in the background.*cancelled, not sent late/);
    expect(statusPill(l, Date.now())).toMatchObject({ label: 'Needs attention', tone: 'warn' });
    expect(scheduleRows(l).find(([k]) => k === 'Page timers')![1]).toMatch(/table tab hidden/);
    expect(r.diags().some((m) => /table tab was hidden while autonomous play is armed/.test(m))).toBe(true);
    r.set({ mode: 'recommend' });
    expect(r.live().timing!.warning).toBeNull();
  }, 60000);
});

// ---------------------------------------------------------------------------------------------------------------
describe('3.1b duplicate attempt (2026-11-21 hand 17, D3/D4) and decision lifecycle records (D5)', () => {
  it('hand 17: the page briefly shows nobody to act, then the old buttons with the same state version; one decision, one executor call, one record, its own timing', async () => {
    const r = new Rig(auth({ minDelayMs: 5000, maxDelayMs: 5000 }));
    r.register = false;
    r.applyAfterMs = 900; // the table shows the action 0.9 s after the click (924 ms in the recording)
    r.afterClick = () => { r.hideTurn = 1; }; // the next read shows nobody to act; the reads after it show the stale turn
    r.deal('h17');
    await r.advance(50);
    const p = await r.untilPending();
    await r.advance(8000);
    expect(r.clicks).toHaveLength(1);
    expect(r.controller.executor.history).toHaveLength(1);
    const recs = r.decisions().filter((d) => d.context?.key === p.key);
    expect(recs).toHaveLength(1);
    const ex = recs[0].execution!;
    expect(ex.status).toBe('accepted');
    expect(ex.timing!.attempt).toBe(p.id);
    expect(ex.timing!.computeMs).toBeLessThan(1000); // the 0.9.1 record showed the second attempt's 14.6 s here
    expect(ex.timing!.actualDelayMs).toBeGreaterThanOrEqual(5000);
    expect(ex.timing!.actualDelayMs).toBeLessThanOrEqual(5100);
    expect(r.diags().some((m) => /already acted on/.test(m))).toBe(false);
    expect(r.sent.filter((m) => m.type === 'bot/decision' && m.record.execution?.status === 'rejected')).toHaveLength(0);
  }, 60000);

  it('Hero clicks the table by hand before the scheduled action: cancelled at once, recorded with the click as observed evidence; no bot click', async () => {
    const { r, p } = await pendingAt5s();
    await r.advance(1000);
    r.controller.noteUserAction('call');
    expect(r.controller.scheduler.pending).toBeNull();
    r.hero('call');
    await r.advance(20000);
    expect(r.clicks).toEqual([]);
    const recs = r.decisions().filter((d) => d.context?.key === p.key);
    expect(recs).toHaveLength(1);
    expect(recs[0].execution).toBeNull();
    const lc = recs[0].lifecycle!;
    expect(lc.outcome).toBe('cancelled');
    expect(lc.reason).toBe('Hero clicked the table\'s call button by hand');
    expect(lc.heroAction).toMatchObject({ evidence: 'manual-click-observed', kind: 'call' });
    expect(lc.heroAction.afterMs).toBeGreaterThanOrEqual(1000);
    expect(r.diags().some((m) => /Hero acted outside the bot before the scheduled action \(manual-click-observed\)/.test(m))).toBe(true);
  }, 60000);

  it('Hero acts by hand but no click is seen (keyboard, the site\'s time-out, an unreported click): recorded as inferred, never as observed', async () => {
    const { r, p } = await pendingAt5s();
    await r.advance(1000);
    r.hero('call');
    await r.advance(20000);
    expect(r.clicks).toEqual([]);
    const recs = r.decisions().filter((d) => d.context?.key === p.key);
    expect(recs).toHaveLength(1);
    expect(recs[0].lifecycle).toMatchObject({ outcome: 'cancelled', reason: 'it is no longer Hero\'s turn on the table', heroAction: { evidence: 'manual-inferred', kind: 'call' } });
  }, 60000);

  it('cancellations are recorded once per attempt with the reason; identical frames and a display flicker add no record', async () => {
    // Emergency stop while waiting.
    const a = await pendingAt5s();
    await a.r.advance(1000);
    a.r.set({ estop: true });
    await a.r.advance(20000);
    expect(a.r.clicks).toEqual([]);
    const ra = a.r.decisions().filter((d) => d.lifecycle?.attempt === a.p.id);
    expect(ra).toHaveLength(1);
    expect(ra[0].lifecycle).toMatchObject({ outcome: 'cancelled', reason: 'emergency stop', heroAction: { evidence: 'none' } });
    // After the stop the same decision point is shown as a recommendation only: one more record, of that kind.
    expect(a.r.decisions().filter((d) => d.context?.key === a.p.key).map((d) => d.lifecycle!.outcome)).toEqual(['cancelled', 'recommended']);

    // A one-read flicker of the turn display, then the same decision point: one attempt continued, one record.
    const b = await pendingAt5s({}, 2);
    await b.r.advance(1000);
    const save = b.r.h.toAct;
    b.r.h.toAct = 1; b.r.controller.tick(); b.r.h.toAct = save;
    await b.r.advance(20000);
    expect(b.r.clicks).toHaveLength(1);
    const rb = b.r.decisions().filter((d) => d.context?.key === b.p.key);
    expect(rb).toHaveLength(1);
    expect(rb[0].lifecycle!.outcome).toBe('executed');
    expect(rb[0].lifecycle!.events.map((e) => e.what).join(' | ')).toMatch(/cancelled: it is no longer Hero's turn.*showed Hero's turn again/);

    // Recommendation only: many identical reads and a flicker store the recommendation once.
    const c = new Rig(sanitizeSettings({ ...DEFAULT_SETTINGS, mode: 'recommend' }));
    c.deal('rec');
    await c.advance(2000);
    const s2 = c.h.toAct; c.h.toAct = 1; c.controller.tick(); c.h.toAct = s2;
    await c.advance(2000);
    const rc = c.decisions();
    expect(rc).toHaveLength(1);
    expect(rc[0].lifecycle).toMatchObject({ outcome: 'recommended', executionPermitted: false, attempt: 0, schedule: null });
  }, 60000);
});

// ---------------------------------------------------------------------------------------------------------------
describe('3.1b DOM driver: the submit is withheld when the deadline check fails; real clicks are classified', () => {
  const page = () => {
    const h = createHand({ handId: 'dom', buttonSeat: 0, smallBlind: 10, bigBlind: 20, seats: [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, stack: 2000 })) });
    const doc = new JSDOM(`<body>${toHtml(render(h, 0, new Map([[0, parseCards('Ah Ad') as [CardId, CardId]]]), 1))}</body>`).window.document;
    let submitted: string | null = null;
    const form = doc.querySelector('.raise-controller-form') as HTMLFormElement;
    form.querySelector('input[type=submit]')!.addEventListener('click', (e) => { e.preventDefault(); submitted = (form.querySelector('input.value') as HTMLInputElement).value; });
    doc.querySelector('button.raise')!.addEventListener('click', () => { form.style.display = 'block'; });
    return { doc, d: new PokerNowDom(doc, undefined, async () => {}), submitted: () => submitted };
  };

  it('betOrRaise asks onTime immediately before the submit and does not submit when it gives a reason', async () => {
    const a = page();
    const r = await a.d.betOrRaise(60, () => 'expired: 2.0 s past the latest safe moment');
    expect(r).toMatchObject({ submitted: false, readBack: 60 });
    expect(r.detail).toMatch(/^not submitted: expired/);
    expect(a.submitted()).toBeNull();
    const b = page();
    expect(await b.d.betOrRaise(60, () => null)).toMatchObject({ submitted: true });
    expect(b.submitted()).toBe('60');
  });

  it('userActionOf: the action buttons of the table (and the bet form submit) are recognised; anything else is not', () => {
    const { doc, d } = page();
    expect(d.userActionOf(doc.querySelector('button.call'))).toBe('call');
    expect(d.userActionOf(doc.querySelector('button.fold'))).toBe('fold');
    expect(d.userActionOf(doc.querySelector('.raise-controller-form input[type=submit]'))).toBe('raise');
    expect(d.userActionOf(doc.querySelector('.table-player'))).toBeNull();
    expect(d.userActionOf(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('3.1b diagnostic export compatibility', () => {
  const ctx = { key: 'h1|preflop|2', handId: 'h1', street: 'preflop', version: 2, heroSeat: 0, toCall: 20, canCheck: false, canRaise: true, minRaiseTo: 40, maxRaiseTo: 2000, opponents: 2 };
  const old091 = { handId: 'h1', tableId: 'test', ts: 1, eventCount: 2, heroCards: ['Ah', 'Ad'], board: [], pot: 30, decision: { action: 'raise', to: 60, label: 'RAISE TO 60' }, execution: { status: 'accepted', reason: 'table shows Hero raise to 60', ms: 120, timing: { targetDelayMs: 5000, actualDelayMs: 5003, computeMs: 4, waitedMs: 4999, deadlineSource: 'assumed', conflict: null, capped: null } }, context: ctx };

  it('a 0.9.1 record (no lifecycle) and a 3.1b record are both accepted, stored and exported unchanged', async () => {
    const { r, p } = await pendingAt5s();
    await r.advance(1000);
    r.set({ estop: true });
    const fresh = r.decisions().find((d) => d.context?.key === p.key)!;
    expect(fresh.lifecycle!.schema).toBe(2);
    for (const rec of [old091, fresh]) expect(parseBotMessage({ type: 'bot/decision', record: rec })).not.toBeNull();
    const store = new BotStorage(new IDBFactory());
    await store.saveDecision(old091 as unknown as DecisionRecord);
    await store.saveDecision(fresh);
    const out = await store.exportTables(['test']);
    expect(out.decisions).toHaveLength(2);
    expect(out.decisions.find((d) => !d.lifecycle)).toMatchObject({ execution: { status: 'accepted' } });
    expect(out.decisions.find((d) => d.lifecycle)!.lifecycle).toEqual(fresh.lifecycle);
    // The debug bundle passes decision records through as they are (format version unchanged).
    const b = parseBundle(JSON.parse(JSON.stringify(buildBundle([], { extensionVersion: 'test', hands: 'all', decisions: [old091, fresh] }))));
    expect(b.version).toBe(1);
  }, 60000);
});

// ---------------------------------------------------------------------------------------------------------------
interface FixtureFrame { n: number; handKey: string | null; obs: TableObs; liveValid: boolean; liveDecision: string }
const h45 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'live-2026-11-21-h45.json'), 'utf8')) as { frames: FixtureFrame[] };

describe('3.1b returning-player blind posts (D2)', () => {
  it('the fixture is the recording: hand 44 ends, hand 45 starts with Hero 2 in front at CO and a pot of 6; live it became invalid and Hero\'s turn was blocked', () => {
    const fr = (n: number) => h45.frames.find((f) => f.n === n)!;
    expect(h45.frames).toHaveLength(65);
    const hero = (n: number) => fr(n).obs.seats.find((s) => s.isHero)!;
    expect([hero(1607).stack, hero(1607).bet]).toEqual([240, 0]);
    expect([hero(1608).stack, hero(1608).bet, fr(1608).obs.pot, fr(1608).obs.toActSeat]).toEqual([237, 2, 6, 6]);
    expect(fr(1615).liveValid).toBe(false);
    expect([fr(1617).obs.heroToAct, fr(1617).liveDecision]).toEqual([true, 'blocked']);
    expect(JSON.stringify(h45)).not.toMatch(/pglT/);
  });

  it('hand 45 rebuilds as valid: 1 dead + 2 live posted by Hero, pot equal to the table at every frame, Hero faces 9 more, the hand completes valid and replays from its record', () => {
    const t = new HandTracker();
    const done = [];
    for (const f of h45.frames) {
      done.push(...t.ingest(f.obs));
      const s = t.state;
      if (f.n < 1608 || f.n > 1650) continue;
      expect(s.valid, `frame ${f.n}`).toBe(true);
      expect(potTotal(s.hand!), `frame ${f.n}`).toBe(f.obs.pot);
      if (f.obs.heroToAct) {
        expect(s.blockers).toEqual([]);
        expect(legalActions(s.hand!)!.callAmount).toBe(9);
      }
    }
    const c = done.find((x) => x.hand.events.some((e) => e.kind === 'post-live'))!;
    expect(c.valid).toBe(true);
    const posts = c.hand.events.filter((e) => e.kind.startsWith('post'));
    expect(posts.map((e) => `${e.seat}:${e.kind}:${e.amount}:${e.to}`)).toEqual(['3:post-sb:1:1', '5:post-bb:2:2', '1:post-dead:1:0', '1:post-live:2:2']);
    expect(posts.every((e) => !e.voluntary)).toBe(true);
    // Hero's stack at the start of the hand includes the dead chip (240 before, as the previous hand left it).
    expect(c.hand.seats.find((s) => s.seat === 1)!.startStack).toBe(240);
    const rec = toHandRecord(c, 'table-1', 0);
    const rebuilt = rebuildHand({ ...rec, ante: 0 });
    expect(rebuilt.events.map((e) => `${e.seat}:${e.kind}:${e.amount}`)).toEqual(c.hand.events.map((e) => `${e.seat}:${e.kind}:${e.amount}`));
  });

  it('through the live controller (recommend mode), Hero\'s turn in hand 45 now gets a recommendation instead of being blocked', async () => {
    let i = 0, now = 0;
    const sent: BotMessage[] = [];
    const deps: ControllerDeps = {
      observe: () => h45.frames[i].obs, health: () => ({ seats: true }),
      driver: { click: async () => true, betOrRaise: async () => ({ submitted: false, readBack: null, detail: '' }) },
      send: (m) => sent.push(m), loadProfiles: async () => [], now: () => now, sleep: async () => {}, yieldFn: async () => {}, random: () => 0.5, render: () => {},
    };
    const c = new LiveController(deps, sanitizeSettings({ ...DEFAULT_SETTINGS }), 1);
    const states: Record<number, string> = {};
    for (i = 0; i < h45.frames.length; i++) {
      now = h45.frames[i].obs.ts;
      c.tick();
      for (let k = 0; k < 10; k++) await new Promise((r) => setImmediate(r));
      c.tick();
      states[h45.frames[i].n] = c.snapshot().recommendation.state;
    }
    expect(states[1617]).toBe('ready');
    const rec = sent.filter((m): m is Extract<BotMessage, { type: 'bot/decision' }> => m.type === 'bot/decision').find((m) => m.record.context?.toCall === 9);
    expect(rec).toBeTruthy();
  }, 60000);

  it('rules engine: a live post counts toward the bet and keeps the option; a dead post does not count; posts at the blinds or above one big blind are refused', () => {
    const seats = [1, 2, 3, 4, 5].map((seat) => ({ seat, playerId: `p${seat}`, stack: 200 }));
    // Button 1, SB 2, BB 3; seat 5 returns and posts 2 live + 1 dead.
    const h = createHand({ handId: 'x', buttonSeat: 1, smallBlind: 1, bigBlind: 2, seats, extraPosts: [{ seat: 5, live: 2, dead: 1 }] });
    expect(potTotal(h)).toBe(6);
    const s5 = h.seats.find((s) => s.seat === 5)!;
    expect([s5.streetCommit, s5.totalCommit, s5.stack]).toEqual([2, 3, 197]);
    expect(h.toAct).toBe(4);
    applyAction(h, { seat: 4, kind: 'call' });
    // Seat 5 has matched the big blind with its live post: it may check (the option), not only call.
    expect(legalActions(h)).toMatchObject({ seat: 5, canCheck: true, callAmount: 0 });
    applyAction(h, { seat: 5, kind: 'check' });
    applyAction(h, { seat: 1, kind: 'fold' });
    applyAction(h, { seat: 2, kind: 'call' });
    applyAction(h, { seat: 3, kind: 'check' });
    expect(h.street).toBe('preflop'); // round closed: awaiting the flop
    // A post is not a voluntary action: seat 5 checking its option after the post is like the big blind checking
    // (no VPIP chance, no limp); seat 4's call is a limp.
    const deltas = extractHandDeltas(h);
    expect(deltas.get('p5')!.stats.vpip?.n ?? 0).toBe(0);
    expect(deltas.get('p5')!.stats.limp?.n ?? 0).toBe(0);
    expect(deltas.get('p4')!.stats.vpip).toEqual({ n: 1, d: 1 });
    expect(deltas.get('p4')!.stats.limp).toEqual({ n: 1, d: 1 });
    expect(() => createHand({ handId: 'y', buttonSeat: 1, smallBlind: 1, bigBlind: 2, seats, extraPosts: [{ seat: 3, live: 2, dead: 0 }] })).toThrow(/is a blind/);
    expect(() => createHand({ handId: 'z', buttonSeat: 1, smallBlind: 1, bigBlind: 2, seats, extraPosts: [{ seat: 5, live: 4, dead: 0 }] })).toThrow(/invalid post/);
  });

  // Synthetic observations built with the rules engine (render), for the cases the recording does not contain.
  const fiveSeats = (stacks: Record<number, number> = {}) => [1, 2, 3, 4, 5].map((seat) => ({ seat, playerId: `p${seat}`, name: `P${seat}`, stack: stacks[seat] ?? 200 }));
  const holes = new Map<number, [CardId, CardId]>([[1, parseCards('Ah Kd') as [CardId, CardId]]]);
  const between = (stacks: Record<number, number>, ts: number): TableObs => {
    const h = createHand({ handId: 'prev', buttonSeat: 5, smallBlind: 1, bigBlind: 2, seats: fiveSeats(stacks) });
    const o = render(h, 1, holes, ts);
    for (const s of o.seats) { s.bet = 0; s.hasCards = false; s.folded = false; }
    return { ...o, pot: 0, toActSeat: null, heroToAct: false, heroCards: null, controls: { ...o.controls, fold: false, check: false, call: null, raise: false } };
  };
  const startObs = (cfg: Parameters<typeof createHand>[0], ts: number) => render(createHand(cfg), 1, holes, ts);

  it('a player joining mid-session posts one big blind live (no dead money): recognised as a post, not as a call', () => {
    const t = new HandTracker();
    t.ingest(between({}, 1000));
    t.ingest(startObs({ handId: 'j', buttonSeat: 1, smallBlind: 1, bigBlind: 2, seats: fiveSeats(), extraPosts: [{ seat: 5, live: 2, dead: 0 }] }, 2000));
    const h = t.state.hand!;
    expect(t.state.valid).toBe(true);
    expect(h.events.map((e) => `${e.seat}:${e.kind}`)).toEqual(['2:post-sb', '3:post-bb', '5:post-live']);
    expect(t.state.issues.join(' | ')).toMatch(/seat 5: entry post of 2 \(live\)/);
  });

  it('dead money whose payer cannot be confirmed (no read of the stacks before the hand): attributed to the single poster and the hand marked uncertain; a contradicting stack: not attributed', () => {
    const cfg = { handId: 'u', buttonSeat: 1, smallBlind: 1, bigBlind: 2, seats: fiveSeats(), extraPosts: [{ seat: 5, live: 2, dead: 1 }] };
    const t = new HandTracker();
    t.ingest(startObs(cfg, 2000)); // first observation of the page: no earlier read
    expect(t.state.hand!.events.map((e) => e.kind)).toContain('post-dead');
    expect(t.state.issues.join(' | ')).toMatch(/taken as seat 5's dead small blind, but its stack before the hand was not seen/);
    expect(t.state.valid).toBe(true);
    expect((t as unknown as { uncertain: boolean }).uncertain).toBe(true);

    const t2 = new HandTracker();
    t2.ingest(between({ 5: 199 }, 1000)); // seat 5 had 199: 199 -> 197 + 2 in front, so it paid 2, not 3
    const o = startObs({ ...cfg, seats: fiveSeats({ 5: 200 }) }, 2000);
    t2.ingest(o);
    expect(t2.state.hand!.events.map((e) => e.kind)).not.toContain('post-dead');
    expect(t2.state.issues.join(' | ')).toMatch(/seat 5's stack before the hand \(199\) shows it did not pay it: not attributed/);
  });

  it('chips in front of a later seat when the table is NOT at the first action (the first read came after limps): ordinary calls, no posts', () => {
    const h = createHand({ handId: 'm', buttonSeat: 1, smallBlind: 1, bigBlind: 2, seats: fiveSeats() });
    applyAction(h, { seat: 4, kind: 'call' });
    applyAction(h, { seat: 5, kind: 'call' });
    const t = new HandTracker();
    t.ingest(between({}, 1000));
    t.ingest(render(h, 1, holes, 2000)); // first read: seat 1 (button) to act, 4 and 5 already in for 2
    const evs = t.state.hand!.events.map((e) => `${e.seat}:${e.kind}`);
    expect(evs).not.toContain('5:post-live');
    expect(evs).not.toContain('4:post-live');
  });

  it('chips in front before the first action and no acting seat shown: waits for a read that shows it, then starts marked uncertain without guessing', () => {
    const cfg = { handId: 'w', buttonSeat: 1, smallBlind: 1, bigBlind: 2, seats: fiveSeats(), extraPosts: [{ seat: 5, live: 2, dead: 0 }] };
    const t = new HandTracker();
    t.ingest(between({}, 1000));
    const o = startObs(cfg, 2000);
    o.toActSeat = null;
    t.ingest(o);
    expect(t.state.hand).toBeNull();
    expect(t.state.waitingReason).toMatch(/a forced post cannot be told from a call yet/);
    const later = { ...o, ts: 2000 + 60000 };
    t.ingest(later);
    expect(t.state.hand).not.toBeNull();
    expect(t.state.hand!.events.map((e) => e.kind)).not.toContain('post-live');
    expect((t as unknown as { uncertain: boolean }).uncertain).toBe(true);
    expect(t.state.issues.join(' | ')).toMatch(/started without modelling it/);
  });
});
