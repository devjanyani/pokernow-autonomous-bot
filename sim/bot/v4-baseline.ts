// ============================================================
// Phase 3.0 (v4 audit) baseline measurements. MEASUREMENT ONLY: nothing here
// changes or tunes a strategy, and src/ never imports it.
//
//   npx tsx sim/bot/v4-baseline.ts coverage            preflop coverage matrix (which data source decides)
//   npx tsx sim/bot/v4-baseline.ts widths              range widths v2 plays per table size / position / stack
//   npx tsx sim/bot/v4-baseline.ts hero [--hands N]    Hero's own statistics (image) in short simulated sessions
//
// Output: markdown on stdout. Deterministic for a fixed seed.
// ============================================================

import { BotAgent } from '../../src/bot/agent';
import { CardId, parseCards } from '../../src/bot/cards';
import { CLASS_ORDER } from '../../src/bot/ranges/range';
import { applyAction, createHand, HandState, legalActions, seatOf } from '../../src/bot/table/engine';
import { applyHandToProfiles, classify, emptyProfile, PlayerProfile, posterior, styleLabel, StatKey } from '../../src/bot/opponents/profile';
import { computeFeatures } from '../../src/bot/ranges/postflop-model';
import { comboIndex } from '../../src/bot/cards';
import { playSession, Policy, HandResult } from '../../src/bot/sim/table';
import { archetypePolicy, botPolicy } from '../../src/bot/sim/policies';
import { INDEPENDENT_FACTORIES } from '../../src/bot/sim/independent';

const BB = 100;
const arg = (name: string, def: number) => { const i = process.argv.indexOf(name); return i > 0 ? Number(process.argv[i + 1]) : def; };

// ---------- building preflop spots ----------

type Scenario = 'rfi' | 'vs-limp' | 'vs-open' | 'squeeze' | 'vs-3bet' | 'vs-4bet' | 'cold-4bet' | 'vs-jam';

interface Spot { n: number; heroSeat: number; scenario: Scenario; stackBB: number; villainLabel?: string; h: HandState }

function newHand(n: number, stackBB: number, id: string): HandState {
  return createHand({
    handId: id, tableSeats: Math.max(n, 2), buttonSeat: 0, smallBlind: BB / 2, bigBlind: BB,
    seats: Array.from({ length: n }, (_, i) => ({ seat: i, playerId: `p${i}`, stack: stackBB * BB })),
  });
}

/** Seats in preflop order. */
const order = (h: HandState) => h.seats.filter((s) => s.dealtIn).slice().sort((a, b) => a.pos!.preflopOrder - b.pos!.preflopOrder);

/**
 * Play scripted actions until Hero is to act with the scenario in front of it. `plan(seat)` returns the action for a
 * non-Hero seat, Hero's own earlier actions come from `heroPlan`. Returns null when the scenario cannot arise.
 */
function drive(h: HandState, heroSeat: number, plan: (seat: number, h: HandState) => 'fold' | 'call' | 'raise' | 'jam', heroPlan: ('raise' | 'call')[], heroDecisionAt: number): HandState | null {
  let heroActs = 0;
  for (let guard = 0; guard < 60; guard++) {
    const seat = h.toAct;
    if (seat === null) return null;
    const la = legalActions(h, seat)!;
    if (seat === heroSeat) {
      if (heroActs === heroDecisionAt) return h;
      const a = heroPlan[heroActs++];
      if (!a) return null;
      if (a === 'raise') { if (!la.canRaise) return null; applyAction(h, { seat, kind: la.raiseKind, to: Math.min(la.maxRaiseTo, Math.max(la.minRaiseTo, h.currentBet <= BB ? 2.5 * BB : h.currentBet * 3)) }); }
      else applyAction(h, { seat, kind: la.canCheck ? 'check' : 'call' });
      continue;
    }
    const a = plan(seat, h);
    if (a === 'raise' || a === 'jam') {
      if (!la.canRaise) return null;
      const to = a === 'jam' ? la.maxRaiseTo : Math.min(la.maxRaiseTo, Math.max(la.minRaiseTo, h.currentBet <= BB ? 2.5 * BB : h.currentBet * (h.raisesThisStreet >= 2 ? 2.3 : 3)));
      applyAction(h, { seat, kind: la.raiseKind, to });
    } else if (a === 'call') applyAction(h, { seat, kind: la.canCheck ? 'check' : 'call' });
    else applyAction(h, { seat, kind: la.canCheck ? 'check' : 'fold' });
  }
  return null;
}

function buildSpots(n: number, stackBB: number): Spot[] {
  const out: Spot[] = [];
  const base = newHand(n, stackBB, 'x');
  const ord = order(base);
  const idx = (seat: number) => ord.findIndex((s) => s.seat === seat);
  const label = (seat: number) => seatOf(base, seat).pos!.label;
  for (const hero of ord) {
    const hi = idx(hero.seat);
    const mk = (scenario: Scenario, plan: Parameters<typeof drive>[2], heroPlan: ('raise' | 'call')[], at: number, villainLabel?: string) => {
      const h = drive(newHand(n, stackBB, `${n}-${hero.seat}-${scenario}-${villainLabel ?? ''}-${stackBB}`), hero.seat, plan, heroPlan, at);
      if (h && h.toAct === hero.seat) out.push({ n, heroSeat: hero.seat, scenario, stackBB, villainLabel, h });
    };
    // first in (the big blind has no RFI decision)
    if (!hero.pos!.isBigBlind) mk('rfi', () => 'fold', [], 0);
    // one limper before Hero: the first seat to act (if it is not Hero)
    if (hi > 0) mk('vs-limp', (s) => (idx(s) === 0 ? 'call' : 'fold'), [], 0, label(ord[0].seat));
    // facing an open from each earlier seat
    for (let o = 0; o < hi; o++) mk('vs-open', (s) => (idx(s) === o ? 'raise' : 'fold'), [], 0, label(ord[o].seat));
    // squeeze: the first seat opens, the next one calls
    if (hi >= 2) mk('squeeze', (s) => (idx(s) === 0 ? 'raise' : idx(s) === 1 ? 'call' : 'fold'), [], 0, label(ord[0].seat));
    // Hero opens and a later seat 3-bets (each later seat)
    if (!hero.pos!.isBigBlind) for (let t = hi + 1; t < ord.length; t++) {
      mk('vs-3bet', (s) => (idx(s) === t ? 'raise' : 'fold'), ['raise'], 1, label(ord[t].seat));
    }
    // An earlier seat opens, Hero 3-bets, the opener 4-bets
    if (hi > 0) {
      const o = Math.max(0, hi - 1);
      let raised = 0;
      mk('vs-4bet', (s) => { if (idx(s) === o) { raised++; return 'raise'; } return 'fold'; }, ['raise'], 1, label(ord[o].seat));
      void raised;
    }
    // cold 4-bet: seat 0 opens, seat 1 3-bets
    if (hi >= 2) mk('cold-4bet', (s) => (idx(s) <= 1 ? 'raise' : 'fold'), [], 0, label(ord[0].seat));
    // facing an all-in open from the first seat
    if (hi > 0) mk('vs-jam', (s) => (idx(s) === 0 ? 'jam' : 'fold'), [], 0, label(ord[0].seat));
  }
  return out;
}

/** One representative combo per class. */
const REP = new Map<string, [CardId, CardId]>(CLASS_ORDER.map((c) => {
  const r1 = c.name[0], r2 = c.name[1];
  const cards = c.name.length === 2 ? `${r1}s ${r2}h` : c.name.endsWith("s") ? `${r1}s ${r2}s` : `${r1}s ${r2}d`;
  return [c.name, parseCards(cards) as [CardId, CardId]];
}));

function sourceOf(basis: string[]): string {
  const b = basis.find((x) => /^(precomputed-chart|heuristic|computed|solver)/.test(x)) ?? basis.find((x) => !x.startsWith('spot:')) ?? '?';
  if (/push\/fold/.test(b)) return 'push/fold Nash';
  if (/^computed/.test(b)) return 'computed EV';
  if (/heads-up table/.test(b)) return 'HU chart';
  if (/^precomputed-chart/.test(b)) return /APPROXIMATION/.test(b) ? 'chart (approx.)' : 'chart';
  if (/^heuristic/.test(b)) return 'heuristic';
  return b.slice(0, 30);
}

function decideAll(sp: Spot, agent: BotAgent, classes = CLASS_ORDER.map((c) => c.name)) {
  let raise = 0, call = 0, total = 0;
  const sources = new Map<string, number>();
  let approx = '';
  for (const cls of classes) {
    const cards = REP.get(cls)!;
    // skip combos that collide with nothing (preflop: no board), all valid
    const d = agent.decideSync(sp.h, sp.heroSeat, cards, 50);
    const w = cls.length === 2 ? 6 : cls.endsWith('s') ? 4 : 12;
    const f = (a: (c: typeof d.candidates[number]) => boolean) => d.candidates.filter(a).reduce((s, c) => s + c.freq, 0);
    raise += w * f((c) => c.action === 'raise' || c.action === 'bet');
    call += w * f((c) => c.action === 'call');
    total += w;
    const src = sourceOf(d.basis);
    sources.set(src, (sources.get(src) ?? 0) + 1);
    const ap = d.basis.find((x) => /APPROXIMATION/.test(x));
    if (ap && !approx) approx = ap.replace(/^.*APPROXIMATION: /, '');
  }
  return { raise: raise / total, call: call / total, sources, approx };
}

// ---------- coverage ----------

async function coverage(): Promise<void> {
  const agent = new BotAgent({ engine: 'v2', seed: 1, exploitWeight: 0 });
  const stacks = [10, 15, 25, 40, 100, 200];
  console.log('# Preflop coverage matrix (version 2, measured)\n');
  console.log('Source that decides each spot, for one representative hand (the source does not depend on the hand except in all-in spots). "chart (approx.)" = a 6-max 60-150bb chart used outside its assumptions. Generated by `npx tsx sim/bot/v4-baseline.ts coverage`.\n');
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    console.log(`## ${n} players dealt in\n`);
    console.log(`| hero | scenario | vs | ${stacks.map((s) => `${s}bb`).join(' | ')} |`);
    console.log(`|---|---|---|${stacks.map(() => '---').join('|')}|`);
    const rows = new Map<string, string[]>();
    for (const st of stacks) {
      for (const sp of buildSpots(n, st)) {
        const key = `${seatOf(sp.h, sp.heroSeat).pos!.label}|${sp.scenario}|${sp.villainLabel ?? ''}`;
        const d = agent.decideSync(sp.h, sp.heroSeat, REP.get('JTs')!, 50);
        let src = sourceOf(d.basis);
        if (src === 'chart (approx.)') {
          const ap = d.basis.find((x) => /APPROXIMATION/.test(x)) ?? '';
          const tags = [/handed data/.test(ap) ? 'size' : '', /made for/.test(ap) ? 'stack' : '', /earlier than the earliest/.test(ap) ? 'seat' : ''].filter(Boolean).join('+');
          src = `chart~${tags}`;
        }
        const r = rows.get(key) ?? new Array(stacks.length).fill('—');
        r[stacks.indexOf(st)] = src;
        rows.set(key, r);
      }
    }
    for (const [k, r] of rows) { const [hero, sc, vs] = k.split('|'); console.log(`| ${hero} | ${sc} | ${vs || ''} | ${r.join(' | ')} |`); }
    console.log('');
  }
}

// ---------- widths ----------

async function widths(): Promise<void> {
  const agent = new BotAgent({ engine: 'v2', seed: 1, exploitWeight: 0 });
  console.log('# Range widths played by version 2 (measured, all 169 classes, combo-weighted)\n');
  console.log('Raise = raise + all-in frequency; call = flat call / complete. Mixed cells counted at their frequency.\n');
  for (const st of [100, 25]) {
    console.log(`## First-in raise (RFI) width, ${st}bb\n`);
    console.log('| players | ' + ['UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB'].join(' | ') + ' |');
    console.log('|---|' + new Array(9).fill('---').join('|') + '|');
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const cells = new Map<string, string>();
      for (const sp of buildSpots(n, st).filter((s) => s.scenario === 'rfi')) {
        const lab = seatOf(sp.h, sp.heroSeat).pos!.label;
        const r = decideAll(sp, agent);
        const prev = cells.get(lab);
        const txt = `${(100 * r.raise).toFixed(0)}%${r.call > 0.005 ? ` (+${(100 * r.call).toFixed(0)}% limp)` : ''}`;
        cells.set(lab, prev ? `${prev} / ${txt}` : txt);
      }
      // heads-up: the button is the small blind
      const lab = (l: string) => (n === 2 && l === 'SB' ? cells.get('BTN') ?? '—' : cells.get(l) ?? '—');
      console.log(`| ${n} | ${['UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB'].map(lab).join(' | ')} |`);
    }
    console.log('');
  }
  console.log('## Facing one open at 100bb: continue width (call / 3-bet)\n');
  console.log('| players | hero | opener | 3-bet | call | fold | source |');
  console.log('|---|---|---|---|---|---|---|');
  for (const n of [6, 9]) {
    for (const sp of buildSpots(n, 100).filter((s) => s.scenario === 'vs-open')) {
      const lab = seatOf(sp.h, sp.heroSeat).pos!.label;
      if (!['BTN', 'BB', 'SB', 'CO', 'HJ'].includes(lab)) continue;
      const r = decideAll(sp, agent);
      const src = [...r.sources.entries()].sort((a, b) => b[1] - a[1])[0][0];
      console.log(`| ${n} | ${lab} | ${sp.villainLabel} | ${(100 * r.raise).toFixed(1)}% | ${(100 * r.call).toFixed(1)}% | ${(100 * (1 - r.raise - r.call)).toFixed(1)}% | ${src}${r.approx ? `: ${r.approx.slice(0, 90)}` : ''} |`);
    }
  }
  console.log('');
  console.log('## Hero opened, facing a 3-bet at 100bb (6 and 9 players)\n');
  console.log('| players | hero | 3-bettor | 4-bet | call | fold | source |');
  console.log('|---|---|---|---|---|---|---|');
  for (const n of [6, 9]) {
    for (const sp of buildSpots(n, 100).filter((s) => s.scenario === 'vs-3bet')) {
      const lab = seatOf(sp.h, sp.heroSeat).pos!.label;
      if (!['UTG', 'CO', 'BTN', 'SB', 'LJ'].includes(lab) || !['BB', 'BTN', 'SB'].includes(sp.villainLabel ?? '')) continue;
      const r = decideAll(sp, agent);
      const src = [...r.sources.entries()].sort((a, b) => b[1] - a[1])[0][0];
      console.log(`| ${n} | ${lab} | ${sp.villainLabel} | ${(100 * r.raise).toFixed(1)}% | ${(100 * r.call).toFixed(1)}% | ${(100 * (1 - r.raise - r.call)).toFixed(1)}% | ${src} |`);
    }
  }
}

// ---------- hero image ----------

const HERO = 'hero';

interface HeroTally {
  rfi: Map<string, { n: number; d: number }>;
  steal: { n: number; d: number }; bbDefVsSteal: { n: number; d: number };
  river: { bets: number; bluffs: number; checkedToOrFirst: number; weakOpp: number; weakBet: number; facing: number; foldFacing: number; marginalFacing: number; marginalFold: number; calls: number; callsWon: number };
  turnBarrel: { n: number; d: number };
  showdown: { n: number; won: number };
  openSizeSum: number;
}

function newTally(): HeroTally {
  return {
    rfi: new Map(), steal: { n: 0, d: 0 }, bbDefVsSteal: { n: 0, d: 0 },
    river: { bets: 0, bluffs: 0, checkedToOrFirst: 0, weakOpp: 0, weakBet: 0, facing: 0, foldFacing: 0, marginalFacing: 0, marginalFold: 0, calls: 0, callsWon: 0 },
    turnBarrel: { n: 0, d: 0 }, showdown: { n: 0, won: 0 }, openSizeSum: 0,
  };
}

function tallyHand(t: HeroTally, r: HandResult): void {
  const h = r.h;
  const hero = h.seats.find((s) => s.playerId === HERO && s.dealtIn);
  if (!hero) return;
  const pos = hero.pos!;
  const pre = h.events.filter((e) => e.street === 'preflop' && !e.kind.startsWith('post'));
  // first-in opportunities by position
  let entered = false, firstRaiserSeat: number | null = null;
  for (const e of pre) {
    if (e.seat === hero.seat && !entered && e.kind !== 'check') {
      const c = t.rfi.get(pos.label) ?? { n: 0, d: 0 }; c.d++; if (e.kind === 'raise') c.n++; t.rfi.set(pos.label, c);
      if (pos.isButton || pos.label === 'CO' || (pos.isSmallBlind && !pos.isButton)) { t.steal.d++; if (e.kind === 'raise') t.steal.n++; }
      break;
    }
    if (e.kind === 'call' || e.kind === 'raise') { entered = true; if (e.kind === 'raise' && firstRaiserSeat === null) firstRaiserSeat = e.seat; }
    if (e.seat === hero.seat) break;
  }
  // big blind vs a single late-position open
  if (pos.isBigBlind) {
    const heroE = pre.find((e) => e.seat === hero.seat);
    // Only what happened BEFORE Hero's first action (a later 3-bet by Hero must not remove the opportunity).
    const raises = heroE ? pre.filter((e) => e.kind === 'raise' && e.seq < heroE.seq) : [];
    if (raises.length === 1 && heroE && pre.filter((e) => e.kind === 'call' && e.seq < heroE.seq).length === 0) {
      const op = seatOf(h, raises[0].seat).pos!;
      if (op.isButton || op.label === 'CO' || op.isSmallBlind) {
        t.bbDefVsSteal.d++; if (heroE.kind !== 'fold') t.bbDefVsSteal.n++;
        t.openSizeSum += raises[0].to / h.bigBlind;
      }
    }
  }
  const cards = r.holes.get(hero.seat)!;
  // turn barrel after betting the flop as the preflop raiser
  const flopBet = h.events.some((e) => e.street === 'flop' && e.seat === hero.seat && e.kind === 'bet');
  const turnFirst = h.events.find((e) => e.street === 'turn' && e.seat === hero.seat && e.facing <= 1e-9);
  if (flopBet && turnFirst) { t.turnBarrel.d++; if (turnFirst.kind === 'bet') t.turnBarrel.n++; }
  // river
  if (h.board.length === 5) {
    const f = computeFeatures(h.board);
    const hs = f.hs[comboIndex(cards[0], cards[1])];
    for (const e of h.events.filter((x) => x.street === 'river' && x.seat === hero.seat && !x.kind.startsWith('post'))) {
      if (e.facing <= 1e-9) {
        t.river.checkedToOrFirst++;
        if (hs < 0.35) { t.river.weakOpp++; if (e.kind === 'bet') t.river.weakBet++; }
        if (e.kind === 'bet') { t.river.bets++; if (hs < 0.5) t.river.bluffs++; }
      } else {
        t.river.facing++;
        if (e.kind === 'fold') t.river.foldFacing++;
        if (hs >= 0.45 && hs < 0.75) { t.river.marginalFacing++; if (e.kind === 'fold') t.river.marginalFold++; }
        if (e.kind === 'call') { t.river.calls++; if ((r.nets.get(hero.seat) ?? 0) > 0) t.river.callsWon++; }
        if (e.kind === 'raise') { t.river.bets++; if (hs < 0.5) t.river.bluffs++; }
      }
    }
  }
  if (h.wentToShowdown && !hero.folded) { t.showdown.n++; if ((r.nets.get(hero.seat) ?? 0) > 0) t.showdown.won++; }
}

const pc = (x: { n: number; d: number }) => (x.d ? `${(100 * x.n / x.d).toFixed(0)}% (${x.n}/${x.d})` : '—');

async function heroRun(label: string, players: { playerId: string; policy: Policy }[], hands: number, seed: number): Promise<string[]> {
  const profiles = new Map<string, PlayerProfile>();
  const tally = newTally();
  const res = await playSession({
    players, hands, seed, smallBlind: BB / 2, bigBlind: BB, startStack: 100 * BB, mode: 'cash',
    onHand: (r) => { applyHandToProfiles(profiles, r.h, r.reveals); tallyHand(tally, r); },
  });
  const p = profiles.get(HERO) ?? emptyProfile(HERO);
  const raw = (k: StatKey) => { const c = p.stats[k]; return c.d ? `${(100 * c.n / c.d).toFixed(0)}% (${c.n}/${c.d})` : '—'; };
  const t = res.totals.get(HERO)!;
  const mean = t.net / Math.max(1, t.hands) * 100;
  const out: string[] = [];
  out.push(`### ${label}: ${res.hands} hands, seed ${seed}`, '');
  out.push(`Opponents: ${players.filter((x) => x.playerId !== HERO).map((x) => x.policy.name).join(', ')}. Hero result ${mean >= 0 ? '+' : ''}${mean.toFixed(1)} bb/100 (one short session: not a strength measurement). Style label as the extension would show it: **${styleLabel(classify(p))}**.`, '');
  out.push('| statistic | Hero (raw, n/d) |', '|---|---|');
  for (const k of ['vpip', 'pfr', 'rfi', 'limp', 'threeBet', 'coldCall', 'foldTo3Bet', 'fourBet', 'cbetFlop', 'cbetTurn', 'foldToCbetFlop', 'checkRaise', 'aggFreq', 'aggVsCall', 'wtsd', 'wsd', 'foldVsBetFlop', 'foldVsBetTurn', 'foldVsBetRiver', 'betWhenCheckedToRiver', 'raiseVsBetFlop'] as StatKey[]) out.push(`| ${k} | ${raw(k)} |`);
  out.push(`| steal (CO/BTN/SB first in) | ${pc(tally.steal)} |`);
  out.push(`| BB defends vs a single CO/BTN/SB open | ${pc(tally.bbDefVsSteal)}${tally.bbDefVsSteal.d ? `, mean open size ${(tally.openSizeSum / tally.bbDefVsSteal.d).toFixed(1)}bb` : ''} |`);
  out.push(`| turn barrel after a flop bet | ${pc(tally.turnBarrel)} |`);
  const R = tally.river;
  out.push(`| river: bets/raises that are bluffs (made-hand percentile < 0.5) | ${pc({ n: R.bluffs, d: R.bets })} |`);
  out.push(`| river: weak hand (pct < 0.35) checked to / first: bet | ${pc({ n: R.weakBet, d: R.weakOpp })} |`);
  out.push(`| river: facing a bet: fold | ${pc({ n: R.foldFacing, d: R.facing })} |`);
  out.push(`| river: marginal hand (0.45-0.75) facing a bet: fold | ${pc({ n: R.marginalFold, d: R.marginalFacing })} |`);
  out.push(`| river calls that won the pot | ${pc({ n: R.callsWon, d: R.calls })} |`);
  out.push(`| showdowns won | ${pc({ n: tally.showdown.won, d: tally.showdown.n })} |`);
  out.push('', '| first-in raise by position | rate |', '|---|---|');
  for (const [k, v] of [...tally.rfi.entries()].sort()) out.push(`| ${k} | ${pc(v)} |`);
  out.push('');
  // population context: the opponents' VPIP / PFR
  out.push('Opponents in the same session (raw VPIP / PFR / aggFreq): ' + [...profiles.values()].filter((q) => q.playerId !== HERO).map((q) => `${q.playerId} ${raw2(q, 'vpip')}/${raw2(q, 'pfr')}/${raw2(q, 'aggFreq')}`).join('; '), '');
  void posterior;
  return out;
}
const raw2 = (q: PlayerProfile, k: StatKey) => (q.stats[k].d ? (100 * q.stats[k].n / q.stats[k].d).toFixed(0) : '—');

async function hero(): Promise<void> {
  const hands = arg('--hands', 600);
  const seed = arg('--seed', 31000);
  const samples = arg('--samples', 200);
  const eng = (process.argv.includes('--v3') ? 'v3' : 'v2') as 'v2' | 'v3';
  const bot = () => botPolicy({ engine: eng, seed: 7, samples, name: `bot-${eng}` });
  const ind = (k: string) => INDEPENDENT_FACTORIES[k]();
  console.log(`# Hero image baseline (version ${eng.slice(1)}, ${samples} samples per decision)\n`);
  console.log('Hero statistics computed by the same profile code the extension uses for opponents (opponents/profile.ts), plus river, steal and defence counts from sim/bot/v4-baseline.ts. Short sessions: rates carry wide sampling error.\n');
  const six = [
    { playerId: HERO, policy: bot() as Policy },
    { playerId: 'tag', policy: archetypePolicy('tight-aggressive') },
    { playerId: 'lp', policy: archetypePolicy('loose-passive') },
    { playerId: 'mdf', policy: ind('mdf-defender') },
    { playerId: 'raiser', policy: ind('raiser') },
    { playerId: 'nit', policy: ind('nit') },
  ];
  const huOnly = process.argv.includes('--hu-only');
  if (!huOnly) for (const l of await heroRun('Six players', six, hands, seed)) console.log(l);
  if (!process.argv.includes('--six-only')) {
    const nine = [
      ...six,
      { playerId: 'lag', policy: archetypePolicy('loose-aggressive') },
      { playerId: 'trapper', policy: ind('trapper') },
      { playerId: 'poc', policy: ind('pot-odds-caller') },
    ];
    if (!huOnly) for (const l of await heroRun('Nine players', nine, hands, seed + 1)) console.log(l);
    const hu = [{ playerId: HERO, policy: bot() as Policy }, { playerId: 'tag', policy: archetypePolicy('tight-aggressive') }];
    for (const l of await heroRun('Heads-up table', hu, hands, seed + 2)) console.log(l);
  }
}

const mode = process.argv[2];
(mode === 'coverage' ? coverage() : mode === 'widths' ? widths() : mode === 'hero' ? hero() : Promise.reject(new Error('mode: coverage | widths | hero'))).catch((e) => { console.error(e); process.exit(1); });
