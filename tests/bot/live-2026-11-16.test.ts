// ============================================================
// Regression tests from the long recording of 2026-11-16 (extension 0.6.0, 3/2 blinds, deep stacks).
// tests/bot/fixtures/live-2026-11-16-ranges.json holds four frame ranges cut from it with
// sim/bot/make-range-fixture.ts: names and the table id are placeholders, the observations are unaltered.
// Hero is seat 1. Frame numbers are the recorder's `n`.
//
// What the recording shows and 0.6.1 got wrong (docs/bot/LONG_SESSION_DIAGNOSTIC_AUDIT.md):
//   A  an all-in is called for less: the site puts the uncalled part back on the bettor's stack BEFORE the
//      board is run out (n=765, n=1602). The hand was silently marked uncertain and stored as invalid.
//   B  at showdown the loser mucks (n=1518): not every live seat shows cards, the pot is paid and the next
//      hand starts. The hand was stored as "ending not observed".
//   C  a call of an all-in is drawn as the caller's WHOLE stack in front (n=1581: 3,235 against a bet of 802).
//      It was read as a raise, which the rules do not allow there, and the hand became invalid.
//   D  for a moment the page shows no chip amounts at all (stacks and pot unreadable, bets drawn as 0,
//      n=360). The highlight had moved on, so a check was deduced; the seat had in fact bet 9 (n=361).
//   E  a player folds although a check is free (n=1409). Nothing else moved, so nothing was missed, but the
//      hand was marked uncertain.
//   F  an all-in is called and the board is run twice. The page shows ONE board; the pot is then split
//      (n=262-266: Hero's two pair beats eights on the board shown, yet each player gets half). The result
//      settled from the cards shown was wrong by 113 chips and nothing checked it.
//   G  facing an all-in for more than Hero has, the call button shows the FULL amount to match ("Call 126")
//      although Hero can only put in 64 (n=83). The engine computes 64, so the buttons were reported as
//      disagreeing and the recommendation was suppressed at exactly that decision.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { TableObs } from '../../src/bot/adapter/observation';
import { CompletedHand, HandTracker, ResultCheck } from '../../src/bot/adapter/tracker';
import { toHandRecord, toStackCheck } from '../../src/bot/ext/records';
import { handRow, handStatus, handTotals, handWarnings, heroResult } from '../../src/bot/ext/viewmodel';

interface Frame { n: number; obs: TableObs }
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'live-2026-11-16-ranges.json'), 'utf8')) as { segments: { name: string; frames: Frame[] }[] };
const segment = (name: string): Frame[] => JSON.parse(JSON.stringify(fixture.segments.find((s) => s.name === name)!.frames));

interface Run { hands: (CompletedHand & { issues: string[] })[]; checks: ResultCheck[] }
function run(frames: Frame[]): Run {
  const t = new HandTracker();
  const hands: Run['hands'] = [];
  const checks: ResultCheck[] = [];
  let issues: string[] = [];
  for (const f of frames) {
    const done = t.ingest(f.obs);
    for (const c of done) hands.push({ ...c, issues });
    checks.push(...t.takeResultChecks());
    issues = t.state.issues.slice();
  }
  return { hands, checks };
}
const net = (c: CompletedHand) => Object.fromEntries(c.hand.seats.filter((s) => s.dealtIn).map((s) => [s.seat, Math.round((s.stack - s.startStack) * 100) / 100]));
const line = (c: CompletedHand, street: string) => c.hand.events.filter((e) => e.street === street && !e.kind.startsWith('post')).map((e) => `${e.seat}:${e.kind}${e.kind === 'bet' || e.kind === 'raise' ? e.to : e.kind === 'call' ? e.amount : ''}`);
const seat = (f: Frame, n: number) => f.obs.seats.find((s) => s.seat === n)!;

describe('A: the uncalled part of an all-in is returned before the board is run out', () => {
  it('river all-in called for less (n=762-765): the hand is valid and the stacks are right', () => {
    const { hands } = run(segment('allin-call-refund-river'));
    const h = hands[0];
    expect(line(h, 'river')).toEqual(['4:bet539', '10:call487']);
    expect(h.hand.phase).toBe('complete');
    expect(net(h)).toEqual({ 1: 0, 4: 503, 9: -3, 10: -500 });
    expect(h.observedToEnd).toBe(true);
    expect(h.valid).toBe(true);
  });
  it('four-way all-in before the flop (n=1594-1606): Hero\'s loss of 1,602 is a verified result', () => {
    const { hands } = run(segment('mucked-showdown-overcall-refund'));
    const h = hands[3];
    expect(h.hand.handId).toContain(':h:4:');
    expect(net(h)).toEqual({ 1: -1602, 4: 1832, 6: -2771, 10: 2541 });
    expect(h.valid).toBe(true);
  });
  it('a stack that is NOT explained by a returned bet still keeps the hand out, and now says why', () => {
    const frames = segment('mucked-showdown-overcall-refund');
    for (const f of frames) if (f.n >= 1602 && f.n <= 1605) seat(f, 4).stack = 600; // the true refund is 509
    const h = run(frames).hands[3];
    expect(h.valid).toBe(false);
    expect(h.issues.some((i) => /seat 4 .*600.*not explained/.test(i))).toBe(true);
  });
});

describe('B: a showdown where the loser does not show', () => {
  it('is confirmed by the stacks at the start of the next hand (n=1518-1519)', () => {
    const { hands } = run(segment('mucked-showdown-overcall-refund'));
    const h = hands[0];
    expect(h.hand.wentToShowdown).toBe(true);
    expect(net(h)).toEqual({ 1: -1081, 4: 2204, 6: -1081, 10: -42 });
    expect(h.observedToEnd).toBe(true);
    expect(h.valid).toBe(true);
    expect(h.endConfirmedByNextHand).toBe(true);
  });
  it('stays "ending not observed" when the next hand\'s stacks do not agree with the assumed result', () => {
    const frames = segment('mucked-showdown-overcall-refund');
    seat(frames.find((f) => f.n === 1519)!, 4).stack = 3185; // 100 short of what the winner should have
    const h = run(frames).hands[0];
    expect(h.observedToEnd).toBe(false);
    expect(h.valid).toBe(false);
  });
  it('stays "ending not observed" when a player of the hand is no longer at the table to check', () => {
    const frames = segment('mucked-showdown-overcall-refund');
    const next = frames.find((f) => f.n === 1519)!;
    next.obs.seats = next.obs.seats.filter((s) => s.seat !== 6);
    expect(run(frames).hands[0].observedToEnd).toBe(false);
  });
});

describe('C: a call drawn as the caller\'s whole stack', () => {
  it('is a call when no raise is possible (n=1581); the split pot is then settled correctly', () => {
    const { hands } = run(segment('mucked-showdown-overcall-refund'));
    const h = hands[2];
    expect(line(h, 'turn')).toEqual(['10:bet802', '4:call802']);
    expect(h.issues.filter((i) => i.startsWith('INVALID'))).toEqual([]);
    expect(net(h)).toEqual({ 1: -3, 4: 3, 6: -3, 10: 3 }); // both made the same straight
    expect(h.valid).toBe(true);
  });
});

describe('D: chip amounts momentarily unreadable', () => {
  it('no check is deduced from a frame without readable chips; the bet shown next is applied (n=360-361)', () => {
    const { hands } = run(segment('open-fold-and-unreadable-chips'));
    const h = hands[0];
    expect(line(h, 'turn')).toEqual(['9:check', '10:bet9', '4:fold', '9:fold']);
    expect(net(h)).toEqual({ 1: 0, 4: -3, 9: -3, 10: 6 });
    expect(h.hand.phase).toBe('complete');
  });
});

describe('E: folding when a check is free', () => {
  it('is accepted as an action when no chips moved anywhere (n=1409)', () => {
    const { hands } = run(segment('open-fold-river'));
    const h = hands[0];
    expect(line(h, 'river')).toEqual(['6:fold', '10:bet234', '4:fold']);
    expect(h.valid).toBe(true);
    expect(h.issues.some((i) => /seat 6 folded although a check was free/.test(i))).toBe(true);
  });
  it('still marks the hand uncertain when another stack shows that a bet was missed', () => {
    const frames = segment('open-fold-river');
    for (const f of frames) if (f.n >= 1409 && f.n <= 1410) seat(f, 10).stack = 1012; // 100 fewer chips, no bet drawn
    expect(run(frames).hands[0]?.valid ?? false).toBe(false);
  });
});

describe('F: every result is checked against the stacks the next hand starts with', () => {
  it('ordinary hands are confirmed, including the 1,602-chip loss', () => {
    const { hands, checks } = run(segment('mucked-showdown-overcall-refund'));
    // Hand 1 of the range was emitted when hand 2 started, so its check travels with it; the others arrive later.
    expect(hands[0].resultCheck?.status).toBe('confirmed');
    expect(checks.map((c) => [c.handId.split(':')[2], c.status, c.heroDiff])).toEqual([['2', 'confirmed', 0], ['3', 'confirmed', 0], ['4', 'unavailable', null]]);
    // After the all-in Hero has no chips and is not dealt into the next hand, and the page then numbers the seats
    // differently: the result cannot be cross-checked, and that is what is reported.
    expect(checks[2].note).toMatch(/no longer at the table/);
  });

  it('a board run twice (n=262-266): the pot was split, and the table\'s result replaces the one settled from the cards shown', () => {
    const { hands, checks } = run(segment('board-run-twice'));
    const h = hands[0];
    expect(h.valid).toBe(true);
    expect(net(h)[1]).toBe(126);                                  // from the one board the page showed
    const c = checks.find((x) => x.handId === h.hand.handId)!;
    expect(c).toMatchObject({ status: 'awarded-differently', heroDiff: -113 });
    expect(c.diffs).toEqual([{ seat: 1, diff: -113 }, { seat: 2, diff: 113 }, { seat: 4, diff: 8 }]); // seat 4 had folded: a top-up
    const rec = { ...toHandRecord(h, 'table-3', 0), stackCheck: toStackCheck(c) };
    expect(rec.heroNet).toBe(126);
    expect(heroResult(rec)).toBe(13);
    expect(handStatus(rec)).toMatchObject({ kind: 'verified', label: 'Verified by stacks' });
    expect(handWarnings(rec).some((w) => /Result taken from the table/.test(w))).toBe(true);
    expect(handTotals([handRow(rec, new Map())])).toMatchObject({ verified: 1, netBB: 6.5 });
  });

  it('a difference that is neither a top-up nor a re-division of the pot leaves the result unverified', () => {
    const frames = segment('board-run-twice');
    for (const f of frames) if (f.n >= 266) seat(f, 1).stack = (seat(f, 1).stack ?? 0) - 40; // 40 chips vanish
    const { hands, checks } = run(frames);
    const c = checks.find((x) => x.handId === hands[0].hand.handId)!;
    expect(c.status).toBe('unexplained');
    const rec = { ...toHandRecord(hands[0], 'table-3', 0), stackCheck: toStackCheck(c) };
    expect(handStatus(rec).kind).toBe('unverified');
    expect(handTotals([handRow(rec, new Map())])).toMatchObject({ verified: 0, unverifiedWithResult: 1 });
  });

  it('chips added between hands do not cast doubt on the result', () => {
    const frames = segment('open-fold-river');
    for (const f of frames) if (f.n >= 1415) seat(f, 6).stack = (seat(f, 6).stack ?? 0) + 500;
    const { checks } = run(frames);
    expect(checks[0]).toMatchObject({ status: 'top-up', heroDiff: 0, diffs: [{ seat: 6, diff: 500 }] });
  });
});

describe('G: the call button of a short all-in call', () => {
  it('shows the full bet; that agrees with a capped call and the decision is not blocked (n=83-84)', () => {
    const t = new HandTracker();
    let s = t.state, toAct: number | null = null;
    for (const f of segment('short-allin-call-button')) { t.ingest(f.obs); if (f.n === 84) { s = t.state; toAct = s.hand!.toAct; } }
    expect(toAct).toBe(1);
    expect(s.legal.actions).toMatchObject({ callAmount: 64, canRaise: false });
    expect(s.legal.context!.controls.some((c) => /Call 126/.test(c))).toBe(true);
    expect(s.blockers).toEqual([]);
    expect(s.legal.status).toBe('match');
    expect(s.legal.detail).toMatch(/call button shows the full 126; Hero can call 64 all-in/);
  });
  it('a call button that matches neither the capped nor the full amount is still a mismatch', () => {
    const frames = segment('short-allin-call-button');
    for (const f of frames) if (f.n >= 83 && f.n <= 84) f.obs.controls.call = 90;
    const t = new HandTracker();
    let s = t.state;
    for (const f of frames) { t.ingest(f.obs); if (f.n === 84) s = t.state; }
    expect(s.legal.status).toBe('mismatch');
    expect(s.blockers.length).toBeGreaterThan(0);
  });
});
