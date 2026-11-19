// Version 3 (experimental) in the extension: strategy selection, the packaged fitted tables and their checks,
// fallbacks, recommendation-only enforcement, and version 3's multi-street lines through the live pipeline.
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { CardId, parseCards, Rng, shuffledDeck } from '../../src/bot/cards';
import { evaluateHand } from '../../src/core/equity/hand-eval';
import { BotAgent, DecisionCancelled } from '../../src/bot/agent';
import { agentFor, ControllerDeps, LiveController, packagedV3Artifacts } from '../../src/bot/ext/controller';
import { popupView } from '../../src/bot/ext/popup';
import { BotMessage, DEFAULT_SETTINGS, LiveState, mayAct, patchSettings, sanitizeSettings, Settings } from '../../src/bot/ext/records';
import { BotStorage } from '../../src/bot/ext/storage';
import { shadowRows, strategyTag } from '../../src/bot/ext/view';
import { archetypePolicy } from '../../src/bot/sim/policies';
import { Policy } from '../../src/bot/sim/table';
import type { Decision } from '../../src/bot/strategy/types';
import { loadV3Artifacts, spotSupport, validatePopulation, validateRiverRange } from '../../src/bot/strategy/v3/artifacts';
import type { PostflopSearchV3, TNode } from '../../src/bot/strategy/v3/search';
import { applyAction, awaitingBoard, completeHand, createHand, dealBoard, HandState, legalActions, totalChips, validateAction } from '../../src/bot/table/engine';
import populationJson from '../../src/bot/strategy/v3/population-calibration.json';
import riverJson from '../../src/bot/strategy/v3/river-range-calibration.json';
import { buildSpot, SpotDef } from '../../sim/bot/scenarios';
import { act, mk } from './helpers';
import { render } from './render';

const now = () => performance.now();
const SPOTS = {
  checkRaise: { players: 6, hero: 'BB', cards: '7c 7d', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', '7h 8s 2c: BB x, BTN b1.6'] },
  facingRaise: { players: 6, hero: 'BTN', cards: 'Ah Kd', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Ks 8d 3c: BB x, BTN b1.8, BB r6'] },
  checkCall: { players: 6, hero: 'BB', cards: '9h 8h', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Th 7c 2s: BB x, BTN b1.6'] },
  delayed: { players: 6, hero: 'BTN', cards: 'Ac Qd', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', '9s 6h 2d: BB x, BTN x', 'Kc: BB x'] },
  firstIn: { players: 6, hero: 'BB', cards: 'Kd Qd', lines: ['UTG f, HJ f, CO r2.5, BTN f, SB f, BB c', 'Ks 8d 3c:'] },
  thinRiver: { players: 6, hero: 'BTN', cards: 'Kh 9h', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kd 7s 3c: BB x, BTN b1.6, BB c', '5h: BB x, BTN x', '2d: BB x'] },
  bluffCatch: { players: 6, hero: 'BB', cards: 'Qc Td', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Qh 8s 4d: BB x, BTN b1.6, BB c', '3c: BB x, BTN b4, BB c', '2h: BB x, BTN b12'] },
  short: { players: 6, stacks: 20, hero: 'BB', cards: 'Ac 5c', lines: ['UTG f, HJ f, CO f, BTN r2.2, SB f, BB c', '5d 9c 2c: BB x, BTN b1.2'] },
  multiway: { players: 6, hero: 'BB', cards: '7s 6s', lines: ['UTG f, HJ r2.5, CO c, BTN f, SB f, BB c', '8s 5d 2h: BB x, HJ b3, CO c'] },
  preflop: { players: 6, hero: 'BTN', cards: 'As Qs', lines: ['UTG f, HJ f, CO r2.5'] },
  headsUpTable: { players: 2, hero: 'BB', cards: 'Kc Qh', lines: ['BTN r2.5, BB c', 'Qd 7s 2c: BB x, BTN b1.5'] },
} satisfies Record<string, SpotDef>;

/** Decide a spot with version 3 as the extension builds it, keeping the search for inspection. */
function decideV3(def: SpotDef, samples = 700, agent?: BotAgent): { d: Decision; search: PostflopSearchV3 | null; b: ReturnType<typeof buildSpot> } {
  const b = buildSpot(def);
  let search: PostflopSearchV3 | null = null;
  const a = agent ?? new BotAgent({ ...v3Opts(), onV3Search: (s) => { search = s; } });
  const d = a.decideSync(b.h, b.heroSeat, b.heroCards, samples);
  return { d, search, b };
}
function v3Opts() {
  const art = packagedV3Artifacts();
  return { engine: 'v3' as const, seed: 7, v3Population: art.population, v3RiverRange: art.riverRange, v3SpotChecks: true, v3ArtifactStatus: art.status };
}
const walk = (n: TNode, f: (n: TNode) => void) => { f(n); n.kids.forEach((k) => walk(k, f)); };
/** Every candidate is a legal action in the observed state, bet sizes inside the legal range. */
function expectLegal(d: Decision, h: HandState) {
  const la = legalActions(h)!;
  for (const c of d.candidates) {
    expect(validateAction(h, { seat: h.toAct!, kind: c.action, to: c.to }), c.label).toBeNull();
    if (c.action === 'bet' || c.action === 'raise') { expect(c.to!).toBeGreaterThanOrEqual(la.minRaiseTo - 1e-9); expect(c.to!).toBeLessThanOrEqual(la.maxRaiseTo + 1e-9); }
  }
  expect(validateAction(h, { seat: h.toAct!, kind: d.action, to: d.to })).toBeNull();
}

describe('version 3 multi-street lines through the extension pipeline', () => {
  it('1. check-raise: after checking, facing a bet, raises are searched and a set raises for value', () => {
    const { d, b } = decideV3(SPOTS.checkRaise);
    expect(d.strategy).toMatchObject({ requested: 'v3', used: 'v3', fallback: null });
    expect(d.spot?.heroBetType).toBe('raise');
    expect(d.candidates.filter((c) => c.action === 'raise').length).toBeGreaterThanOrEqual(1);
    expectLegal(d, b.h);
    // Bottom set on a dry board: version 3's best response is a check-raise, and its value comes from being called.
    expect(d.action).toBe('raise');
    expect(d.basis.join('\n')).toMatch(/where the value comes from: .*calls \+/);
    expect(d.basis.join('\n')).toMatch(/plan after raise .*: if raised/);
  });

  it('2-3. facing a raise after betting: fold, call and a legal re-raise are all evaluated; no re-raise when it is not permitted', () => {
    const { d, b } = decideV3(SPOTS.facingRaise);
    const la = legalActions(b.h)!;
    expect(la.canRaise).toBe(true);
    expect(d.candidates.map((c) => c.action)).toEqual(expect.arrayContaining(['fold', 'call', 'raise']));
    expectLegal(d, b.h);
    expect(d.strategy?.used).toBe('v3');
    // The same line with the raise all-in for Hero's stack: only fold or call remain legal, and only they are offered.
    const allIn = decideV3({ ...SPOTS.facingRaise, lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Ks 8d 3c: BB x, BTN b1.8, BB r97.5'] });
    expect(legalActions(allIn.b.h)!.canRaise).toBe(false);
    expect(allIn.d.candidates.map((c) => c.action).sort()).toEqual(['call', 'fold']);
    expect(allIn.d.candidates.find((c) => c.action === 'call')!.label).toBe('call all-in');
  });

  it('4. check-call now, aggression later: the tree after calling contains Hero bets and raises on the turn', () => {
    const { d, search } = decideV3(SPOTS.checkCall);
    expect(search).not.toBeNull();
    const s = search!;
    const callIdx = s.specs.findIndex((x) => x.action === 'call');
    expect(callIdx).toBeGreaterThanOrEqual(0);
    const turnHero: string[][] = [];
    walk(s.root.kids[callIdx], (n) => { if (n.type === 'hero' && n.street === 'turn') turnHero.push(n.acts.map((a) => a.kind)); });
    expect(turnHero.some((a) => a.includes('bet'))).toBe(true);
    expect(turnHero.some((a) => a.includes('raise'))).toBe(true);
    expect(d.basis[1]).toMatch(/call now and bet or raise later/);
  });

  it('5. delayed continuation bet: the raiser checked the flop back; on the turn several bets are evaluated against checking', () => {
    const { d, b } = decideV3(SPOTS.delayed);
    expect(d.spot?.heroBetType).toBe('delayed continuation bet');
    expect(d.candidates[0].action).toBe('check');
    expect(d.candidates.filter((c) => c.action === 'bet').length).toBeGreaterThanOrEqual(2);
    expectLegal(d, b.h);
    expect(d.basis.join('\n')).toMatch(/on the river if the opponent bets|plan after bet/);
  });

  it('6. several legal bet sizes, in whole chips at 10/20 and in cents at 0.25/0.50 (PokerNow\'s displayed units)', () => {
    const { d, b } = decideV3(SPOTS.firstIn);
    const bets = d.candidates.filter((c) => c.action === 'bet');
    expect(new Set(bets.map((c) => c.to)).size).toBeGreaterThanOrEqual(3);
    for (const c of bets) expect(Number.isInteger(c.to!)).toBe(true);
    expectLegal(d, b.h);
    // Cents table: 0.25 / 0.50 blinds, 50.00 stacks.
    const h = mk(3, { sb: 0.25, bb: 0.5, stacks: [50, 50, 50], id: 'cents' });
    act(h, 'raise', 1.25); act(h, 'fold'); act(h, 'call');
    dealBoard(h, parseCards('Ks 8d 3c'));
    const hero = h.toAct!;
    const d2 = new BotAgent(v3Opts()).decideSync(h, hero, parseCards('Kd Qd') as [CardId, CardId], 600);
    expect(d2.strategy?.used).toBe('v3');
    const sizes = d2.candidates.filter((c) => c.action === 'bet').map((c) => c.to!);
    expect(sizes.length).toBeGreaterThanOrEqual(2);
    for (const to of sizes) expect(Math.abs(Math.round(to * 100) - to * 100)).toBeLessThan(1e-6);
    expectLegal(d2, h);
  });

  it('7. thin value on the river: the stated purpose of a bet follows its own value decomposition', () => {
    const { d, search, b } = decideV3(SPOTS.thinRiver);
    expectLegal(d, b.h);
    const r = search!.result(2.5, true);
    d.candidates.forEach((c, i) => {
      if (c.action !== 'bet') return;
      const dec = r.v3.decomposition[i];
      expect(dec).toBeTruthy();
      // EV of the bet = what folds, calls and raises contribute (the decomposition is the EV split, nothing added).
      expect(dec.fromFolds + dec.fromCalls + dec.fromRaises).toBeCloseTo(r.candidates[i].ev!, 0);
    });
    if (d.action === 'bet') expect(d.basis.join('\n')).toMatch(/where the value comes from: folds [+-][\d.]+, calls [+-][\d.]+/);
  });

  it('8. bluff-catching on the river: fold / call / legal raises; the fitted river range of the bettor is used and stated', () => {
    const { d, b } = decideV3(SPOTS.bluffCatch);
    expectLegal(d, b.h);
    expect(d.candidates.map((c) => c.action)).toEqual(expect.arrayContaining(['fold', 'call']));
    expect(d.strategy?.calibration?.river).toBe('applied');
    expect(d.basis.join('\n')).toMatch(/bettor's river range is version 2's estimate re-weighted/);
    // The price: calling risks the bet to win the pot; a fold is the zero point of every EV.
    expect(d.candidates.find((c) => c.action === 'fold')!.ev).toBe(0);
  });

  it('9. short effective stacks: every size is capped at the stack and the all-in is labelled as such', () => {
    const { d, b } = decideV3(SPOTS.short);
    const la = legalActions(b.h)!;
    expectLegal(d, b.h);
    const raises = d.candidates.filter((c) => c.action === 'raise');
    expect(raises.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...raises.map((c) => c.to!))).toBeLessThanOrEqual(la.maxRaiseTo);
    for (const c of raises) if (c.to === la.maxRaiseTo) expect(c.label).toMatch(/all-in/);
  });

  it('10. heads-up pots go to version 3; multiway and preflop fall back to version 2, with the reason', () => {
    const mw = decideV3(SPOTS.multiway).d;
    expect(mw.strategy).toMatchObject({ requested: 'v3', used: 'v2' });
    expect(mw.strategy!.fallback).toMatch(/2 opponents in the pot: version 3 searches heads-up pots only/);
    expect(mw.basis.join('\n')).toMatch(/version 3 not used: .*version 2 decided/);
    const pf = decideV3(SPOTS.preflop).d;
    expect(pf.strategy).toMatchObject({ requested: 'v3', used: 'v2' });
    expect(pf.strategy!.fallback).toMatch(/^preflop: version 3 has no preflop engine/);
    // A heads-up TABLE: version 3 decides, but the fitted tables are not applied (no such data).
    const hu = decideV3(SPOTS.headsUpTable).d;
    expect(hu.strategy).toMatchObject({ used: 'v3', fallback: null, calibration: { population: 'not applicable' } });
    expect(hu.strategy!.opponentModel).toMatch(/uncalibrated \(baseline\)/);
    expect(spotSupport(true).ok).toBe(false);
    // A failure inside version 3 falls back to version 2 for that decision instead of failing it.
    const b = buildSpot(SPOTS.checkCall);
    const broken = new BotAgent({ ...v3Opts(), onV3Search: () => { throw new Error('test failure'); } });
    const fb = broken.decideSync(b.h, b.heroSeat, b.heroCards, 400);
    expect(fb.strategy).toMatchObject({ requested: 'v3', used: 'v2' });
    expect(fb.strategy!.fallback).toMatch(/version 3 failed \(test failure\)/);
  });
});

describe('the packaged fitted tables', () => {
  it('load, pass their checks, and are exactly the committed files (nothing invented or altered)', () => {
    const a = loadV3Artifacts();
    expect(a.status.map((s) => [s.name, s.state])).toEqual([['population-calibration', 'loaded'], ['river-range', 'loaded']]);
    expect(a.population!.cells).toEqual((populationJson as { cells: unknown }).cells);
    expect(a.riverRange!.theta).toEqual((riverJson as { theta: unknown }).theta);
    expect(a.status[0].source).toMatch(/^phh-dataset@e47fbd5/);
    expect(a.status[0].fittedOn).toMatch(/days 1-18/);
    expect(JSON.stringify(a)).not.toMatch(/player|seat|hand_id|hole/i);
  });

  it('11. a missing or malformed table is rejected as a whole, and version 3 uses its uncalibrated baseline and says why', () => {
    const missing = loadV3Artifacts(null, null);
    expect(missing.population).toBeUndefined();
    expect(missing.riverRange).toBeUndefined();
    expect(missing.status.map((s) => s.state)).toEqual(['missing', 'missing']);
    const pop = populationJson as { source: string; cells: Record<string, { shift: number; mult: number; n: number }> };
    const tweak = (f: (c: typeof pop.cells) => void) => { const c = JSON.parse(JSON.stringify(pop.cells)); f(c); return { ...pop, cells: c }; };
    expect(validatePopulation({ ...pop, source: 'made-up' })).toMatchObject({ ok: false, reason: expect.stringMatching(/unexpected source/) });
    expect(validatePopulation(tweak((c) => { c['flop|bet|small'].shift = 0.9; }))).toMatchObject({ ok: false, reason: expect.stringMatching(/outside the fitted grid/) });
    expect(validatePopulation(tweak((c) => { c['flop|bet|small'].mult = Number.NaN; }))).toMatchObject({ ok: false, reason: expect.stringMatching(/malformed/) });
    expect(validatePopulation(tweak((c) => { c['preflop|bet|small'] = { shift: 0, mult: 1, n: 3 }; }))).toMatchObject({ ok: false, reason: expect.stringMatching(/feature schema/) });
    expect(validatePopulation(tweak((c) => { c['flop|raise|small'].shift = 0.1; c['flop|raise|large'].shift = -0.2; }))).toMatchObject({ ok: false, reason: expect.stringMatching(/decreases with the bet size/) });
    const riv = riverJson as { source: string; bins: number[]; theta: Record<string, number[]> };
    expect(validateRiverRange({ ...riv, bins: [0.5, 0.2] })).toMatchObject({ ok: false });
    expect(validateRiverRange({ ...riv, theta: { ...riv.theta, 'small|barrel': [1, 2] } })).toMatchObject({ ok: false, reason: expect.stringMatching(/log-weights/) });
    // The engine: the reason reaches the explanation and the strategy note.
    const bad = loadV3Artifacts({ ...pop, source: 'made-up' }, null);
    const b = buildSpot(SPOTS.bluffCatch);
    const d = agentFor('v3', 1, 7, now, bad).decideSync(b.h, b.heroSeat, b.heroCards, 500);
    expect(d.strategy).toMatchObject({ used: 'v3', calibration: { population: 'unavailable', river: 'unavailable' } });
    expect(d.strategy!.opponentModel).toMatch(/uncalibrated \(baseline\)/);
    expect(d.basis.join('\n')).toMatch(/population calibration unavailable \(invalid: unexpected source/);
    expect(d.basis.join('\n')).toMatch(/river range tilt unavailable \(missing: file not packaged\)/);
    expect(d.basis.join('\n')).not.toMatch(/^empirical/m);
  });
});

// ---- the live controller on a simulated table ------------------------------------------------

interface World { h: HandState; holes: Map<number, [CardId, CardId]>; clicks: string[] }
class Session {
  readonly world: World = { h: null as unknown as HandState, holes: new Map(), clicks: [] };
  readonly sent: BotMessage[] = [];
  readonly store = new BotStorage(new IDBFactory());
  readonly controller: LiveController;
  readonly lives: LiveState[] = [];
  private t = 0;
  private n = 0;
  private readonly rng: Rng;
  constructor(public settings: Settings, private readonly players: number, seed: number, mutateObs?: (o: ReturnType<typeof render>) => void) {
    this.rng = new Rng(seed);
    const w = this.world;
    const deps: ControllerDeps = {
      observe: () => { const o = render(w.h, 0, w.holes, (this.t += 50)); mutateObs?.(o); return o; },
      health: () => ({ seats: true }),
      driver: {
        async click(kind) { w.clicks.push(kind); applyAction(w.h, { seat: 0, kind }); return true; },
        async betOrRaise(to) { w.clicks.push(`raise:${to}`); applyAction(w.h, { seat: 0, kind: legalActions(w.h)!.raiseKind, to }); return { submitted: true, readBack: to, detail: 'ok' }; },
      },
      send: (m) => { this.sent.push(m); if (m.type === 'bot/hand') void this.store.saveHand(m.hand, m.profiles); if (m.type === 'bot/live') this.lives.push(m.live); },
      loadProfiles: (ids) => this.store.loadProfiles(ids),
      now, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 1))), yieldFn: async () => {}, random: () => 0.5, render: () => {},
    };
    this.controller = new LiveController(deps, settings, 5);
  }
  setSettings(s: Partial<Settings>) { this.settings = sanitizeSettings({ ...this.settings, ...s }); this.controller.updateSettings(this.settings); }
  async play(hands: number) {
    const policies: Policy[] = Array.from({ length: this.players }, () => archetypePolicy('loose-passive'));
    const c = this.controller, w = this.world;
    for (let k = 0; k < hands; k++, this.n++) {
      const deck = shuffledDeck(this.rng);
      w.h = createHand({ handId: `v3live${this.n}`, buttonSeat: this.n % this.players, smallBlind: 10, bigBlind: 20, seats: Array.from({ length: this.players }, (_, s) => ({ seat: s, playerId: `p${s}`, stack: 2000 })) });
      const chips = totalChips(w.h);
      w.holes = new Map(w.h.seats.map((s, i) => [s.seat, [deck[2 * i], deck[2 * i + 1]] as [CardId, CardId]]));
      const board = deck.slice(40, 45);
      const h = w.h;
      c.tick();
      for (let guard = 0; guard < 400 && h.phase !== 'complete' && h.phase !== 'showdown'; guard++) {
        if (h.toAct === 0) {
          const before = h.events.length;
          for (let i = 0; i < (this.settings.mode === 'autonomous' ? 40 : 6) && h.events.length === before; i++) { c.tick(); await new Promise((r) => setTimeout(r, 2)); }
          if (h.events.length === before) applyAction(h, { seat: 0, kind: legalActions(h)!.canCheck ? 'check' : 'call' });
        } else if (h.toAct !== null) {
          const seat = h.toAct;
          const a = await policies[seat].act({ h, seat, hole: w.holes.get(seat)!, la: legalActions(h)!, rng: this.rng.fork(guard) });
          applyAction(h, { seat, ...a });
        } else if (awaitingBoard(h)) dealBoard(h, h.street === 'preflop' ? board.slice(0, 3) : [board[h.board.length]]);
        c.tick();
      }
      if (h.phase === 'showdown') { c.tick(); completeHand(h, (s) => evaluateHand([...w.holes.get(s)!, ...h.board])); }
      c.tick(); c.tick();
      await new Promise((r) => setTimeout(r, 3));
      expect(totalChips(h)).toBe(chips);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  decisions() { return this.sent.filter((m): m is Extract<BotMessage, { type: 'bot/decision' }> => m.type === 'bot/decision').map((m) => m.record); }
  errors() { return this.sent.filter((m) => m.type === 'bot/diag' && m.record.level === 'error'); }
}
const AUTHORISED = { mode: 'autonomous' as const, authorizationConfirmed: true, authorizedTables: ['test'] };

describe('strategy selection, persistence and recommendation-only enforcement', () => {
  it('14. version 2 stays the default; version 3 is selected only explicitly and persists', async () => {
    expect(DEFAULT_SETTINGS.strategyEngine).toBe('v2');
    expect(DEFAULT_SETTINGS.shadowV3).toBe(false);
    // Settings stored by an older version (no field, or an unknown name) read as version 2: nobody is switched silently.
    expect(sanitizeSettings({ mode: 'recommend' }).strategyEngine).toBe('v2');
    expect(sanitizeSettings({ strategyEngine: 'V3' }).strategyEngine).toBe('v2');
    expect(sanitizeSettings({ strategyEngine: 'v3' }).strategyEngine).toBe('v3');
    let stored: Record<string, unknown> = { settings: { ...DEFAULT_SETTINGS } };
    const area = { get: async () => stored, set: async (v: Record<string, unknown>) => { stored = { ...stored, ...v }; } };
    const s = await patchSettings(area, { strategyEngine: 'v3' });
    expect(s.strategyEngine).toBe('v3');
    expect(sanitizeSettings(JSON.parse(JSON.stringify(stored.settings))).strategyEngine).toBe('v3');
    expect((await patchSettings(area, { mode: 'manual' })).strategyEngine).toBe('v3'); // other changes keep the choice
    expect((await patchSettings(area, { strategyEngine: 'v2' })).strategyEngine).toBe('v2');
  });

  it('15. version 3 never clicks: mayAct, the popup text, and a whole authorised autonomous session', async () => {
    const ok: Settings = { ...DEFAULT_SETTINGS, ...AUTHORISED };
    expect(mayAct(ok, 'test')).toBe(true);
    expect(mayAct({ ...ok, strategyEngine: 'v3' }, 'test')).toBe(false);
    expect(popupView({ ...ok, strategyEngine: 'v3' }, 'test', '').state).toMatch(/v3 \(experimental\) is recommendation-only: nothing is clicked/);
    const s = new Session(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTHORISED, minThinkMs: 0, maxThinkMs: 0, strategyEngine: 'v3' }), 3, 21);
    await s.play(8);
    expect(s.world.clicks).toEqual([]);
    const decs = s.decisions();
    expect(decs.length).toBeGreaterThan(4);
    expect(decs.every((d) => d.execution === null)).toBe(true);
    expect(s.controller.executor.armed).toBe(false);
    expect(s.controller.snapshot()).toMatchObject({ acting: false, strategy: { selected: 'v3', experimental: true, recommendOnly: true } });
    expect(s.errors()).toEqual([]);
  }, 60000);

  it('decisions and explanations belong to the current hand and decision point (version 3 session)', async () => {
    const s = new Session(sanitizeSettings({ ...DEFAULT_SETTINGS, mode: 'recommend', strategyEngine: 'v3' }), 2, 33);
    await s.play(10);
    const decs = s.decisions();
    expect(decs.length).toBeGreaterThan(6);
    for (const r of decs) {
      expect(r.context).toBeTruthy();
      expect(r.context!.handId).toBe(r.handId);
      expect(r.context!.key).toBe(`${r.handId}|${r.decision.street}|${r.eventCount}`);
      expect(r.context!.version).toBe(r.eventCount);
      expect(r.board.length).toBe(r.decision.street === 'preflop' ? 0 : r.decision.street === 'flop' ? 3 : r.decision.street === 'turn' ? 4 : 5);
      if (r.decision.action === 'bet' || r.decision.action === 'raise') { expect(r.decision.to!).toBeGreaterThanOrEqual(r.context!.minRaiseTo); expect(r.decision.to!).toBeLessThanOrEqual(r.context!.maxRaiseTo); }
      if (r.decision.action === 'check') expect(r.context!.canCheck).toBe(true);
      expect(r.decision.strategy?.requested).toBe('v3');
      expect(r.decision.strategy?.used).toBe(r.decision.street === 'preflop' ? 'v2' : 'v3');
    }
    expect(decs.some((r) => r.decision.strategy?.used === 'v3')).toBe(true);
    // A shown recommendation never outlives its decision point.
    for (const l of s.lives) if (l.decision) expect(l.recommendation.context && l.observation.heroToAct).toBeTruthy();
    expect(s.errors()).toEqual([]);
  }, 60000);

  it('12. unconfirmed state: when the buttons contradict the reconstruction, version 3 recommends nothing for that spot', async () => {
    const s = new Session(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTHORISED, minThinkMs: 0, maxThinkMs: 0, strategyEngine: 'v3' }), 3, 6, (o) => { if (o.controls.call !== null) o.controls.call += 13; });
    await s.play(6);
    expect(s.world.clicks).toEqual([]);
    expect(s.decisions().filter((r) => (r.context?.toCall ?? 0) > 0)).toEqual([]);
    expect(s.lives.some((l) => l.recommendation.state === 'blocked')).toBe(true);
  }, 60000);

  it('12. stale computations: a cancelled version 3 decision rejects (the fallback never swallows a cancellation)', async () => {
    const b = buildSpot(SPOTS.checkCall);
    let calls = 0;
    const p = new BotAgent(v3Opts()).decide(b.h, b.heroSeat, b.heroCards, { timeRemainingMs: 20000, isCancelled: () => ++calls > 1, yieldFn: async () => {} });
    await expect(p).rejects.toBeInstanceOf(DecisionCancelled);
  });

  it('13. switching v1 / v2 / v3 mid-session keeps tracking, profiles and diagnostics intact', async () => {
    const s = new Session(sanitizeSettings({ ...DEFAULT_SETTINGS, mode: 'recommend' }), 3, 44);
    await s.play(3);
    const engines: string[] = [];
    for (const e of ['v3', 'v1', 'v2', 'v3'] as const) {
      const seen = s.controller.snapshot().tracker.handsSeen;
      const profiles = s.controller.agent.profiles.size;
      s.setSettings({ strategyEngine: e });
      expect(s.controller.agent.profiles.size).toBe(profiles);
      expect(s.controller.snapshot().tracker.handsSeen).toBe(seen);
      expect(s.controller.snapshot().strategy?.selected).toBe(e);
      const before = s.decisions().length;
      await s.play(3);
      const later = s.decisions().slice(before);
      for (const r of later) engines.push(`${e}:${r.decision.strategy?.requested}`);
      expect(later.every((r) => r.decision.strategy?.requested === e)).toBe(true);
    }
    expect(engines.length).toBeGreaterThan(4);
    expect(s.controller.snapshot().tracker.handsSeen).toBe(15);
    expect((await s.store.recentHands()).length).toBe(15);
    expect(s.world.clicks).toEqual([]);
    expect(s.errors()).toEqual([]);
  }, 90000);
});

describe('dashboard labels and the shadow comparison', () => {
  it('the active strategy and any fallback are named', () => {
    const base = { strategy: { selected: 'v3' as const, experimental: true, recommendOnly: true, shadowV3: false, artifacts: [] } } as unknown as LiveState;
    expect(strategyTag(base)).toMatchObject({ text: 'v3 experimental', fallback: false });
    expect(strategyTag(base)!.detail).toMatch(/Recommendation-only/);
    const fell = { ...base, decision: { strategy: { requested: 'v3', used: 'v2', fallback: '2 opponents in the pot: version 3 searches heads-up pots only' } } } as unknown as LiveState;
    expect(strategyTag(fell)).toMatchObject({ text: 'v3 → v2 fallback', tone: 'warn', fallback: true });
    expect(strategyTag(fell)!.detail).toMatch(/2 opponents in the pot/);
    expect(strategyTag({ strategy: { ...base.strategy!, selected: 'v2', experimental: false, recommendOnly: false } } as unknown as LiveState)).toMatchObject({ text: 'v2', fallback: false });
    expect(strategyTag(null)).toBeNull();
  });

  it('shadow comparison (off by default): computed after version 2, shown with non-comparable EVs, never executed', async () => {
    const s = new Session(sanitizeSettings({ ...DEFAULT_SETTINGS, ...AUTHORISED, mode: 'recommend', shadowV3: true }), 2, 52);
    await s.play(8);
    const shadows = s.lives.map((l) => l.shadow).filter((x): x is NonNullable<typeof x> => !!x && !!x.v3);
    expect(shadows.length).toBeGreaterThan(0);
    for (const l of s.lives) if (l.shadow) expect(l.shadow.key).toBe(l.recommendation.context?.key);
    expect(shadowRows(s.lives.find((l) => l.shadow?.v3)!).map((r) => r[0])).toEqual(['Version 2 (selected)', 'Version 3 (shadow)', 'Same action', 'Note']);
    expect(shadowRows(s.lives.find((l) => l.shadow?.v3)!).pop()![1]).toMatch(/not comparable/);
    // The recommendation itself is version 2's; the shadow result is never stored as a decision.
    expect(s.decisions().every((r) => r.decision.strategy?.requested === 'v2')).toBe(true);
    expect(s.sent.some((m) => m.type === 'bot/diag' && /^shadow comparison/.test(m.record.message))).toBe(true);
    expect(s.world.clicks).toEqual([]);
    // Off: no shadow agent, no shadow state.
    s.setSettings({ shadowV3: false });
    expect(s.controller.snapshot().shadow).toBeNull();
    expect(s.errors()).toEqual([]);
  }, 60000);
});
