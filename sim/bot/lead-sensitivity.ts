// ============================================================
// Why does the engine lead a weak pair out of position, and how fragile is that?
//
//   npx tsx sim/bot/lead-sensitivity.ts [--scenario oop-caller-bottom-pair-dry] [--samples 6000]
//
// 1. Reconstructs what the behaviour model says the opponent does: fold / call / raise against each lead
//    size, and how often it bets when checked to.
// 2. Splits the value of each line into its parts (all the plans the engine compares internally).
// 3. Sensitivity: re-values the spot while the opponent's modelled tendencies move over a wide range, and
//    solves for the fold and raise frequencies at which the lead stops beating a check.
//
// Nothing here is solver output. The frequencies are the engine's own HEURISTIC model, varied.
// ============================================================

import { comboIndex } from '../../src/bot/cards';
import { NEUTRAL, Tendencies } from '../../src/bot/ranges/postflop-model';
import { betProb2, mixRanges, responseProbs2, strengthTable } from '../../src/bot/ranges/range-model';
import { HERO_ROLLOUT, PostflopSolver, ROBUST_STICKINESS, setRobustStickiness } from '../../src/bot/strategy/postflop';
import { buildTable, FeatureCache } from '../../src/bot/strategy/villains';
import { potTotal } from '../../src/bot/table/engine';
import { multiwayEquity } from '../../src/bot/equity/equity';
import { toWeighted } from '../../src/bot/ranges/range';
import { buildSpot, SCENARIOS } from './scenarios';

const argS = (f: string, d: string) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : d; };
const id = argS('scenario', 'oop-caller-bottom-pair-dry');
const SAMPLES = Number(argS('samples', '6000'));
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const bbs = (x: number) => `${x >= 0 ? '+' : ''}${(x / 20).toFixed(2)}`;

const scn = SCENARIOS.find((s) => s.id === id);
if (!scn) throw new Error(`unknown scenario ${id}`);
const built = buildSpot(scn.spot);
const { h, heroSeat, heroCards } = built;
const cache = new FeatureCache();
const pot = potTotal(h);

interface Solved {
  check: number; checkPlans: { foldModel: number; foldGiveUp: number; callModel: number; callGiveUp: number }; betBehind: number;
  bets: { label: string; frac: number; ev: number; evModel: number; evPess: number; foldAll: number; called: number; raised: number; eqCalled: number | null; plan: string | null }[];
  equity: number;
}

function solve(tend: Tendencies, seed = 99): Solved {
  const t = buildTable(h, heroSeat, heroCards, built.profiles, 1, cache);
  const villains = t.villains.map((v) => ({ ...v, tend }));
  const s = new PostflopSolver(h, heroSeat, heroCards, villains, cache.get(h.board), seed, t.heroPerceived);
  s.run(SAMPLES);
  const r = s.result();
  // Internal plan columns of the check (read-only peek; the engine reports only the best of them).
  const priv = s as unknown as { sum: Float64Array; colOf: number[][]; count: number };
  const ci = r.candidates.findIndex((c) => c.action === 'check');
  const cols = priv.colOf[ci], n = priv.count;
  const hero = h.seats.find((x) => x.seat === heroSeat)!;
  return {
    check: r.candidates[ci].ev!, betBehind: r.lines[ci].betBehind, equity: r.equity.equity,
    checkPlans: { foldModel: priv.sum[cols[0]] / n, foldGiveUp: priv.sum[cols[1]] / n, callModel: priv.sum[cols[2]] / n, callGiveUp: priv.sum[cols[3]] / n },
    bets: r.candidates.map((c, i) => ({ c, i })).filter((x) => x.c.action === 'bet').map(({ c, i }) => ({
      label: c.label, frac: (c.to! - hero.streetCommit) / pot, ev: c.ev!, evModel: c.evModel!, evPess: c.evPessimistic!,
      foldAll: r.lines[i].foldAll, called: r.lines[i].called, raised: r.lines[i].raised, eqCalled: r.lines[i].equityWhenCalled, plan: r.lines[i].plan,
    })),
  };
}

function main(): void {
  console.log(`# Lead sensitivity: ${scn!.id}`);
  console.log(`${scn!.title}. Pot ${pot} chips (${(pot / 20).toFixed(1)}bb), ${SAMPLES} deals per valuation. EVs in big blinds relative to folding.\n`);

  // ---- 1. the model's own frequencies, straight from the behaviour functions over the opponent's range ----
  const t = buildTable(h, heroSeat, heroCards, built.profiles, 1, cache);
  const v = t.villains[0];
  const f = cache.get(h.board);
  const S = strengthTable(v.range, mixRanges([t.heroPerceived]), f);
  let tot = 0;
  for (let k = 0; k < 1326; k++) if (S[k] >= 0) tot += v.range[k];
  const avg = (fn: (s: number) => number) => { let a = 0; for (let k = 0; k < 1326; k++) if (S[k] >= 0 && v.range[k] > 0) a += v.range[k] * fn(S[k]); return a / tot; };
  console.log(`## 1. Modelled behaviour of ${v.name} (range: ${v.summary}; source: ${v.rangeSource})`);
  console.log(`Hero's hand: raw showdown equity against that range ${pct(solve(NEUTRAL).equity)}.`);
  console.log(`| Hero's action | ${v.name} folds | calls | raises |`);
  console.log(`|---|---|---|---|`);
  for (const x of [0.33, 0.66, 1.0]) {
    const ctx = { street: h.street, betFrac: x, opponents: 1, isRaise: false, tend: NEUTRAL };
    console.log(`| lead ${pct(x)} of the pot | ${pct(avg((s) => responseProbs2(s, ctx).fold))} | ${pct(avg((s) => responseProbs2(s, ctx).call))} | ${pct(avg((s) => responseProbs2(s, ctx).raise))} |`);
  }
  const bet = avg((s) => betProb2(s, { street: h.street, betFrac: 0.5, opponents: 1, isRaise: false, tend: NEUTRAL, role: 'aggressor' }));
  console.log(`\nAfter a check: ${v.name} bets half the pot ${pct(bet)} of the time and checks back ${pct(1 - bet)} (the only bet size the simulation gives opponents).`);
  // Hero's raw showdown equity against the part of the range that takes each action (no further betting).
  const eqVs = (w: (s: number) => number): number => {
    const r = new Float64Array(1326);
    for (let k = 0; k < 1326; k++) if (S[k] >= 0) r[k] = v.range[k] * w(S[k]);
    return multiwayEquity(heroCards, h.board, [toWeighted(r, [...heroCards, ...h.board]).range], 20000, 5).equity;
  };
  const cAgg = { street: h.street, betFrac: 0.5, opponents: 1, isRaise: false, tend: NEUTRAL, role: 'aggressor' as const };
  const cLead = { street: h.street, betFrac: 0.33, opponents: 1, isRaise: false, tend: NEUTRAL };
  const eBet = eqVs((x) => betProb2(x, cAgg)), eBack = eqVs((x) => 1 - betProb2(x, cAgg)), eCall = eqVs((x) => responseProbs2(x, cLead).call), eRaise = eqVs((x) => responseProbs2(x, cLead).raise);
  console.log(`Hero's raw showdown equity against the hands that: bet when checked to ${pct(eBet)}; check back ${pct(eBack)}; call a small lead ${pct(eCall)}; raise a small lead ${pct(eRaise)}.`);
  console.log(`With no further betting, calling a half-pot bet would be worth ${bbs(eBet * 2 * pot - 0.5 * pot)}bb, and a small lead that is called ${bbs(eCall * (pot + 2 * 0.33 * pot) - 0.33 * pot)}bb.`);

  // ---- 2. the parts of each line ----
  const base = solve(NEUTRAL);
  const lead = base.bets[0];
  console.log(`\n## 2. Value of each line (big blinds)`);
  console.log(`| Line | EV |`);
  console.log(`|---|---|`);
  console.log(`| check, fold to a bet (then the model's play on the turn when it is checked back) | ${bbs(base.checkPlans.foldModel)} |`);
  console.log(`| check, fold to a bet (and give up to any turn bet) | ${bbs(base.checkPlans.foldGiveUp)} |`);
  console.log(`| check, call a bet (then the model's play on the turn) | ${bbs(base.checkPlans.callModel)} |`);
  console.log(`| check, call a bet (then give up to any turn bet) | ${bbs(base.checkPlans.callGiveUp)} |`);
  for (const b of base.bets) console.log(`| ${b.label}: modelled responses | ${bbs(b.evModel)} |\n| ${b.label}: opponent folds less (the figure used) | ${bbs(b.evPess)} |`);
  console.log(`\nSmall lead (${pct(lead.frac)} pot): all fold ${pct(lead.foldAll)}, called ${pct(lead.called)}, raised ${pct(lead.raised)}; Hero wins ${lead.eqCalled === null ? '-' : pct(lead.eqCalled)} at showdown against the hands that call; plan when raised: ${lead.plan}.`);
  console.log(`After a check an opponent bets in ${pct(base.betBehind)} of deals.`);
  // One-street arithmetic for the lead: EV = fold x pot + raised x (-bet) + called x V. Solve V from the simulated EV.
  const b0 = lead.frac * pot;
  const vCalled = (lead.evModel - lead.foldAll * pot + lead.raised * b0) / Math.max(1e-9, lead.called);
  console.log(`Arithmetic: ${pct(lead.foldAll)} x pot (${bbs(lead.foldAll * pot)}) + ${pct(lead.raised)} x lose the bet (${bbs(-lead.raised * b0)}) + ${pct(lead.called)} x value when called (${bbs(vCalled)} each) = ${bbs(lead.evModel)}.`);
  const need = (target: number, raised: number) => (target + raised * b0 - (1 - raised) * vCalled) / (pot - vCalled);
  console.log(`Holding the value-when-called and the raise frequency fixed, the lead beats the check (${bbs(base.check)}) only if the opponent folds more than ${pct(need(base.check, lead.raised))} of the time (modelled: ${pct(lead.foldAll)}).`);
  for (const r of [0.1, 0.2, 0.3]) console.log(`  with a raise frequency of ${pct(r)}: needs folds above ${pct(need(base.check, r))}`);

  // ---- 3. sensitivity over the opponent's tendencies ----
  console.log(`\n## 3. Sensitivity: opponent tendencies varied (stickiness moves how often it folds, aggression how often it bluffs)`);
  console.log(`| stickiness | aggression | folds to the lead | raises the lead | bets when checked to | EV check | EV lead (modelled) | EV lead (used) | engine's choice |`);
  console.log(`|---|---|---|---|---|---|---|---|---|`);
  for (const st of [-0.8, -0.4, 0, 0.4, 0.8]) for (const ag of [-0.8, 0, 0.8]) {
    const r = solve({ ...NEUTRAL, stickiness: st, aggression: ag });
    const l = r.bets[0];
    const best = Math.max(...r.bets.map((b) => b.ev));
    console.log(`| ${st} | ${ag} | ${pct(l.foldAll)} | ${pct(l.raised)} | ${pct(r.betBehind)} | ${bbs(r.check)} | ${bbs(l.evModel)} | ${bbs(l.ev)} | ${best > r.check ? r.bets.find((b) => b.ev === best)!.label : 'check'} |`);
  }

  // ---- 4. structural assumptions of the look-ahead ----
  console.log(`\n## 4. Structural assumptions switched one at a time (neutral opponent)`);
  console.log(`| Assumption changed | EV check | EV small lead (used) | choice |`);
  console.log(`|---|---|---|---|`);
  const row = (name: string, r: Solved) => console.log(`| ${name} | ${bbs(r.check)} | ${bbs(r.bets[0].ev)} | ${Math.max(...r.bets.map((b) => b.ev)) > r.check ? 'lead' : 'check'} |`);
  row('none (current engine)', base);
  const R0 = ROBUST_STICKINESS, H0 = HERO_ROLLOUT.aggression;
  setRobustStickiness(0); row('no pessimistic scenario', solve(NEUTRAL)); setRobustStickiness(0.8); row('pessimistic scenario twice as strong (opponent folds about 20 points less)', solve(NEUTRAL)); setRobustStickiness(R0);
  HERO_ROLLOUT.aggression = 0; row("Hero's simulated turn play bluffs like everyone else's", solve(NEUTRAL)); HERO_ROLLOUT.aggression = H0;

  // ---- 5. what the simulated turn does after each flop line (read-only instrumentation of the engine) ----
  // settle(agg) plays the turn. It is wrapped here to count what happened; nothing in the engine is changed.
  type Priv = { invest: number[]; rank: number[]; total0: number[]; settle: (agg: number) => number };
  type Cell = { n: number; v: number };
  type Row = { n: number; v: number; potIn: number; heroIn: number; vBetHFold: Cell; hBetVFold: Cell; betCalled: Cell; through: Cell };
  const proto = PostflopSolver.prototype as unknown as Priv;
  const orig = proto.settle;
  const acc = new Map<string, Row>();
  proto.settle = function (this: Priv, agg: number): number {
    const heroIn = this.invest[0] - this.total0[0];
    const before = this.invest.slice();
    const potBefore = before.reduce((x, y) => x + y, 0);
    const val = orig.call(this, agg);
    const key = `${agg}:${Math.round(heroIn)}`;
    let a = acc.get(key);
    if (!a) { const c = (): Cell => ({ n: 0, v: 0 }); a = { n: 0, v: 0, potIn: potBefore, heroIn, vBetHFold: c(), hBetVFold: c(), betCalled: c(), through: c() }; acc.set(key, a); }
    a.n++; a.v += val;
    const dH = this.invest[0] - before[0], dV = this.invest[1] - before[1];
    const cell = dV > 0 && dH === 0 ? a.vBetHFold : dH > 0 && dV === 0 ? a.hBetVFold : dH > 0 && dV > 0 ? a.betCalled : a.through;
    cell.n++; cell.v += val;
    return val;
  };
  solve(NEUTRAL, 7);
  proto.settle = orig;
  const small = Math.round(base.bets[0].frac * pot), half = Math.round(0.5 * pot);
  const lines: [string, string][] = [[`-1:0`, 'flop checked through'], [`1:${half}`, 'Hero check-calls a half-pot bet'], [`0:${small}`, 'Hero leads small and is called']];
  console.log(`\n## 5. The simulated turn after each flop line`);
  console.log(`Values in big blinds, counted from the flop decision (what Hero put in on the flop is already subtracted). Each cell: share of deals, and the average value of the line in those deals.`);
  console.log(`| Flop line | Pot going to the turn | Hero put in on the flop | Value of the line | Opponent bets the turn, Hero folds | Hero bets the turn, opponent folds | A turn bet is called | Turn checked through |`);
  console.log(`|---|---|---|---|---|---|---|---|`);
  const cellStr = (c: Cell, n: number) => (c.n ? `${pct(c.n / n)} at ${bbs(c.v / c.n)}` : '0%');
  for (const [k, name] of lines) { const a = acc.get(k); if (a) console.log(`| ${name} | ${(a.potIn / 20).toFixed(1)}bb | ${(a.heroIn / 20).toFixed(2)}bb | ${bbs(a.v / a.n)} | ${cellStr(a.vBetHFold, a.n)} | ${cellStr(a.hBetVFold, a.n)} | ${cellStr(a.betCalled, a.n)} | ${cellStr(a.through, a.n)} |`); }
  // How often would the opponent have to take the pot away on the turn, after calling the lead, for the lead to be no better than a check?
  const L = acc.get(`0:${small}`), CC = acc.get(`1:${half}`);
  if (L && CC) {
    const q0 = L.vBetHFold.n / L.n;
    const rest = (L.v - L.vBetHFold.v) / Math.max(1, L.n - L.vBetHFold.n);           // average value when that does not happen
    const lose = L.vBetHFold.n ? L.vBetHFold.v / L.vBetHFold.n : -lead.frac * pot;
    const vNeed = (base.check - lead.foldAll * pot + lead.raised * b0) / Math.max(1e-9, lead.called);
    const q = (rest - vNeed) / (rest - lose);
    const barrel = (CC.vBetHFold.n + CC.betCalled.n) / CC.n;
    console.log(`\nAfter calling the lead the opponent bets the turn and takes the pot in ${pct(q0)} of deals. After betting the flop itself and being called, the same model has it bet the turn in about ${pct(barrel)} of deals.`);
    console.log(`Holding everything else fixed, the lead stops beating the check once the opponent takes the pot on the turn in more than ${pct(q)} of the deals in which it called the lead.`);
  }
  void comboIndex;
}

main();
