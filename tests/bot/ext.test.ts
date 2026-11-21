import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { CardId, Rng, shuffledDeck } from '../../src/bot/cards';
import { evaluateHand } from '../../src/core/equity/hand-eval';
import { TableObs } from '../../src/bot/adapter/observation';
import { HandTracker } from '../../src/bot/adapter/tracker';
import { emptyProfile, PlayerProfile } from '../../src/bot/opponents/profile';
import { ControllerDeps, LiveController } from '../../src/bot/ext/controller';
import {
  BotMessage, DEFAULT_SETTINGS, DecisionRecord, HandRecord, mayAct, parseBotMessage, sanitizeSettings, Settings, toHandRecord,
} from '../../src/bot/ext/records';
import { BotStorage } from '../../src/bot/ext/storage';
import { archetypePolicy } from '../../src/bot/sim/policies';
import { Policy } from '../../src/bot/sim/table';
import {
  applyAction, awaitingBoard, completeHand, createHand, dealBoard, HandState, legalActions, totalChips,
} from '../../src/bot/table/engine';
import { render } from './render';
import { act, mk } from './helpers';

describe('settings and message validation', () => {
  it('defaults are safe: recommend mode, nothing authorised', () => {
    expect(DEFAULT_SETTINGS.mode).toBe('recommend');
    expect(mayAct(DEFAULT_SETTINGS, 'any')).toBe(false);
  });
  it('acts only with autonomous mode + confirmation + this table authorised + no emergency stop', () => {
    const ok: Settings = { ...DEFAULT_SETTINGS, mode: 'autonomous', authorizationConfirmed: true, authorizedTables: ['t1'] };
    expect(mayAct(ok, 't1')).toBe(true);
    expect(mayAct(ok, 't2')).toBe(false);
    expect(mayAct({ ...ok, estop: true }, 't1')).toBe(false);
    expect(mayAct({ ...ok, authorizationConfirmed: false }, 't1')).toBe(false);
    expect(mayAct({ ...ok, mode: 'recommend' }, 't1')).toBe(false);
  });
  it('sanitises stored settings', () => {
    const s = sanitizeSettings({ mode: 'yolo', estop: 'yes', exploitWeight: 9, minDelayMs: -5, maxDelayMs: 1, deadlineMarginMs: 99999, randomDelay: 'no', authorizedTables: ['ok-1', '<script>', 7], selectorOverrides: { foldBtn: 'button.f', 'bad key': 'x', n: 5 }, junk: 1 });
    expect(s).toMatchObject({ mode: 'recommend', estop: false, exploitWeight: 1, minDelayMs: 0, maxDelayMs: 1, deadlineMarginMs: 10000, timingMode: 'random', v3ExecutionOptIn: false, authorizedTables: ['ok-1'], selectorOverrides: { foldBtn: 'button.f' } });
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect('junk' in s).toBe(false);
  });
  it('rejects malformed messages', () => {
    for (const bad of [null, 5, 'x', {}, { type: 'bot/evil' }, { type: 'bot/hand', hand: {} }, { type: 'bot/loadProfiles', ids: [1] }, { type: 'bot/loadProfiles', ids: Array(50).fill('a') }, { type: 'bot/live', live: { tableId: 3 } }, { type: 'bot/diag', record: { message: 'x'.repeat(5000) } }]) {
      expect(parseBotMessage(bad)).toBeNull();
    }
    expect(parseBotMessage({ type: 'bot/loadProfiles', ids: ['a'] })).not.toBeNull();
  });
});

function completedRecord(id: string): { rec: HandRecord; profiles: PlayerProfile[] } {
  const h = mk(3, { id });
  act(h, 'raise', 60); act(h, 'fold'); act(h, 'fold');
  const rec = toHandRecord({ hand: h, heroSeat: 0, heroCards: [0, 5], reveals: new Map(), observedToEnd: true, valid: true }, 'tbl', Number(id.replace(/\D/g, '')) || 1);
  const p = emptyProfile('p1', 'p1'); p.hands = 1; p.stats.vpip = { n: 0, d: 1 };
  return { rec, profiles: [p, { ...emptyProfile('ambiguous:x:2'), hands: 1 }] };
}

describe('local storage (IndexedDB)', () => {
  it('stores a hand and its profiles once; a repeated message changes nothing', async () => {
    const st = new BotStorage(new IDBFactory());
    const { rec, profiles } = completedRecord('h1');
    expect(await st.saveHand(rec, profiles)).toBe(true);
    const again = profiles.map((p) => ({ ...p, hands: 99 }));
    expect(await st.saveHand(rec, again)).toBe(false);
    const all = await st.allProfiles();
    expect(all.map((p) => p.playerId)).toEqual(['p1']); // ambiguous identity never persisted
    expect(all[0].hands).toBe(1);
    expect((await st.loadProfiles(['p1', 'missing'])).length).toBe(1);
    const hands = await st.recentHands();
    expect(hands.length).toBe(1);
    expect(hands[0]).toMatchObject({ handId: 'h1', heroNet: 30, heroCards: ['2h', '3d'], valid: true });
    expect(hands[0].events.map((e) => e.kind)).toEqual(['post-sb', 'post-bb', 'raise', 'fold', 'fold']);
  });

  it('survives reopening (service-worker restart), repairs corrupt rows, prunes and clears', async () => {
    const idb = new IDBFactory();
    const a = new BotStorage(idb);
    for (let i = 1; i <= 12; i++) await a.saveHand(completedRecord(`h${i}`).rec, []);
    await a.saveHand(completedRecord('h99').rec, [{ playerId: 'bad', stats: { vpip: { n: 50, d: 2 } } } as unknown as PlayerProfile]);
    const b = new BotStorage(idb); // a fresh instance, as after a worker restart
    expect((await b.recentHands()).length).toBe(13);
    expect((await b.loadProfiles(['bad']))[0].stats.vpip).toEqual({ n: 2, d: 2 });
    expect(await b.prune('hands', 5)).toBe(8);
    expect((await b.recentHands()).map((h) => h.handId)).toEqual(['h99', 'h12', 'h11', 'h10', 'h9']);
    await b.saveDecision({ handId: 'h9', tableId: 't', ts: 1, eventCount: 2, heroCards: [], board: [], pot: 0, decision: {} as DecisionRecord['decision'], execution: null });
    await b.saveDiagnostic({ ts: 5, level: 'warn', source: 'test', message: 'hello' });
    expect((await b.decisionsForHand('h9')).length).toBe(1);
    expect((await b.recentDiagnostics())[0].message).toBe('hello');
    const dump = await b.exportAll();
    expect(dump.hands.length).toBe(5);
    await b.clear(['profiles', 'hands', 'decisions', 'diagnostics']);
    expect((await b.exportAll())).toEqual({ profiles: [], hands: [], diagnostics: [] });
  });
});

// ---- controller driving a simulated table end to end -------------------------------

interface World { h: HandState; holes: Map<number, [CardId, CardId]>; clicks: string[]; tableId: string }

async function playLive(opts: { settings: Partial<Settings>; hands: number; players: number; seed: number; mutateObs?: (o: TableObs) => void }) {
  const heroSeat = 0;
  const rng = new Rng(opts.seed);
  const world: World = { h: null as unknown as HandState, holes: new Map(), clicks: [], tableId: 'test' };
  const sent: BotMessage[] = [];
  const store = new BotStorage(new IDBFactory());
  const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, minDelayMs: 0, maxDelayMs: 0, ...opts.settings });
  let t = 0;
  const deps: ControllerDeps = {
    observe: () => { const o = render(world.h, heroSeat, world.holes, (t += 50)); opts.mutateObs?.(o); return o; },
    health: () => ({ seats: true }),
    driver: {
      async click(kind) { world.clicks.push(kind); applyAction(world.h, { seat: heroSeat, kind }); return true; },
      async betOrRaise(to) { world.clicks.push(`raise:${to}`); applyAction(world.h, { seat: heroSeat, kind: legalActions(world.h)!.raiseKind, to }); return { submitted: true, readBack: to, detail: 'ok' }; },
    },
    send: (m) => { sent.push(m); if (m.type === 'bot/hand') void store.saveHand(m.hand, m.profiles); },
    loadProfiles: (ids) => store.loadProfiles(ids),
    now: () => performance.now(), sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 1))), yieldFn: async () => {}, random: () => 0.5, render: () => {},
  };
  const controller = new LiveController(deps, settings, 5);
  const policies: Policy[] = Array.from({ length: opts.players }, () => archetypePolicy('loose-passive'));
  let chips = 0;
  for (let n = 0; n < opts.hands; n++) {
    const deck = shuffledDeck(rng);
    world.h = createHand({ handId: `live${n}`, buttonSeat: n % opts.players, smallBlind: 10, bigBlind: 20, seats: Array.from({ length: opts.players }, (_, s) => ({ seat: s, playerId: `p${s}`, stack: 2000 })) });
    chips = totalChips(world.h);
    world.holes = new Map(world.h.seats.map((s, i) => [s.seat, [deck[2 * i], deck[2 * i + 1]] as [CardId, CardId]]));
    const board = deck.slice(40, 45);
    const h = world.h;
    controller.tick();
    for (let guard = 0; guard < 400 && h.phase !== 'complete' && h.phase !== 'showdown'; guard++) {
      if (h.toAct === heroSeat) {
        // Give the controller real time to think and act; if it never acts (non-autonomous), time the seat out.
        const before = h.events.length;
        for (let i = 0; i < (settings.mode === 'autonomous' ? 60 : 8) && h.events.length === before; i++) { controller.tick(); await new Promise((r) => setTimeout(r, 2)); }
        if (h.events.length === before) applyAction(h, { seat: heroSeat, kind: legalActions(h)!.canCheck ? 'check' : 'fold' });
      } else if (h.toAct !== null) {
        const seat = h.toAct;
        const c = await policies[seat].act({ h, seat, hole: world.holes.get(seat)!, la: legalActions(h)!, rng: rng.fork(guard) });
        applyAction(h, { seat, ...c });
      } else if (awaitingBoard(h)) dealBoard(h, h.street === 'preflop' ? board.slice(0, 3) : [board[h.board.length]]);
      controller.tick();
    }
    if (h.phase === 'showdown') { controller.tick(); completeHand(h, (s) => evaluateHand([...world.holes.get(s)!, ...h.board])); }
    controller.tick(); controller.tick();
    await new Promise((r) => setTimeout(r, 5));
    expect(totalChips(h)).toBe(chips);
  }
  await new Promise((r) => setTimeout(r, 20));
  return { world, sent, store, controller };
}

describe('live controller on a simulated table', () => {
  const authorised = { mode: 'autonomous' as const, authorizationConfirmed: true, authorizedTables: ['test'] };

  it('autonomous + authorised: plays hands with one legal click per decision and records everything', async () => {
    const { world, sent, store, controller } = await playLive({ settings: authorised, hands: 25, players: 5, seed: 3 });
    const decisions = sent.filter((m): m is Extract<BotMessage, { type: 'bot/decision' }> => m.type === 'bot/decision');
    expect(world.clicks.length).toBeGreaterThan(25);
    // Every click came from exactly one accepted, recorded decision (illegal clicks would have thrown in the driver).
    expect(decisions.filter((d) => d.record.execution?.status !== 'accepted').map((d) => [d.record.execution, d.record.decision.label, d.record.handId, d.record.eventCount])).toEqual([]);
    expect(decisions.filter((d) => d.record.execution?.status === 'accepted').length).toBe(world.clicks.length);
    expect(new Set(decisions.map((d) => `${d.record.handId}|${d.record.eventCount}`)).size).toBe(decisions.length);
    const hands = await store.recentHands();
    expect(hands.length).toBe(25);
    expect(hands.every((h) => h.valid)).toBe(true);
    const profiles = await store.allProfiles();
    expect(profiles.length).toBe(5);
    expect(profiles.every((p) => p.hands === 25)).toBe(true);
    expect(controller.snapshot().tracker.handsSeen).toBe(25);
    expect(sent.some((m) => m.type === 'bot/live')).toBe(true);
    expect(sent.filter((m) => m.type === 'bot/diag' && m.record.level === 'error')).toEqual([]);
  }, 60000);

  it('recommend mode, an unauthorised table, and the emergency stop never click', async () => {
    const rec = await playLive({ settings: { mode: 'recommend' }, hands: 6, players: 3, seed: 4 });
    expect(rec.world.clicks).toEqual([]);
    expect(rec.sent.filter((m) => m.type === 'bot/decision').length).toBeGreaterThan(3);
    expect(rec.sent.filter((m) => m.type === 'bot/decision').every((m) => m.type === 'bot/decision' && m.record.execution === null)).toBe(true);
    const wrongTable = await playLive({ settings: { ...authorised, authorizedTables: ['another-table'] }, hands: 6, players: 3, seed: 4 });
    expect(wrongTable.world.clicks).toEqual([]);
    const stopped = await playLive({ settings: { ...authorised, estop: true }, hands: 6, players: 3, seed: 4 });
    expect(stopped.world.clicks).toEqual([]);
    const manual = await playLive({ settings: { mode: 'manual' }, hands: 6, players: 3, seed: 4 });
    expect(manual.world.clicks).toEqual([]);
    expect(manual.sent.filter((m) => m.type === 'bot/decision')).toEqual([]);
    expect((await manual.store.recentHands()).length).toBe(6); // still observes and profiles
  }, 60000);

  it('pauses instead of acting when the table disagrees with the reconstructed state', async () => {
    const r = await playLive({ settings: authorised, hands: 8, players: 3, seed: 6, mutateObs: (o) => { if (o.controls.call !== null) o.controls.call += 13; } });
    // Decisions facing a bet were never executed: the call button contradicts the engine.
    expect(r.world.clicks.filter((c) => c === 'call')).toEqual([]);
    expect(r.controller.snapshot().tracker.issues.join(' ')).toMatch(/call button shows|/);
    const diag = r.sent.filter((m) => m.type === 'bot/diag').map((m) => (m.type === 'bot/diag' ? m.record.message : ''));
    expect(diag.some((m) => /illegal|untrusted|rejected/.test(m)) || r.world.clicks.every((c) => c !== 'call')).toBe(true);
  }, 60000);

  it('a tracker fed by the controller never reports a hero turn the engine disagrees with', () => {
    const t = new HandTracker();
    const h = mk(3);
    t.ingest(render(h, 0, new Map([[0, [0, 5]], [1, [9, 14]], [2, [20, 25]]]), 1));
    expect(t.state.hand!.toAct).toBe(0);
    expect(t.state.confidence).toBe(1);
  });
});
