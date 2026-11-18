// ============================================================
// Phase 2.4 diagnostic: is version 3's predicted fold equity right?
//
//   npx tsx sim/bot/v3-raise-diag.ts --table hu-ra [--hands 2000] [--seed 12300] [--model3 '{...}'] [--json out.jsonl]
//
// Version 3 plays one heads-up session against a benchmark opponent. Every time it bets or raises after the flop,
// the model's predicted response probabilities are recorded for the opponent's ACTUAL holding (known in the
// simulator) and for the whole modelled range, together with what the opponent then actually did. Over many
// decisions the actual fold rate estimates the mean of the true fold probability over the true range, so:
//   mean predicted (actual holding) vs actual   -> is the response model right, given the holding?
//   mean predicted (modelled range) vs actual   -> response model and range estimate together
// Also recorded: the candidate values (fold / call / each raise) and the decomposition of the chosen bet.
// Development tool; seeds 12100 and 12300 are development seeds.
// ============================================================

import * as fs from 'fs';
import { BotAgent } from '../../src/bot/agent';
import { comboIndex } from '../../src/bot/cards';
import { playSession, Policy } from '../../src/bot/sim/table';
import { MODEL3 } from '../../src/bot/strategy/v3/model';
import { mixRanges, responseProbs2, strengthTable } from '../../src/bot/ranges/range-model';
import { NEUTRAL } from '../../src/bot/ranges/postflop-model';
import { potTotal } from '../../src/bot/table/engine';
import { buildTable, FeatureCache } from '../../src/bot/strategy/villains';
import { PostflopSearchV3 } from '../../src/bot/strategy/v3/search';
import { BENCH_TABLES } from './phase23-bench';
import { makePolicy } from './run';

const argS = (f: string, d: string) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : d; };
const argN = (f: string, d: number) => Number(argS(f, String(d)));

export interface Rec {
  table: string; hand: string; street: string; kind: 'bet' | 'raise' | 'check-raise' | 'reraise'; betFrac: number; spr: number;
  heroHs: number; acts: string[]; predCombo: number[]; predRange: number[]; comboWeight: number; strength: number;
  actual: string; sTrue: number; predTrueS: number[]; trueFold: number; evs: Record<string, number>; chosen: string; decomposition: { fromFolds: number; fromCalls: number; fromRaises: number } | null;
  evidence: string[]; mixture: number;
}

export async function diagnose(table: string, hands: number, seed: number, samples = 400): Promise<Rec[]> {
  const field = BENCH_TABLES[table];
  if (!field || field.length !== 1) throw new Error(`heads-up table expected: ${table}`);
  const recs: Rec[] = [];
  let pending: null | { search: PostflopSearchV3; a: number; base: Omit<Rec, 'acts' | 'predCombo' | 'predRange' | 'comboWeight' | 'strength' | 'actual' | 'sTrue' | 'predTrueS' | 'trueFold'>; handId: string; events: number } = null;
  type Cur = { search: PostflopSearchV3; a: number; det: Rec['decomposition']; evs: Record<string, number>; label: string; mixture: number };
  let cur = null as Cur | null;
  const agent = new BotAgent({
    seed, engine: 'v3', v3Sensitivity: false,
    onV3Search: (search, d) => {
      pending = null;
      if (d.action !== 'bet' && d.action !== 'raise') return;
      const a = search.specs.findIndex((s) => s.action === d.action && Math.abs(s.to - (d.to ?? 0)) < 1e-9);
      if (a < 0) return;
      const res = search.result(2.5, false);
      const evs: Record<string, number> = {};
      res.candidates.forEach((c) => { evs[c.label] = c.ev ?? NaN; });
      const det = res.v3.decomposition[a];
      cur = { search, a, det, evs, label: search.specs[a].label, mixture: res.v3.mixture[0]?.weight ?? 1 };
    },
  });
  const hero: Policy = {
    name: 'v3',
    observe: (h, rv) => agent.observeHand(h, rv),
    act(view) {
      cur = null;
      const d = agent.decideSync(view.h, view.seat, view.hole, samples);
      if (cur && view.h.street !== 'preflop') {
        const h = view.h;
        const evs = h.events.filter((e) => e.street === h.street && !e.kind.startsWith('post'));
        const checked = evs.some((e) => e.seat === view.seat && e.kind === 'check');
        const facing = view.la.callAmount > 1e-9;
        const kind: Rec['kind'] = !facing ? 'bet' : h.raisesThisStreet >= 2 ? 'reraise' : checked ? 'check-raise' : 'raise';
        const pot = h.seats.reduce((t, s) => t + s.totalCommit, 0);
        const me = h.seats.find((s) => s.seat === view.seat)!;
        const c = cur as Cur;
        const to = d.to ?? 0;
        pending = {
          search: c.search, a: c.a, handId: h.handId, events: h.events.length,
          base: {
            table, hand: h.handId, street: h.street, kind, betFrac: (to - h.currentBet) / Math.max(1e-9, pot + view.la.callAmount), spr: me.stack / Math.max(1e-9, pot),
            heroHs: NaN, evs: c.evs, chosen: c.label, decomposition: c.det ? { fromFolds: c.det.fromFolds, fromCalls: c.det.fromCalls, fromRaises: c.det.fromRaises } : null,
            evidence: d.adjustments.filter((x) => x.startsWith('learned (version 3)')), mixture: c.mixture,
          },
        };
      }
      return { kind: d.action, to: d.to };
    },
  };
  const oppInner = makePolicy(field[0], samples, seed + 1);
  const fc = new FeatureCache();
  const opp: Policy = {
    name: oppInner.name,
    observe: oppInner.observe,
    async act(view) {
      const out = await oppInner.act(view);
      const p = pending as typeof pending;
      if (p && p.handId === view.h.handId && p.events === view.h.events.length - 1) {
        const ci = comboIndex(view.hole[0], view.hole[1]);
        // The strength the range-aware opponent itself uses at this decision (its own range and its read of Hero, both
        // narrowed by everything so far, including Hero's bet or raise).
        const t = buildTable(view.h, view.seat, view.hole, new Map(), 0, fc);
        const sTrue = strengthTable(t.heroPerceived, mixRanges(t.villains.map((v) => v.range)), fc.get(view.h.board))[ci];
        const r = p.search.responseAt(p.a, ci);
        const rt = p.search.responseAt(p.a, ci, sTrue);
        const pot = potTotal(view.h);
        const trueFold = responseProbs2(sTrue, { street: view.h.street, betFrac: view.la.callAmount / Math.max(1, pot - view.la.callAmount), opponents: 1, isRaise: view.h.raisesThisStreet >= 2, tend: NEUTRAL }).fold;
        if (r && rt) recs.push({ ...p.base, trueFold, acts: r.acts, predCombo: r.forCombo, predRange: r.forRange, comboWeight: r.comboWeight, strength: r.strength, sTrue, predTrueS: rt.forCombo, actual: out.kind === 'bet' ? 'raise' : out.kind });
      }
      pending = null;
      return out;
    },
  };
  await playSession({ players: [{ playerId: '0', policy: hero }, { playerId: '1', policy: opp }], hands, seed, smallBlind: 10, bigBlind: 20, startStack: 2000, duplicate: true });
  return recs;
}

/** Calibration summary: predicted vs actual fold / raise frequency per group, with a 95% interval on the actual rate. */
export function summarise(recs: Rec[], key: (r: Rec) => string): string[] {
  const groups = new Map<string, Rec[]>();
  for (const r of recs) { const k = key(r); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
  const out = ['| Group | n | actual fold | predicted fold (actual holding) | predicted fold (range) | actual re-raise | predicted re-raise (holding) | mean value from folds / calls / raises (chips) | strength: model / opponent itself | predicted fold with the opponent itself strength | fold probability of the range-aware opponent itself |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  const pc = (x: number) => `${(100 * x).toFixed(0)}%`;
  for (const [k, rs] of [...groups.entries()].sort()) {
    const n = rs.length;
    const af = rs.filter((r) => r.actual === 'fold').length / n, ar = rs.filter((r) => r.actual === 'raise').length / n;
    const ci = 1.96 * Math.sqrt(Math.max(af * (1 - af), 1e-9) / n);
    const m = (f: (r: Rec) => number) => rs.reduce((t, r) => t + f(r), 0) / n;
    const pf = m((r) => r.predCombo[0]), pfr = m((r) => r.predRange[0]), pr = m((r) => r.predCombo[2] ?? 0);
    const dec = rs.filter((r) => r.decomposition);
    const md = (f: (x: NonNullable<Rec['decomposition']>) => number) => (dec.length ? dec.reduce((t, r) => t + f(r.decomposition!), 0) / dec.length : NaN);
    out.push(`| ${k} | ${n} | ${pc(af)} ± ${(100 * ci).toFixed(0)} | ${pc(pf)}${Math.abs(pf - af) > ci ? ' *' : ''} | ${pc(pfr)} | ${pc(ar)} | ${pc(pr)} | ${md((x) => x.fromFolds).toFixed(1)} / ${md((x) => x.fromCalls).toFixed(1)} / ${md((x) => x.fromRaises).toFixed(1)} | ${m((r) => r.strength).toFixed(2)} / ${m((r) => r.sTrue).toFixed(2)} | ${pc(m((r) => r.predTrueS[0]))} | ${pc(m((r) => r.trueFold))} |`);
  }
  return out;
}

async function main(): Promise<void> {
  const table = argS('table', 'hu-ra'), hands = argN('hands', 2000), seed = argN('seed', 12300);
  const m3 = argS('model3', ''); if (m3) Object.assign(MODEL3, JSON.parse(m3));
  const recs = await diagnose(table, hands, seed);
  const json = argS('json', ''); if (json) fs.writeFileSync(json, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`## ${table}, seed ${seed}, ${hands} hands: ${recs.length} version 3 bets and raises with a recorded response\n`);
  console.log(summarise(recs, (r) => `${r.street} ${r.kind}`).join('\n'));
}
if (process.argv[1] && /v3-raise-diag\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
