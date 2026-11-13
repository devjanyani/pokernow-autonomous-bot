import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { CardId, parseCards, Rng, shuffledDeck } from '../../src/bot/cards';
import { HandTracker, CompletedHand } from '../../src/bot/adapter/tracker';
import { GuardedExecutor, TableDriver, Fresh } from '../../src/bot/adapter/executor';
import { TableObs } from '../../src/bot/adapter/observation';
import { parseChips, PokerNowDom } from '../../src/bot/adapter/pokernow/dom';
import { parseLogCsv, parseLogLine, replayLog } from '../../src/bot/adapter/pokernow/log';
import { applyHandToProfiles, PlayerProfile } from '../../src/bot/opponents/profile';
import { archetypePolicy, randomPolicy } from '../../src/bot/sim/policies';
import { playHand } from '../../src/bot/sim/table';
import { cloneHand, HandState, legalActions } from '../../src/bot/table/engine';
import { act, mk } from './helpers';
import { render, toHtml } from './render';

const sig = (h: HandState) => h.events.map((e) => `${e.street}:${e.seat}:${e.kind}:${e.to}`);

/** Play one simulated hand and capture what Hero would see after every step. */
async function recorded(n: number, seed: number, heroSeat = 0, policy = () => archetypePolicy('loose-aggressive')) {
  const rng = new Rng(seed);
  const frames: { obs: TableObs; h: HandState }[] = [];
  let t = 1000;
  const res = await playHand({
    handId: `r${n}-${seed}`, buttonSeat: rng.int(n), smallBlind: 10, bigBlind: 20,
    seats: Array.from({ length: n }, (_, s) => ({ seat: s, playerId: `p${s}`, policy: policy(), stack: 400 + rng.int(3000) })),
    deck: shuffledDeck(rng), seed: rng.int(1 << 30),
    onStep: (h, holes) => { t += 300; frames.push({ obs: render(h, heroSeat, holes, t), h: cloneHand(h) }); },
  });
  return { frames, res };
}

function runTracker(frames: TableObs[]): { tracker: HandTracker; done: CompletedHand[] } {
  const tracker = new HandTracker();
  const done: CompletedHand[] = [];
  for (const f of frames) done.push(...tracker.ingest(f));
  return { tracker, done };
}

describe('state reconstruction from observations (replay fixtures)', () => {
  for (const n of [2, 3, 6, 9, 10]) {
    it(`reproduces every action of simulated ${n}-handed hands exactly`, async () => {
      for (let seed = 1; seed <= 40; seed++) {
        const { frames, res } = await recorded(n, seed * 13 + n);
        const { tracker, done } = runTracker(frames.map((f) => f.obs));
        expect(tracker.state.valid, `seed ${seed}: ${tracker.state.issues.join('; ')}`).toBe(true);
        expect(done.length).toBe(1);
        expect(sig(done[0].hand)).toEqual(sig(res.h));
        expect(done[0].valid).toBe(true);
        expect(done[0].observedToEnd).toBe(true);
        // Same chips for every seat as the ground truth, side pots included.
        for (const s of res.h.seats) expect(done[0].hand.seats.find((x) => x.seat === s.seat)!.stack).toBeCloseTo(s.stack, 6);
        expect(done[0].heroCards).toEqual(res.holes.get(0));
      }
    });
  }

  it('ignores repeated observations: no duplicate events (edge cases 15, 26)', async () => {
    const { frames, res } = await recorded(6, 77);
    const tripled = frames.flatMap((f) => [f.obs, { ...f.obs, ts: f.obs.ts + 1 }, { ...f.obs, ts: f.obs.ts + 2 }]);
    const { done } = runTracker(tripled);
    expect(done.length).toBe(1);
    expect(sig(done[0].hand)).toEqual(sig(res.h));
  });

  it('catches up after missed observations, or refuses to trust the state (edge case 16)', async () => {
    let exact = 0, flagged = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const { frames, res } = await recorded(5, seed * 7 + 3);
      const rng = new Rng(seed);
      const kept = frames.filter((_, i) => i === 0 || i === frames.length - 1 || rng.next() > 0.4).map((f) => f.obs);
      const { tracker, done } = runTracker(kept);
      const got = done[0]?.hand ?? tracker.state.hand!;
      if (JSON.stringify(sig(got)) === JSON.stringify(sig(res.h))) exact++;
      else {
        // A reconstruction that differs from the truth must never be presented as trustworthy.
        flagged++;
        // Either the hand was never emitted as valid, or the tracker is still mid-hand holding a true PREFIX of the action.
        const prefix = JSON.stringify(sig(res.h).slice(0, sig(got).length)) === JSON.stringify(sig(got));
        expect(done[0]?.valid ?? false, `seed ${seed} emitted a wrong hand as valid`).toBe(false);
        expect(got.phase === 'complete' || prefix || !tracker.state.valid || tracker.state.confidence < 0.7, `seed ${seed} silently wrong`).toBe(true);
      }
    }
    expect(exact).toBeGreaterThan(70); // measured: 87 of 120 exact with 40% of observations dropped; the rest are flagged
    expect(exact + flagged).toBe(120);
  });

  it('does not track a hand joined after the flop, then tracks the next one', async () => {
    const a = await recorded(4, 5, 0, () => archetypePolicy('loose-passive'));
    const b = await recorded(4, 6, 0, () => archetypePolicy('loose-passive'));
    const mid = a.frames.findIndex((f) => f.obs.board.length >= 3);
    expect(mid).toBeGreaterThan(0);
    const tracker = new HandTracker();
    for (const f of a.frames.slice(mid)) tracker.ingest(f.obs);
    expect(tracker.state.hand).toBeNull();
    expect(tracker.state.confidence).toBe(0);
    const done: CompletedHand[] = [];
    for (const f of b.frames) done.push(...tracker.ingest({ ...f.obs, ts: f.obs.ts + 1e6 }));
    expect(done.length).toBe(1);
    expect(sig(done[0].hand)).toEqual(sig(b.res.h));
  });

  it('tracks consecutive hands with players joining, leaving and Hero changing seat (edge cases 9, 11)', async () => {
    const tracker = new HandTracker();
    const done: CompletedHand[] = [];
    let ts = 0;
    for (const [n, heroSeat, seed] of [[6, 0, 1], [5, 3, 2], [7, 6, 3], [2, 1, 4]] as const) {
      const r = await recorded(n, seed + 500, heroSeat);
      for (const f of r.frames) done.push(...tracker.ingest({ ...f.obs, ts: (ts += 300) }));
      expect(sig(done[done.length - 1].hand)).toEqual(sig(r.res.h));
      expect(done[done.length - 1].heroSeat).toBe(heroSeat);
    }
    expect(done.length).toBe(4);
    expect(done.map((d) => d.hand.seats.filter((s) => s.dealtIn).length)).toEqual([6, 5, 7, 2]);
  });

  it('refuses Omaha and four-card hands (edge case 27)', async () => {
    const { frames } = await recorded(4, 9);
    const t1 = new HandTracker();
    t1.ingest({ ...frames[0].obs, gameType: 'PLO' });
    expect(t1.state.unsupported).toBe(true);
    expect(t1.state.hand).toBeNull();
    const t2 = new HandTracker();
    t2.ingest({ ...frames[0].obs, gameType: null, heroCards: null, problems: ['hero has 4 cards'] });
    expect(t2.state.unsupported).toBe(true);
    expect(t2.state.confidence).toBe(0);
  });

  it('flags a table/engine disagreement instead of acting on it (edge cases 17, 28)', async () => {
    const h = mk(3);
    const holes = new Map<number, [CardId, CardId]>([[0, [0, 5]], [1, [9, 14]], [2, [20, 25]]]);
    const tracker = new HandTracker();
    tracker.ingest(render(h, 0, holes, 1));
    expect(tracker.state.confidence).toBe(1);
    // The call button claims a different amount than the rules imply.
    const o = render(h, 0, holes, 2);
    o.controls.call = 55;
    tracker.ingest(o);
    expect(tracker.state.confidence).toBeLessThan(0.7);
    expect(tracker.state.issues.join(' ')).toMatch(/call button shows 55/);
    // An impossible observation (a board card appears while betting is open and nobody acted).
    const t2 = new HandTracker(0);
    t2.ingest(render(h, 2, holes, 1));
    const bad = render(h, 2, holes, 2);
    bad.seats[0].bet = 7; // below the big blind: not a legal call or raise
    t2.ingest(bad);
    expect(t2.state.valid).toBe(false);
    expect(t2.state.confidence).toBe(0);
  });

  it('applies tracked hands to profiles exactly once', async () => {
    const profiles = new Map<string, PlayerProfile>();
    const { frames } = await recorded(6, 31);
    const { done } = runTracker(frames.map((f) => f.obs));
    expect(applyHandToProfiles(profiles, done[0].hand, done[0].reveals).length).toBe(6);
    expect(applyHandToProfiles(profiles, done[0].hand, done[0].reveals).length).toBe(0);
    for (const p of profiles.values()) expect(p.hands).toBe(1);
  });
});

// ---- executor -----------------------------------------------------------------

function harness(h: HandState, heroSeat: number) {
  const holes = new Map<number, [CardId, CardId]>(h.seats.map((s, i) => [s.seat, [i * 4, i * 4 + 9] as [CardId, CardId]]));
  const tracker = new HandTracker();
  let ts = 0;
  const clicks: string[] = [];
  const world = { h, mutate: null as null | ((obs: TableObs) => void), applyOnClick: true, typedReadBack: null as number | null };
  const refresh = (): Fresh => {
    const obs = render(world.h, heroSeat, holes, (ts += 100));
    world.mutate?.(obs);
    tracker.ingest(obs);
    return { obs, state: tracker.state };
  };
  const driver: TableDriver = {
    async click(kind) { clicks.push(kind); if (world.applyOnClick) act(world.h, kind); return true; },
    async betOrRaise(to) {
      const rb = world.typedReadBack ?? to;
      if (Math.abs(rb - to) > 0.011) return { submitted: false, readBack: rb, detail: 'mismatch' };
      clicks.push(`raise:${to}`);
      if (world.applyOnClick) act(world.h, legalActions(world.h)!.raiseKind, to);
      return { submitted: true, readBack: rb, detail: 'ok' };
    },
  };
  const ex = new GuardedExecutor(driver, refresh, { sleep: async () => {}, verifyTimeoutMs: 5, pollMs: 1, now: (() => { let t = 0; return () => (t += 1); })() });
  ex.armed = true;
  const first = refresh();
  const req = (action: 'fold' | 'check' | 'call' | 'bet' | 'raise', to?: number) => ({ action, to, handId: first.state.hand!.handId, street: first.state.hand!.street, eventCount: first.state.eventCount });
  return { ex, clicks, world, req, refresh, tracker };
}

describe('guarded executor (edge cases 17, 18)', () => {
  it('executes exactly one legal action and verifies it', async () => {
    const { ex, clicks, req } = harness(mk(3), 0);
    const out = await ex.execute(req('raise', 60));
    expect(out.status).toBe('accepted');
    expect(clicks).toEqual(['raise:60']);
  });

  it('never repeats an action for the same decision point', async () => {
    const { ex, clicks, req, world } = harness(mk(3), 0);
    world.applyOnClick = false; // the table never reacts: outcome unknown
    const r = req('call');
    expect((await ex.execute(r)).status).toBe('unverified');
    expect((await ex.execute(r)).reason).toMatch(/already acted/);
    expect((await ex.execute({ ...r, action: 'fold' })).reason).toMatch(/already acted/);
    expect(clicks).toEqual(['call']);
  });

  it('rejects stale decisions, wrong turns and a disarmed executor without clicking', async () => {
    const a = harness(mk(3), 0);
    const stale = a.req('call');
    act(a.world.h, 'call'); // Hero acts some other way; state advances
    expect((await a.ex.execute(stale)).reason).toMatch(/stale|not Hero/);
    const b = harness(mk(3), 1); // Hero is the SB, BTN is to act
    expect((await b.ex.execute(b.req('call'))).reason).toMatch(/not Hero's turn/);
    const c = harness(mk(3), 0);
    c.ex.stop();
    expect((await c.ex.execute(c.req('call'))).reason).toMatch(/not armed/);
    const d = harness(mk(3), 0);
    expect((await d.ex.execute({ ...d.req('call'), handId: 'other' })).reason).toMatch(/hand changed/);
    expect((await d.ex.execute({ ...d.req('call'), street: 'flop' })).reason).toMatch(/street changed/);
    expect([...a.clicks, ...b.clicks, ...c.clicks, ...d.clicks]).toEqual([]);
  });

  it('rejects illegal actions and amounts outside the legal window', async () => {
    const { ex, clicks, req } = harness(mk(3), 0);
    expect((await ex.execute(req('check'))).reason).toMatch(/illegal action/);
    expect((await ex.execute(req('raise', 30))).reason).toMatch(/illegal action/);
    expect((await ex.execute(req('raise', 999999))).reason).toMatch(/illegal action/);
    expect((await ex.execute(req('bet', 60))).reason).toMatch(/illegal action/);
    expect(clicks).toEqual([]);
  });

  it('refuses when page controls disagree with the engine or are missing', async () => {
    const a = harness(mk(3), 0);
    a.world.mutate = (o) => { o.controls.raise = false; };
    expect((await a.ex.execute(a.req('raise', 60))).reason).toMatch(/no bet\/raise control/);
    const b = harness(mk(3), 0);
    b.world.mutate = (o) => { o.controls.call = 500; };
    expect((await b.ex.execute(b.req('call'))).status).toBe('rejected');
    expect([...a.clicks, ...b.clicks]).toEqual([]);
  });

  it('does not submit a bet when the typed amount reads back differently, and stays available for a fallback', async () => {
    const { ex, clicks, req, world } = harness(mk(3), 0);
    world.typedReadBack = 6000;
    const out = await ex.execute(req('raise', 60));
    expect(out.status).toBe('failed');
    expect(out.clicked).toBe(false);
    expect((await ex.execute(req('call'))).status).toBe('accepted');
    expect(clicks).toEqual(['call']);
  });

  it('refuses concurrent executions', async () => {
    const { ex, clicks, req } = harness(mk(3), 0);
    const [a, b] = await Promise.all([ex.execute(req('call')), ex.execute(req('call'))]);
    expect([a.status, b.status].sort()).toEqual(['accepted', 'rejected']);
    expect(clicks).toEqual(['call']);
  });
});

// ---- PokerNow DOM adapter against PokerNow-shaped markup ------------------------

describe('PokerNow DOM adapter (hand-written fixture markup; live selectors unverified)', () => {
  it('parses chip text', () => {
    expect(parseChips('1,250')).toBe(1250);
    expect(parseChips('12.50')).toBe(12.5);
    expect(parseChips('1.2k')).toBe(1200);
    expect(parseChips('$40')).toBe(40);
    for (const bad of ['', 'abc', '12abc', null, undefined, 'Call']) expect(parseChips(bad as string)).toBeNull();
  });

  it('reads the same observation back from rendered markup for every step of simulated hands', async () => {
    for (const n of [2, 6, 10]) {
      const { frames } = await recorded(n, 900 + n, 0, () => randomPolicy());
      for (const f of frames) {
        if (f.h.phase === 'complete') continue;
        const dom = new JSDOM(`<body>${toHtml(f.obs)}</body>`, { url: 'https://www.pokernow.club/games/pglTEST' });
        const obs = new PokerNowDom(dom.window.document).observe(f.obs.ts);
        expect(obs.problems).toEqual([]);
        expect(obs.tableId).toBe('pglTEST');
        expect(obs.board).toEqual(f.obs.board);
        expect(obs.heroCards).toEqual(f.obs.heroCards);
        expect(obs.dealerSeat).toBe(f.obs.dealerSeat);
        expect(obs.pot).toBe(f.obs.pot);
        expect([obs.smallBlind, obs.bigBlind]).toEqual([10, 20]);
        expect(obs.toActSeat).toBe(f.obs.toActSeat);
        expect(obs.heroToAct).toBe(f.obs.heroToAct);
        expect(obs.controls).toMatchObject(f.obs.controls); // plus the classified button list (controls.test.ts)
        expect(obs.seats.map((s) => [s.seat, s.name, s.stack, s.bet, s.folded, s.isHero, s.hasCards, s.shownCards]))
          .toEqual(f.obs.seats.map((s) => [s.seat, s.name, s.stack, s.bet, s.folded, s.isHero, s.hasCards, s.shownCards]));
      }
    }
  });

  it('end to end: markup -> observation -> tracker reproduces the hand', async () => {
    const { frames, res } = await recorded(6, 4242);
    const tracker = new HandTracker();
    const done: CompletedHand[] = [];
    for (const f of frames) {
      const dom = new JSDOM(`<body>${toHtml(f.obs)}</body>`, { url: 'https://www.pokernow.club/games/x' });
      const o = new PokerNowDom(dom.window.document).observe(f.obs.ts);
      // The fixture markup carries no player ids: restore them so identities match the ground truth.
      for (const s of o.seats) s.playerId = `p${s.seat}`;
      done.push(...tracker.ingest(o));
    }
    expect(done.length).toBe(1);
    expect(sig(done[0].hand)).toEqual(sig(res.h));
  });

  it('never invents cards and reports unreadable ones', () => {
    const html = toHtml(render(mk(3), 0, new Map([[0, [0, 5]], [1, [9, 14]], [2, [20, 25]]]), 1)).replace('<span class="suit">♥</span>', '<span class="suit">?</span>');
    const obs = new PokerNowDom(new JSDOM(`<body>${html}</body>`).window.document).observe(1);
    expect(obs.heroCards).toBeNull();
    expect(obs.problems.join(' ')).toMatch(/unreadable card/);
  });

  it('flags four hole cards as a non-Hold\'em table', () => {
    const o = render(mk(3), 0, new Map([[0, [0, 5]], [1, [9, 14]], [2, [20, 25]]]), 1);
    const obs = new PokerNowDom(new JSDOM(`<body>${toHtml(o, { gameType: 'PLO', heroCardCount: 4 })}</body>`).window.document).observe(1);
    expect(obs.gameType).toBe('PLO');
    expect(obs.problems.join(' ')).toMatch(/hero has 4 cards/);
    const t = new HandTracker();
    t.ingest(obs);
    expect(t.state.unsupported).toBe(true);
  });

  it('pre-action buttons are not a turn signal; missing markup yields an empty, harmless observation', () => {
    const o = render(mk(3), 1, new Map([[0, [0, 5]], [1, [9, 14]], [2, [20, 25]]]), 1);
    const obs = new PokerNowDom(new JSDOM(`<body>${toHtml(o)}</body>`).window.document).observe(1);
    expect(obs.heroToAct).toBe(false);
    expect(obs.controls.fold).toBe(false);
    const dom = new PokerNowDom(new JSDOM('<body><div id="something-else"></div></body>').window.document);
    const empty = dom.observe(1);
    expect(empty.seats).toEqual([]);
    expect(dom.health().seats).toBe(false);
    const t = new HandTracker();
    expect(t.ingest(empty)).toEqual([]);
    expect(t.state.hand).toBeNull();
  });

  it('driver clicks the right control and types a bet with read-back', async () => {
    const o = render(mk(3), 0, new Map([[0, [0, 5]], [1, [9, 14]], [2, [20, 25]]]), 1);
    const dom = new JSDOM(`<body>${toHtml(o)}</body>`);
    const doc = dom.window.document;
    const clicked: string[] = [];
    doc.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => clicked.push(b.className)));
    let submitted: string | null = null;
    const form = doc.querySelector('.raise-controller-form') as HTMLFormElement;
    form.querySelector('input[type=submit]')!.addEventListener('click', (e) => { e.preventDefault(); submitted = (form.querySelector('input.value') as HTMLInputElement).value; });
    doc.querySelector('button.raise')!.addEventListener('click', () => { form.style.display = 'block'; });
    const d = new PokerNowDom(doc, undefined, async () => {});
    expect(await d.click('call')).toBe(true);
    expect(clicked).toEqual(['button-1 call']);
    const r = await d.betOrRaise(60);
    expect(r).toMatchObject({ submitted: true, readBack: 60 });
    expect(submitted).toBe('60');
  });
});

// ---- PokerNow log -------------------------------------------------------------

const LOG = [
  '-- starting hand #7 (id: h7x)  (No Limit Texas Hold\'em) (dealer: "Ann @ a1") --',
  'Player stacks: #2 "Ann @ a1" (1000) | #5 "Bob @ b2" (1500) | #9 "Cy, Jr. @ c3" (300)',
  'Your hand is 10♥, A♠',
  '"Bob @ b2" posts a small blind of 10',
  '"Cy, Jr. @ c3" posts a big blind of 20',
  '"Ann @ a1" raises to 60',
  '"Bob @ b2" calls 60',
  '"Cy, Jr. @ c3" raises to 300 and go all in',
  '"Ann @ a1" calls 300',
  '"Bob @ b2" folds',
  'Flop:  [9♠, 4♦, 2♥]',
  'Turn: 9♠, 4♦, 2♥ [K♣]',
  'River: 9♠, 4♦, 2♥, K♣ [3♠]',
  '"Cy, Jr. @ c3" shows a 9♥, 9♦.',
  '"Ann @ a1" shows a 10♥, A♠.',
  '"Cy, Jr. @ c3" collected 660 from pot with Three of a Kind, 9\'s (combination: 9♥, 9♦, 9♠, K♣, 4♦)',
  '-- ending hand #7 --',
];

describe('PokerNow log parser and replay', () => {
  it('parses each line type', () => {
    expect(parseLogLine(LOG[0])).toMatchObject({ t: 'start', number: 7, handId: 'h7x', dealer: { name: 'Ann', id: 'a1' }, deadButton: false });
    expect(parseLogLine(LOG[1])).toMatchObject({ t: 'stacks', players: [{ seat: 2, stack: 1000 }, { seat: 5 }, { seat: 9, ref: { name: 'Cy, Jr.', id: 'c3' } }] });
    expect(parseLogLine(LOG[2])).toEqual({ t: 'hero', cards: parseCards('Th As') });
    expect(parseLogLine(LOG[7])).toMatchObject({ t: 'action', kind: 'raise', amount: 300, allIn: true });
    expect(parseLogLine(LOG[10])).toEqual({ t: 'board', street: 'flop', cards: parseCards('9s 4d 2h'), secondRun: false });
    expect(parseLogLine(LOG[11])).toEqual({ t: 'board', street: 'turn', cards: parseCards('Kc'), secondRun: false });
    expect(parseLogLine('Uncalled bet of 40 returned to "Bob @ b2"')).toMatchObject({ t: 'uncalled', amount: 40 });
    expect(parseLogLine('"Bob @ b2" posts a missing small blind of 10')).toMatchObject({ t: 'post', kind: 'other' });
    expect(parseLogLine('The player "Dee @ d4" joined the game with a stack of 500.')).toMatchObject({ t: 'table' });
    expect(parseLogLine('something entirely new').t).toBe('unknown');
    expect(parseLogLine('-- starting hand #8 (id: q)  (Pot Limit Omaha Hi) (dead button) --')).toMatchObject({ t: 'start', game: 'Pot Limit Omaha Hi', deadButton: true });
  });

  it('replays a hand with an all-in and a side pot through the rules engine', () => {
    const r = replayLog(LOG);
    expect(r.unknownLines).toEqual([]);
    expect(r.hands.length).toBe(1);
    const hd = r.hands[0];
    expect(hd.errors).toEqual([]);
    expect(hd.valid).toBe(true);
    expect(hd.heroCards).toEqual(parseCards('Th As'));
    const stack = (seat: number) => hd.hand.seats.find((s) => s.seat === seat)!.stack;
    expect(stack(9)).toBe(660);   // won 300*2 + Bob's dead 60
    expect(stack(2)).toBe(700);
    expect(stack(5)).toBe(1440);
    expect(hd.hand.seats.find((s) => s.seat === 9)!.pos!.label).toBe('BB');
  });

  it('skips non-Hold\'em hands and reports hands it cannot reproduce', () => {
    const plo = [LOG[0].replace("No Limit Texas Hold'em", 'Pot Limit Omaha Hi'), ...LOG.slice(1)];
    expect(replayLog(plo)).toMatchObject({ hands: [], unsupportedHands: 1 });
    const broken = LOG.filter((l) => !l.includes('calls 300')); // an action is missing
    const r = replayLog(broken);
    expect(r.hands[0].valid).toBe(false);
    expect(r.hands[0].errors.length).toBeGreaterThan(0);
  });

  it('reads the CSV export (newest first, quoted) into oldest-first lines', () => {
    const csv = 'entry,at,order\n' + [...LOG].reverse().map((l, i) => `"${l.replace(/"/g, '""')}",2026-01-01T00:00:00.000Z,${1000 - i}`).join('\n');
    const lines = parseLogCsv(csv);
    expect(lines).toEqual(LOG);
    expect(replayLog(lines).hands[0].valid).toBe(true);
  });
});
