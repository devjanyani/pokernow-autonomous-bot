// ============================================================
// Phase 3.1c: reproduce and value recorded preflop decisions. MEASUREMENT ONLY: src/ never imports it.
//
//   npx tsx sim/bot/preflop-consistency.ts [--fixture tests/bot/fixtures/live-2026-11-21-preflop.json]
//        [--spots h25:10,h5:13,h58:13] [--deals 300] [--runouts 4] [--seed 33500]
//        [--families model,pot-odds-caller,trapper,nit,value-punisher] [--widths 1,0.5] [--rake 0|1]
//        [--engine v2|v2-price] [--hero 7c2h] [--json out.json]
//
// --hero replaces Hero's recorded cards (control hands at the same recorded spot).
// For every spot (hand label : number of events before Hero's decision) it prints:
//   1. the reconstructed context: seats, positions, stacks, effective stack, blinds, ante, the preflop sequence,
//      pot, amount to call, who can still act behind Hero;
//   2. the engine's recommendation with its basis and candidate frequencies (the current engine, seed 7, the same
//      way sim/bot/replay-decisions.ts re-runs a recorded point);
//   3. the opponent ranges the engine itself built at that point, and Hero's showdown equity against them
//      (Monte Carlo, 20,000 samples) next to the pot-odds requirement;
//   4. a CONTINUATION valuation of every candidate (fold, call, raise, all-in) by sim/bot/reference.ts:
//        - the opponents' hole cards are drawn from the engine's OWN ranges for them (card removal respected), or
//          from the strongest `w` share of those ranges (--widths: 0.5 = ranges twice as strong as modelled);
//        - after the candidate the hand is played out: the opponents by one policy family, Hero by the engine;
//        - fold is 0 from the decision point; chips already in the pot are sunk; a call costs only the increment;
//          later betting is played, not assumed; rake, when on, is 5% capped at 3bb, no flop no drop;
//        - candidates share the same deals, run-outs and policy seeds (common random numbers), so the paired
//          difference call - fold has a much smaller error than the values themselves. Errors are over deals.
//
// Policy families: 'model' = every opponent plays the engine itself (version 2, its own cards only);
// the independent programs of src/bot/sim/independent.ts. None of them knows Hero's cards.
// What the numbers are NOT: the real opponents' strategies. They bracket the answer under stated assumptions.
// ============================================================

import * as fs from 'fs';
import { BotAgent } from '../../src/bot/agent';
import { CardId, cardsStr, COMBO_HI, COMBO_LO, NUM_COMBOS, Rng } from '../../src/bot/cards';
import { rebuildHand, RecordedHand, recordedHeroCards } from '../../src/bot/diag/rebuild';
import { multiwayEquity } from '../../src/bot/equity/equity';
import { CLASS_BY_NAME, COMBO_CLASS, Range, rangeFraction, toWeighted } from '../../src/bot/ranges/range';
import { INDEPENDENT_FACTORIES, PUNISHER_FACTORIES } from '../../src/bot/sim/independent';
import { botPolicy } from '../../src/bot/sim/policies';
import type { Policy } from '../../src/bot/sim/table';
import { effectiveStack, HandState, legalActions, potTotal, seatOf } from '../../src/bot/table/engine';
import type { VillainModel } from '../../src/bot/strategy/villains';
import type { Decision } from '../../src/bot/strategy/types';
import { Choice, pairedDiff, referenceValues } from './reference';

const argS = (f: string, d: string) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : d; };
const argN = (f: string, d: number) => Number(argS(f, String(d)));

export interface Spot { label: string; rec: RecordedHand; seq: number }

export function loadSpots(file: string, which: string[]): Spot[] {
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { hands: RecordedHand[] };
  return which.map((w) => {
    const [hl, seq] = w.split(':');
    const rec = data.hands.find((h) => h.handId.endsWith(`:${hl}`));
    if (!rec) throw new Error(`no hand ${hl} in ${file}`);
    return { label: w, rec, seq: Number(seq) };
  });
}

/** The engine's decision and its own opponent models at a reconstructed point. */
export function engineView(h: HandState, heroSeat: number, hero: [CardId, CardId], opts: ConstructorParameters<typeof BotAgent>[0] = {}, samples = 4000): { d: Decision; villains: VillainModel[] } {
  const agent = new BotAgent({ seed: 7, ...opts });
  const d = agent.decideSync(h, heroSeat, hero, samples);
  const prep = (agent as unknown as { prepare(h: HandState, s: number, c: [CardId, CardId]): { villains: VillainModel[] } }).prepare(h, heroSeat, hero);
  return { d, villains: prep.villains };
}

/** The strongest `w` share (by weight, in the preflop strength order) of a range; w = 1 returns the range. */
export function strongest(r: Range, w: number): Range {
  if (w >= 1) return r;
  const idx = Array.from({ length: NUM_COMBOS }, (_, k) => k).filter((k) => r[k] > 1e-9)
    .sort((a, b) => CLASS_BY_NAME.get(COMBO_CLASS[a])!.start - CLASS_BY_NAME.get(COMBO_CLASS[b])!.start);
  let tot = 0; for (const k of idx) tot += r[k];
  const out = new Float64Array(NUM_COMBOS);
  let acc = 0;
  for (const k of idx) { if (acc >= w * tot) break; const take = Math.min(r[k], w * tot - acc); out[k] = take; acc += take; }
  return out;
}

/** Joint draw of every live opponent's cards from its range, by rejection on card collisions. */
export function drawHoles(ranges: { seat: number; r: Range }[], dead: readonly CardId[], rng: Rng): Map<number, [CardId, CardId]> {
  const tables = ranges.map(({ seat, r }) => {
    const ks: number[] = [], cum: number[] = [];
    let acc = 0;
    for (let k = 0; k < NUM_COMBOS; k++) if (r[k] > 1e-9 && !dead.includes(COMBO_LO[k]) && !dead.includes(COMBO_HI[k])) { acc += r[k]; ks.push(k); cum.push(acc); }
    return { seat, ks, cum, tot: acc };
  });
  for (let tries = 0; tries < 10000; tries++) {
    const used = new Set<CardId>(dead);
    const out = new Map<number, [CardId, CardId]>();
    let ok = true;
    for (const t of tables) {
      if (!t.ks.length) throw new Error(`seat ${t.seat}: empty range after card removal`);
      const u = rng.next() * t.tot;
      let lo = 0, hi = t.cum.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (t.cum[m] < u) lo = m + 1; else hi = m; }
      const k = t.ks[lo];
      const a = COMBO_LO[k] as CardId, b = COMBO_HI[k] as CardId;
      if (used.has(a) || used.has(b)) { ok = false; break; }
      used.add(a); used.add(b); out.set(t.seat, [a, b]);
    }
    if (ok) return out;
  }
  throw new Error('could not draw non-colliding hole cards');
}

export interface Valuation { family: string; width: number; rake: boolean; deals: number; values: { label: string; mean: number; se: number; vsFold: { mean: number; se: number } }[] }

/**
 * Continuation value (chips, from the decision point; fold = 0) of each candidate, under one opponent policy family
 * and one range width. Common random numbers across candidates; standard errors over deals.
 */
export async function valueSpot(
  h: HandState, heroSeat: number, hero: [CardId, CardId], villains: VillainModel[], cands: { label: string; choice: Choice }[],
  o: { family: string; width: number; deals: number; runouts: number; seed: number; rake?: { pct: number; cap: number }; heroOpts?: ConstructorParameters<typeof BotAgent>[0]; samples?: number },
): Promise<Valuation> {
  const live = villains.filter((v) => !seatOf(h, v.seat).folded);
  const rng = new Rng(o.seed);
  const mk = (seat: number): Policy => o.family === 'model'
    ? botPolicy({ engine: 'v2', seed: o.seed + seat, samples: o.samples ?? 300, observe: false })
    : (INDEPENDENT_FACTORIES[o.family] ?? PUNISHER_FACTORIES[o.family])();
  const policies = new Map<number, Policy>(live.map((v) => [v.seat, mk(v.seat)]));
  const continuation = botPolicy({ engine: 'v2', seed: o.seed + 99, samples: o.samples ?? 300, observe: false, ...(o.heroOpts ?? {}) });
  const per = cands.map(() => [] as number[]);
  const ranges = live.map((v) => ({ seat: v.seat, r: strongest(v.range, o.width) }));
  for (let i = 0; i < o.deals; i++) {
    const holes = drawHoles(ranges, hero, rng);
    holes.set(heroSeat, hero);
    const vals = await referenceValues({ h, heroSeat, holes, policies, continuation }, cands.map((c) => c.choice), { seed: rng.int(1 << 30), flopRunouts: o.runouts, allowPreflop: true, rake: o.rake });
    vals.forEach((v, j) => per[j].push(v.mean));
  }
  const stat = (xs: number[]) => {
    const n = xs.length, m = xs.reduce((a, b) => a + b, 0) / n;
    return { mean: m, se: n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1) / n) : 0 };
  };
  const foldIdx = cands.findIndex((c) => c.choice.kind === 'fold');
  return {
    family: o.family, width: o.width, rake: !!o.rake, deals: o.deals,
    values: cands.map((c, j) => ({
      label: c.label, ...stat(per[j]),
      vsFold: foldIdx >= 0 ? pairedDiff({ samples: per[j] } as never, { samples: per[foldIdx] } as never) : stat(per[j]),
    })),
  };
}

/** Plain-text description of a reconstructed preflop point (no names: fixtures are anonymised). */
export function describe(h: HandState, heroSeat: number, hero: [CardId, CardId]): string[] {
  const la = legalActions(h, heroSeat)!;
  const pot = potTotal(h);
  const out: string[] = [];
  const dealt = h.seats.filter((s) => s.dealtIn);
  out.push(`Hero ${cardsStr(hero)} at ${seatOf(h, heroSeat).pos!.label}, ${dealt.length} dealt in, blinds ${h.smallBlind}/${h.bigBlind}, ante ${h.ante}`);
  out.push(`seats: ${dealt.map((s) => `${s.seat}:${s.pos!.label} ${s.stack + s.totalCommit}${s.folded ? ' (folded)' : ''}${s.seat === heroSeat ? ' HERO' : ''}`).join(', ')}`);
  out.push(`sequence: ${h.events.filter((e) => e.street === 'preflop').map((e) => `${seatOf(h, e.seat).pos!.label} ${e.kind}${e.kind === 'raise' || e.kind === 'call' || e.kind.startsWith('post') ? ` ${e.to}` : ''}`).join(', ')}`);
  const eff = effectiveStack(h, heroSeat);
  const me = seatOf(h, heroSeat);
  const behind = (eff - me.streetCommit - la.callAmount) / (pot + la.callAmount);
  out.push(`pot ${pot}, to call ${la.callAmount} (needs ${(100 * la.callAmount / (pot + la.callAmount)).toFixed(1)}% equity at showdown), Hero has ${me.streetCommit} in already (sunk), effective stack ${eff} (${(eff / h.bigBlind).toFixed(1)}bb), stack-to-pot ratio after a call ${behind.toFixed(2)}`);
  return out;
}

async function main() {
  const spots = loadSpots(argS('fixture', 'tests/bot/fixtures/live-2026-11-21-preflop.json'), argS('spots', 'h25:10,h5:13,h58:13').split(','));
  const families = argS('families', 'model,pot-odds-caller,trapper,nit').split(',');
  const widths = argS('widths', '1,0.5').split(',').map(Number);
  const deals = argN('deals', 300), runouts = argN('runouts', 4), seed = argN('seed', 33500);
  const rake = argN('rake', 0) ? { pct: 0.05, cap: 6 } : undefined;
  const engine = argS('engine', 'v2');
  const heroOpts = engine === 'v2-price' ? { preflopCorrections: { priceAware: true } } as ConstructorParameters<typeof BotAgent>[0] : {};
  const json: unknown[] = [];
  for (const sp of spots) {
    const h = rebuildHand(sp.rec, sp.seq);
    const heroArg = argS('hero', '');
    const rec = heroArg ? { ...sp.rec, heroCards: [heroArg.slice(0, 2), heroArg.slice(2, 4)] } : sp.rec;
    const heroSeat = rec.heroSeat!, hero = recordedHeroCards(rec)!;
    if (h.toAct !== heroSeat) throw new Error(`${sp.label}: Hero is not to act`);
    console.log(`\n=== ${sp.label} ===`);
    for (const l of describe(h, heroSeat, hero)) console.log(`  ${l}`);
    const { d, villains } = engineView(h, heroSeat, hero, heroOpts);
    console.log(`  engine (${engine}): ${d.label}  [${d.candidates.map((c) => `${c.label} f${(100 * c.freq).toFixed(0)}%`).join(' | ')}]  source ${d.preflop?.source} / ${d.preflop?.situation}`);
    for (const b of d.basis) console.log(`     ${b}`);
    const live = villains.filter((v) => !seatOf(h, v.seat).folded);
    for (const v of live) console.log(`  villain ${v.seat} ${seatOf(h, v.seat).pos!.label}: ${v.line}, ${(100 * rangeFraction(v.range)).toFixed(1)}% (${v.rangeBasis}: ${v.rangeSource})${v.actsBehind ? ', still to act' : ''}`);
    for (const w of widths) {
      const e = multiwayEquity(hero, [], live.map((v) => toWeighted(strongest(v.range, w), hero).range), 20000, 3);
      console.log(`  equity vs the engine's ranges${w < 1 ? ` (strongest ${100 * w}%)` : ''}: ${(100 * e.equity).toFixed(1)}% ± ${(196 * e.stdErr).toFixed(1)}`);
    }
    const la = legalActions(h, heroSeat)!;
    const cands = d.candidates.filter((c) => c.action !== 'check').map((c) => ({ label: c.label, choice: { kind: c.action, to: c.to } as Choice }));
    const rows: Valuation[] = [];
    for (const fam of families) for (const w of widths) {
      const t0 = Date.now();
      const v = await valueSpot(h, heroSeat, hero, villains, cands, { family: fam, width: w, deals, runouts, seed, rake, heroOpts });
      rows.push(v);
      console.log(`  [${fam}, width ${w}${rake ? ', rake' : ''}, ${deals}x${runouts}] ${v.values.map((x) => `${x.label}: ${(x.mean / h.bigBlind).toFixed(2)}bb (vs fold ${(x.vsFold.mean / h.bigBlind).toFixed(2)} ± ${(1.96 * x.vsFold.se / h.bigBlind).toFixed(2)})`).join(' | ')}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    json.push({ spot: sp.label, toCall: la.callAmount, pot: potTotal(h), decision: { label: d.label, candidates: d.candidates.map((c) => ({ label: c.label, freq: c.freq })) }, rows });
  }
  const out = argS('json', '');
  if (out) fs.writeFileSync(out, JSON.stringify(json, null, 1));
}

if (process.argv[1] && /preflop-consistency\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
