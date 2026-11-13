// ============================================================
// Dashboard / overlay presentation (src/bot/ext/view.ts), checked on the states
// the controller produces from the REAL recording in fixtures/live-2026-11-13.json.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { TableObs } from '../../src/bot/adapter/observation';
import { ControllerDeps, LiveController } from '../../src/bot/ext/controller';
import { DEFAULT_SETTINGS, LiveState, sanitizeSettings } from '../../src/bot/ext/records';
import { actionTitle, actorLine, cardView, chips, contextRows, decisionBanner, explanation, playerRows, recentTimeline, statusPill } from '../../src/bot/ext/view';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'live-2026-11-13.json'), 'utf8')) as { hands: { frames: { n: number; obs: TableObs }[] }[] };
const frames = fixture.hands.flatMap((h) => h.frames);
const lives: LiveState[] = [];

beforeAll(async () => {
  let i = 0;
  const deps: ControllerDeps = {
    observe: () => frames[i].obs, health: () => ({ seats: true, hero: true, dealer: true, blinds: true }),
    driver: { async click() { return true; }, async betOrRaise(to) { return { submitted: true, readBack: to, detail: 'ok' }; } },
    send: () => undefined, loadProfiles: async () => [], now: () => performance.now(), sleep: async () => undefined, yieldFn: async () => undefined, random: () => 0.5, render: () => undefined,
  };
  const c = new LiveController(deps, sanitizeSettings({ ...DEFAULT_SETTINGS, mode: 'recommend' }), 3);
  for (i = 0; i < frames.length; i++) { c.tick(); await new Promise((r) => setTimeout(r, 2)); c.tick(); lives.push(JSON.parse(JSON.stringify(c.snapshot())) as LiveState); }
}, 30000);

describe('presentation helpers', () => {
  it('cards are drawn from the card text and an unreadable card is never guessed', () => {
    expect(cardView('Qc')).toMatchObject({ rank: 'Q', suit: '♣', red: false, label: 'queen of clubs' });
    expect(cardView('Th')).toMatchObject({ rank: '10', suit: '♥', red: true });
    expect(cardView('zz')).toMatchObject({ rank: '?', suit: '' });
    expect([chips(1305), chips(0.5), chips(null)]).toEqual(['1,305', '0.5', '–']);
  });
});

describe('decision area on the recorded states', () => {
  const banner = (n: number) => decisionBanner(lives[n], lives[n].ts);

  it('is never blank', () => {
    expect(lives.length).toBe(118);
    expect(lives.every((l) => decisionBanner(l, l.ts).title.length > 0)).toBe(true);
  });

  it('waiting states read as plain messages', () => {
    expect(banner(0)).toMatchObject({ kind: 'message', title: 'Waiting for the next hand.' }); // previous board still up
    expect(banner(2)).toMatchObject({ kind: 'message', title: 'Waiting for the next hand.', sub: 'You are not dealt in to this hand.' });
    expect(banner(45)).toMatchObject({ kind: 'message', title: 'Waiting for your turn.' });
    expect(banner(45).sub).toMatch(/to act$/);
    expect(banner(66)).toMatchObject({ kind: 'message', title: 'You folded.' });
    expect(banner(73)).toMatchObject({ title: 'Waiting for the next hand.' });
    expect(explanation(lives[66])).toEqual([]); // no reasoning is shown without a recommendation
  });

  it('Hero\'s recorded turns show an action with its price and the engine\'s own reasoning', () => {
    const b58 = banner(58); // big-blind option with QcQd
    expect(b58.kind).toBe('action');
    expect(b58.title).toMatch(/^(CHECK|RAISE TO \d+|ALL-IN \d+)$/);
    expect(b58.sub).toBe('Check is free');
    expect(actionTitle(lives[58])).toBe(b58.title);
    const why = explanation(lives[58]);
    expect(why.length).toBeGreaterThan(0);
    expect(why.join(' ')).toContain(lives[58].decision!.basis[0].slice(1));
    const b86 = banner(86); // small blind facing a raise
    expect(b86.kind).toBe('action');
    expect(b86.title).toMatch(/^(FOLD|CALL 7|RAISE TO \d+|ALL-IN.*)$/);
    expect(b86.sub).toBe('7 to call');
    expect(banner(106).sub).toBe('12 to call');
    // Equity appears in the explanation only when the engine computed one.
    for (const n of [58, 86, 106]) expect(explanation(lives[n]).some((w) => /^Estimated equity/.test(w))).toBe(lives[n].decision!.equity !== null);
  });

  it('pause, reconnect and blocked states are distinct', () => {
    const l = lives[58];
    expect(statusPill(lives[0], lives[0].ts).label).toBe('Waiting');
    expect(statusPill(l, l.ts).label).toBe('Ready');
    expect(lives.filter((x) => statusPill(x, x.ts).label === 'Needs attention').length).toBe(0);
    expect(statusPill(l, l.ts + 10000).label).toBe('Reconnecting');
    expect(decisionBanner(l, l.ts + 10000).title).toBe('Reconnecting.');
    expect(statusPill(null, 0).label).toBe('Waiting');
    expect(decisionBanner(null, 0).title).toBe('Reading table information.');
    // An emergency stop is a pause, not a state problem: the recommendation stays visible.
    const stopped = { ...l, estop: true };
    expect(statusPill(stopped, l.ts).label).toBe('Paused');
    expect(decisionBanner(stopped, l.ts)).toMatchObject({ kind: 'action', title: banner(58).title });
    expect(decisionBanner(stopped, l.ts).sub).toMatch(/Bot paused: nothing will be clicked/);
    expect(decisionBanner({ ...l, mode: 'manual' }, l.ts)).toMatchObject({ kind: 'message', title: 'Bot paused.' });
    // A blocked decision names the kind of problem and carries the reason, unchanged.
    const blocked: LiveState = { ...l, decision: null, recommendation: { state: 'blocked', reason: 'table shows seat 3 to act, engine expects seat 5', context: null }, tracker: { ...l.tracker, turnStatus: 'disagree' } };
    expect(decisionBanner(blocked, l.ts)).toMatchObject({ kind: 'message', title: 'Decision unavailable — turn tracking mismatch.', tone: 'bad', sub: 'table shows seat 3 to act, engine expects seat 5' });
    expect(statusPill(blocked, l.ts)).toMatchObject({ label: 'Needs attention', detail: 'table shows seat 3 to act, engine expects seat 5' });
    const other: LiveState = { ...blocked, recommendation: { state: 'blocked', reason: 'stack mismatch seat 4 (X): engine 10, table 12', context: null }, tracker: { ...l.tracker, turnStatus: 'agree' } };
    expect(decisionBanner(other, l.ts).title).toBe('Decision unavailable — table state not confirmed.');
  });
});

describe('players, context and timeline on the recorded states', () => {
  it('hand 3 at Hero\'s big-blind option (n=58)', () => {
    const l = lives[58];
    const rows = playerRows(l);
    expect(rows.find((r) => r.isHero)).toMatchObject({ seat: 1, position: 'BB', kind: 'acting', status: 'To act', stack: '98', lastAction: 'Big blind 2' });
    expect(rows.find((r) => r.seat === 2)).toMatchObject({ kind: 'folded', status: 'Folded', lastAction: 'Fold' });
    expect(rows.find((r) => r.seat === 9)).toMatchObject({ kind: 'active', position: 'SB', lastAction: 'Call 1', status: 'In hand' });
    expect(rows.find((r) => r.seat === 10)).toMatchObject({ kind: 'not-dealt', position: '', lastAction: '', status: 'Not in this hand · away' });
    expect(rows.filter((r) => r.kind === 'acting').length).toBe(1);
    expect(actorLine(l)).toMatchObject({ text: 'Your turn', verified: true });
    expect(Object.fromEntries(contextRows(l))).toEqual({ Pot: '10 · 5.0 bb', 'To call': 'Nothing (check is free)', Blinds: '1 / 2', 'Opponents in hand': '4', Situation: 'Multiway pot (5 players)' });
    const tl = recentTimeline(l, 20);
    expect(tl[0].street).toBe('preflop');
    expect(tl.map((e) => e.text.split(' · ')[0])).toEqual(['SB: Posts small blind 1', 'BB: Posts big blind 2', 'UTG: Fold', 'HJ: Call 2', 'CO: Call 2', 'BTN: Call 2', 'SB: Call 1']);
    expect(tl[1].text).toMatch(/· you$/);
    expect(tl.every((e) => !e.deduced)).toBe(true);
  });

  it('another player\'s turn, and the hand Hero sat out', () => {
    const a = actorLine(lives[45]);
    expect(a.verified).toBe(true);
    expect(a.text).toMatch(/\(HJ\) to act$/);
    const rows = playerRows(lives[5]); // hand 2: Hero seated without cards
    expect(rows.find((r) => r.isHero)).toMatchObject({ kind: 'not-dealt', status: 'Not in this hand' });
    expect(Object.fromEntries(contextRows(lives[5])).Blinds).toBe('1 / 2');
  });
});
