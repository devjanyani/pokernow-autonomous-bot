// ============================================================
// Regression tests from a REAL recording: tests/bot/fixtures/live-2026-11-13.json
// is a debug bundle exported from a recommendation-only session on a no-money
// PokerNow table (extension 0.4.0), with names and the table id replaced.
// The observations are exactly what the page showed; nothing was edited.
//
// What the recording shows (frame numbers are the recorder's `n`):
//   - the acting-seat highlight stays on the seat that just acted for 0.2-0.9 s
//   - a sitting-out player is drawn with the `fold` class, no cards, no chips
//   - hand 3: Hero is the big blind (bet 2, check button on Hero's turn, n=57-60)
//   - hand 4: Hero is the small blind and faces a raise to 8 (call 7, n=86)
//   - hand 5: the small-blind seat sits out, only a big blind is posted (pot 2);
//             Hero on the button faces 12 (n=106)
// In 0.4.0 none of these Hero turns produced a recommendation.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { TableObs } from '../../src/bot/adapter/observation';
import { HandTracker, TrackerState } from '../../src/bot/adapter/tracker';
import { replayObservations } from '../../src/bot/diag/replay';
import { ControllerDeps, LiveController } from '../../src/bot/ext/controller';
import { BotMessage, DEFAULT_SETTINGS, sanitizeSettings, Settings } from '../../src/bot/ext/records';
import { applyAction, createHand, legalActions, potTotal, totalChips } from '../../src/bot/table/engine';

interface Frame { n: number; obs: TableObs; liveDecision: string }
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'live-2026-11-13.json'), 'utf8')) as { hands: { frames: Frame[] }[] };
const frames: Frame[] = fixture.hands.flatMap((h) => h.frames);
const HERO = 1;

/** Tracker state after every recorded frame, keyed by the recorder's frame number. */
function track(): Map<number, TrackerState> {
  const t = new HandTracker();
  const out = new Map<number, TrackerState>();
  for (const f of frames) { t.ingest(f.obs); const s = t.state; out.set(f.n, { ...s, hand: s.hand ? JSON.parse(JSON.stringify({ ...s.hand, payouts: null })) : null }); }
  return out;
}
const actions = (s: TrackerState) => s.hand!.events.filter((e) => !e.kind.startsWith('post')).map((e) => `${e.street[0]}:${e.seat}:${e.kind}${e.kind === 'bet' || e.kind === 'raise' ? e.to : ''}`);

describe('live recording 2026-11-13: what the page showed', () => {
  it('the fixture is the recording: 5 hands, 118 consecutive frames, six frames with Hero\'s turn shown, none had a recommendation live', () => {
    expect(fixture.hands.length).toBe(5);
    expect(frames.map((f) => f.n)).toEqual(Array.from({ length: 118 }, (_, i) => i));
    const heroTurn = frames.filter((f) => f.obs.heroToAct);
    expect(heroTurn.map((f) => f.n)).toEqual([57, 58, 59, 60, 86, 106]);
    expect(heroTurn.every((f) => f.liveDecision === 'blocked' || f.liveDecision === 'none')).toBe(true);
  });

  it('the acting-seat highlight lags: after an action is displayed it stays on that seat until the next frame group', () => {
    const at = (n: number) => frames[n].obs;
    // n=9/10: seat 6 has raised to 6 (bet shown, stack lower) and is still highlighted; n=11 the highlight moves to seat 8.
    expect(at(8).seats.find((s) => s.seat === 6)!.bet).toBe(0);
    expect([at(9).toActSeat, at(9).seats.find((s) => s.seat === 6)!.bet]).toEqual([6, 6]);
    expect([at(10).toActSeat, at(10).ts - at(9).ts > 120]).toEqual([6, true]);
    expect(at(11).toActSeat).toBe(8);
    // A fold lags the same way: the seat carries both classes for a moment.
    expect(at(3).seats.find((s) => s.seat === 2)!.cls).toMatch(/decision-current\s+fold/);
  });
});

describe('live recording 2026-11-13: reconstruction', () => {
  const st = track();

  it('a sitting-out player (fold class, no cards, no chips at the first frame) is not dealt in', () => {
    for (const n of [2, 42]) {
      const s = st.get(n)!;
      const away = s.participation.find((p) => p.seat === 10)!;
      expect(away, `frame ${n}`).toMatchObject({ dealtIn: false, canAct: false, eligibleForPot: false });
      expect(s.hand!.seats.find((x) => x.seat === 10)!.dealtIn).toBe(false);
    }
    expect(st.get(42)!.hand!.seats.filter((x) => x.dealtIn).length).toBe(6);
  });

  it('hand 2 (Hero not dealt in): never completes early; every action is read from the table, none is deduced', () => {
    const s10 = st.get(10)!; // 0.4.0 declared the hand complete here, on a lagging highlight
    expect(s10.hand!.phase).toBe('preflop');
    expect(s10.predictedActor).toBe(8);
    expect(actions(s10)).toEqual(['p:2:fold', 'p:5:call', 'p:6:raise6']);
    const end = st.get(41)!;
    expect(actions(end)).toEqual([
      'p:2:fold', 'p:5:call', 'p:6:raise6', 'p:8:raise22', 'p:9:raise38', 'p:5:fold', 'p:6:call', 'p:8:call',
      'f:8:check', 'f:9:bet16', 'f:6:raise48', 'f:8:fold', 'f:9:call',
      't:9:check', 't:6:bet140', 't:9:call',
      'r:9:check', 'r:6:bet300', 'r:9:call',
    ]);
    expect(end.meta.filter((m) => m.inferred && m.source !== 'showdown-evidence')).toEqual([]);
    expect(end.valid).toBe(true);
    expect(end.hand!.phase).toBe('complete');
    // Seat 9 wins 1092: the next hand opens with 1304 behind and 1 posted.
    expect(end.hand!.seats.find((x) => x.seat === 9)!.stack).toBe(1305);
    expect(end.hand!.seats.find((x) => x.seat === 6)!.stack).toBe(2716);
  });

  it('hand 3: Hero is the big blind, the round is not closed when the small blind completes, and Hero gets the option', () => {
    const start = st.get(42)!;
    const h = start.hand!;
    expect([h.buttonSeat, h.seats.find((x) => x.pos?.isSmallBlind)!.seat, h.seats.find((x) => x.pos?.isBigBlind)!.seat]).toEqual([8, 9, HERO]);
    expect(potTotal(start.hand as never)).toBe(3);
    expect(start.warnings.filter((w) => /pot mismatch/.test(w))).toEqual([]);
    for (const n of [57, 58, 59, 60]) {
      const s = st.get(n)!;
      expect([s.observedActor, s.predictedActor, s.turnStatus], `frame ${n}`).toEqual([HERO, HERO, 'agree']);
      expect(s.blockers, `frame ${n}`).toEqual([]);
      expect(s.legal.actions, `frame ${n}`).toMatchObject({ canCheck: true, callAmount: 0, canRaise: true, minRaiseTo: 4 });
      expect(potTotal(s.hand as never)).toBe(frames[n].obs.pot);
    }
    expect(actions(st.get(58)!)).toEqual(['p:2:fold', 'p:5:call', 'p:6:call', 'p:8:call', 'p:9:call']);
    // Flop: the small blind bets 12; Hero is next and is NOT folded by a lagging highlight (0.4.0 ended the hand at n=63).
    const s63 = st.get(63)!;
    expect([s63.hand!.street, s63.hand!.phase, s63.predictedActor]).toEqual(['flop', 'flop', HERO]);
    expect(s63.heroStatus).toBe('to-act');
    expect(st.get(64)!.turnStatus).toBe('agree');
    const end = st.get(73)!;
    expect(actions(end).slice(5)).toEqual(['p:1:check', 'f:9:bet12', 'f:1:fold', 'f:5:fold', 'f:6:fold', 'f:8:fold']);
    expect(end.hand!.phase).toBe('complete');
    expect(end.hand!.seats.find((x) => x.seat === 9)!.stack).toBe(1313); // the next hand shows 1313
    expect(end.hand!.seats.find((x) => x.seat === HERO)!.stack).toBe(98);
    expect(end.valid).toBe(true);
  });

  it('hand 4: Hero in the small blind faces the button\'s raise: Hero to act, 7 to call, buttons agree', () => {
    expect(st.get(85)!.predictedActor).toBe(HERO); // 0.4.0: hand "complete" here
    const s = st.get(86)!;
    expect([s.observedActor, s.predictedActor, s.turnStatus]).toEqual([HERO, HERO, 'agree']);
    expect(s.blockers).toEqual([]);
    expect(s.legal).toMatchObject({ status: 'match', actions: { canCheck: false, callAmount: 7, canRaise: true } });
    expect(potTotal(s.hand as never)).toBe(15);
    const end = st.get(96)!;
    expect(actions(end)).toEqual(['p:5:call', 'p:6:fold', 'p:8:call', 'p:9:raise8', 'p:1:fold', 'p:2:fold', 'p:5:fold', 'p:8:fold']);
    expect(end.hand!.seats.find((x) => x.seat === 9)!.stack).toBe(1320);
    expect(end.meta.some((m) => m.inferred)).toBe(false);
  });

  it('hand 5: dead small blind (only a big blind is posted): positions, pot and Hero\'s turn on the button are right', () => {
    const start = st.get(97)!;
    const h = start.hand!;
    expect(h.buttonSeat).toBe(HERO);
    expect(h.seats.find((x) => x.pos?.isBigBlind)!.seat).toBe(5);
    expect(h.seats.some((x) => x.pos?.isSmallBlind)).toBe(false);
    expect(h.seats.find((x) => x.seat === 2)!.dealtIn).toBe(false);
    expect(potTotal(h as never)).toBe(2);
    expect([start.predictedActor, start.turnStatus, start.blockers.length, start.warnings.length]).toEqual([6, 'agree', 0, 0]);
    const s = st.get(106)!;
    expect(actions(s)).toEqual(['p:6:raise6', 'p:8:call', 'p:9:raise12', 'p:10:call']);
    expect([s.observedActor, s.predictedActor, s.turnStatus]).toEqual([HERO, HERO, 'agree']);
    expect(s.blockers).toEqual([]);
    expect(s.legal).toMatchObject({ status: 'match', actions: { canCheck: false, callAmount: 12, canRaise: true } });
    expect(potTotal(s.hand as never)).toBe(38);
    expect(s.hand!.seats.find((x) => x.seat === HERO)!.pos!.label).toBe('BTN');
    const end = st.get(117)!;
    expect(actions(end).slice(4)).toEqual(['p:1:fold', 'p:5:fold', 'p:6:call', 'p:8:call', 'f:6:check', 'f:8:check', 'f:9:check']);
    expect(end.valid).toBe(true);
  });

  it('whole recording: no settled disagreement, no deduced fold, every Hero-turn frame usable, engine pot equals the table pot whenever someone is to act', () => {
    const r = replayObservations(frames);
    expect(r.hands.filter((h) => h.firstDivergence).map((h) => [h.handId, h.firstDivergence])).toEqual([]);
    expect(r.hands.reduce((n, h) => n + h.timeline.filter((e) => e.inferred && e.source !== 'showdown-evidence').length, 0)).toBe(0);
    expect([r.framesWithHeroTurnShown, r.framesHeroTurnUsable, r.framesHeroTurnBlocked]).toEqual([6, 6, 0]);
    let compared = 0;
    for (const f of frames) {
      const s = st.get(f.n)!;
      if (!s.hand || s.hand.toAct === null || f.obs.pot === null || f.obs.board.length !== s.hand.board.length) continue;
      // While the highlight lags, the table already shows chips the engine has also applied: totals still agree.
      expect(potTotal(s.hand as never), `frame ${f.n}`).toBe(f.obs.pot);
      compared++;
    }
    expect(compared).toBeGreaterThan(60);
    expect(legalActions).toBeTypeOf('function');
  });
});

describe('live recording 2026-11-13: end to end through the controller', () => {
  async function run(settings: Partial<Settings>) {
    let i = 0;
    const sent: BotMessage[] = [];
    const clicks: string[] = [];
    const shown: { n: number; state: string; label: string | null; status: string }[] = [];
    const deps: ControllerDeps = {
      observe: () => frames[i].obs, health: () => ({ seats: true, hero: true, dealer: true, blinds: true }),
      driver: { async click(k) { clicks.push(k); return true; }, async betOrRaise(to) { clicks.push(`raise:${to}`); return { submitted: true, readBack: to, detail: 'ok' }; } },
      send: (m) => sent.push(m), loadProfiles: async () => [], now: () => performance.now(), sleep: async () => {}, yieldFn: async () => {}, random: () => 0.5, render: () => {},
    };
    const c = new LiveController(deps, sanitizeSettings({ ...DEFAULT_SETTINGS, mode: 'recommend', ...settings }), 3);
    for (i = 0; i < frames.length; i++) {
      c.tick();
      await new Promise((r) => setTimeout(r, 2));
      c.tick();
      const l = c.snapshot();
      shown.push({ n: frames[i].n, state: l.recommendation.state, label: l.decision?.label ?? null, status: l.status });
    }
    return { sent, clicks, shown };
  }

  it('recommendations appear on every recorded Hero turn and at no other time; nothing is clicked', async () => {
    const { sent, clicks, shown } = await run({});
    const at = (n: number) => shown.find((s) => s.n === n)!;
    for (const n of [58, 60, 86, 106]) expect([n, at(n).state, at(n).label !== null]).toEqual([n, 'ready', true]);
    expect(at(58).label).not.toMatch(/^fold/i); // big blind with QcQd and a free check
    expect(shown.filter((s) => s.label !== null).map((s) => s.n).every((n) => frames[n].obs.heroToAct)).toBe(true);
    expect(shown.filter((s) => s.state === 'blocked')).toEqual([]);
    const decisions = sent.filter((m): m is Extract<BotMessage, { type: 'bot/decision' }> => m.type === 'bot/decision');
    expect(decisions.map((d) => [d.record.context!.street, d.record.context!.toCall, d.record.context!.canCheck])).toEqual([['preflop', 0, true], ['preflop', 7, false], ['preflop', 12, false]]);
    expect(decisions.map((d) => d.record.heroCards.join(''))).toEqual(['QcQd', '4c9d', '8h3d']);
    expect(clicks).toEqual([]);
    expect(at(65).status).toBe('Hero folded — waiting for next hand.');
  });

  it('emergency stop is independent of game-state validity: tracking and recommendations are unchanged, nothing is clicked', async () => {
    const stopped = await run({ estop: true });
    expect(stopped.shown.filter((s) => s.state === 'ready').map((s) => s.n)).toEqual(expect.arrayContaining([58, 86, 106]));
    expect(stopped.shown.filter((s) => s.state === 'blocked')).toEqual([]);
    expect(stopped.clicks).toEqual([]);
  });
});

describe('dead small blind in the rules engine (layout first seen in the live recording)', () => {
  for (let n = 3; n <= 10; n++) {
    it(`${n} dealt in: no small blind is posted, the first seat left of the button is the big blind, order and labels are complete`, () => {
      const h = createHand({ handId: `d${n}`, buttonSeat: 0, smallBlind: 1, bigBlind: 2, noSmallBlind: true, seats: Array.from({ length: n }, (_, i) => ({ seat: i, playerId: `p${i}`, stack: 100 })) });
      expect(h.events.map((e) => `${e.seat}:${e.kind}`)).toEqual(['1:post-bb']);
      expect(potTotal(h)).toBe(2);
      expect(h.seats.some((s) => s.pos!.isSmallBlind)).toBe(false);
      expect(h.seats.every((s) => typeof s.pos!.label === 'string')).toBe(true);
      expect(h.seats.find((s) => s.seat === 0)!.pos!.label).toBe('BTN');
      expect(h.toAct).toBe(n === 3 ? 2 : 2); // first to act is left of the big blind
      const total = totalChips(h);
      // Everyone calls round to the big blind, who has the option; then the flop is first-in-hand left of the button.
      for (let i = 0; i < n - 1; i++) applyAction(h, { seat: h.toAct as number, kind: 'call' });
      expect(h.toAct).toBe(1);
      expect(legalActions(h)).toMatchObject({ canCheck: true });
      applyAction(h, { seat: 1, kind: 'check' });
      expect(h.toAct).toBeNull();
      expect(totalChips(h)).toBe(total);
      expect(potTotal(h)).toBe(2 * n);
    });
  }
  it('heads-up ignores the option (the button always posts the small blind)', () => {
    const h = createHand({ handId: 'hu', buttonSeat: 0, smallBlind: 1, bigBlind: 2, noSmallBlind: true, seats: [0, 1].map((i) => ({ seat: i, playerId: `p${i}`, stack: 100 })) });
    expect(h.events.map((e) => `${e.seat}:${e.kind}`)).toEqual(['0:post-sb', '1:post-bb']);
  });
});
