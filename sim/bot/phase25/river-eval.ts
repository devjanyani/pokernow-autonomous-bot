// ============================================================
// Phase 2.5: fit and evaluate the river betting-range estimator (river-range.ts) on real called river bets.
//
//   npx tsx sim/bot/phase25/river-eval.ts [--data data/phh-handhq] [--out reports/phase25-river-range.md]
//        [--table src/bot/strategy/v3/river-range-calibration.json]
//
// Observations: heads-up pots, river, a bet or raise that was called and whose bettor's cards were revealed.
// Days 1-14 fit, 15-18 choose the penalty, 19+ test once. Reported on test: mean log-likelihood of the revealed
// holding under version 2's range and under the estimator (paired, one observation per hand); the share of
// value / medium / weak holdings predicted against revealed; and, for a bluff-catcher of made-hand percentile x,
// the predicted probability that the bettor holds a better made hand against how often it did (an unbiased check:
// the indicator is observed whenever the bettor's cards are, and the call did not depend on them).
// ============================================================

import * as fs from 'fs';
import { parseCardStrict } from '../../../src/bot/cards';
import { buildTable, FeatureCache } from '../../../src/bot/strategy/villains';
import { forEachHand, opportunities } from './extract';
import { daySplit } from './models';
import { categories, CATEGORY, comboOf, fitRiver, logLik, riverCell, RiverObs, riverPercentiles, tilt } from './river-range';

const argS = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };

export function collect(dataDir: string): { obs: RiverObs[]; called: number; shown: number } {
  const cache = new FeatureCache();
  const obs: RiverObs[] = [];
  let called = 0, shown = 0;
  forEachHand(dataDir, (h, fi) => {
    const local: RiverObs[] = [];
    let c = 0, s = 0;
    const ex = opportunities(h, fi, undefined, (st, o) => {
      if (st.street !== 'river' || o.n !== 2 || o.type === 'open' || o.act !== 'call') return;
      c++;
      const bettor = st.aggressor.river!;
      const bh = h.holes[bettor];
      if (!bh) return;
      s++;
      const ch = h.holes[st.toAct!];
      const callerCards: [number, number] = ch ? [parseCardStrict(ch[0]) as number, parseCardStrict(ch[1]) as number] : [st.board[0], st.board[1]];
      const t = buildTable(st, st.toAct!, callerCards, new Map(), 0, cache);
      const v = t.villains.find((x) => x.seat === bettor);
      if (!v) return;
      const betTurn = st.events.some((e) => e.street === 'turn' && e.seat === bettor && (e.kind === 'bet' || e.kind === 'raise'));
      local.push({ hand: `${h.meta.venue}:${h.meta.hand}`, day: Number(h.meta.day), range: Float64Array.from(v.range), combo: comboOf(bh.join('')), hs: riverPercentiles(st.board), cell: riverCell(o.frac, betTurn) });
    });
    if (ex.ok) { obs.push(...local); called += c; shown += s; }
    return ex;
  }, false);
  return { obs, called, shown };
}

async function main(): Promise<void> {
  const dataDir = argS('data', 'data/phh-handhq'), out = argS('out', 'reports/phase25-river-range.md'), tablePath = argS('table', 'src/bot/strategy/v3/river-range-calibration.json');
  const { obs, called, shown } = collect(dataDir);
  const by = (s: string) => obs.filter((o) => daySplit(o.day) === s);
  const train = by('train'), val = by('val'), test = by('test');
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  // Penalty on validation.
  // Two shapes: one tilt per cell (size x turn barrel) and one pooled tilt for all river bets; penalty and shape
  // chosen together on validation.
  const pooled = (os: RiverObs[]) => os.map((o) => ({ ...o, cell: 'all' }));
  let best = 1, bestPooled = false, bv = -Infinity; const tuneLines: string[] = [];
  for (const pool of [false, true]) for (const l2 of [0.1, 1, 10, 30, 100]) {
    const m = fitRiver(pool ? pooled(train) : train, l2);
    const v = mean(val.map((o) => logLik(o, m.theta[pool ? 'all' : o.cell])));
    tuneLines.push(`${pool ? 'pooled' : 'per cell'} ${l2}: ${v.toFixed(4)}`);
    if (v > bv) { bv = v; best = l2; bestPooled = pool; }
  }
  const fitted = fitRiver(bestPooled ? pooled([...train, ...val]) : [...train, ...val], best);
  const model = { ...fitted, theta: new Proxy(fitted.theta, { get: (t, c: string) => t[bestPooled ? 'all' : c] }) as Record<string, number[]> };
  const L: string[] = [];
  const f4 = (x: number) => x.toFixed(4), pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  L.push('# Phase 2.5: river betting-range estimator on real called river bets', '');
  L.push(`Heads-up pots, river bets or raises that were called: ${called}; bettor's cards revealed: ${shown} (${pct(shown / Math.max(1, called))}). Usable observations: ${obs.length} (train ${train.length}, validation ${val.length}, test ${test.length}).`, '');
  L.push(`Shape and penalty chosen on validation (mean log-likelihood): ${tuneLines.join(', ')} → **${bestPooled ? 'pooled' : 'per cell'}, ${best}**.`, '');
  // Log-likelihood, paired, one per hand.
  const base = test.map((o) => logLik(o, undefined)), est = test.map((o) => logLik(o, model.theta[o.cell]));
  const d = est.map((x, i) => x - base[i]); const md = mean(d); const sd = Math.sqrt(mean(d.map((x) => (x - md) ** 2)) / Math.max(1, d.length - 1));
  L.push('## Test days: likelihood of the revealed holding', '', '| Range | Mean log-likelihood per observation |', '|---|---|');
  L.push(`| Version 2's estimate | ${f4(mean(base))} |`, `| Estimator (tilted) | ${f4(mean(est))} |`, `| Difference (estimator minus version 2) | ${md >= 0 ? '+' : ''}${f4(md)} ± ${f4(1.96 * sd)}${Math.abs(md) > 1.96 * sd ? ' *' : ''} |`, '');
  // Category composition.
  const comp = (th: (o: RiverObs) => number[] | undefined) => { const acc: Record<string, number> = { value: 0, 'thin / medium': 0, 'bluff (weak)': 0 }; for (const o of test) { const c = categories(o, th(o)); for (const k of Object.keys(acc)) acc[k] += c[k] / test.length; } return acc; };
  const obsC: Record<string, number> = { value: 0, 'thin / medium': 0, 'bluff (weak)': 0 };
  for (const o of test) obsC[CATEGORY(o.hs[o.combo])] += 1 / test.length;
  const cb = comp(() => undefined), ce = comp((o) => model.theta[o.cell]);
  L.push('## Test days: strength composition of river betting ranges (made-hand percentile on the river)', '', '| Category | Version 2 predicts | Estimator predicts | Revealed |', '|---|---|---|---|');
  for (const k of Object.keys(obsC)) L.push(`| ${k} | ${pct(cb[k])} | ${pct(ce[k])} | ${pct(obsC[k])} |`);
  L.push('', 'Value = percentile 0.75 or more; thin / medium = 0.40 to 0.75; bluff (weak) = under 0.40. Categories describe the hypothesised range; only revealed hands are facts.', '');
  // Bluff-catcher check.
  L.push('## Test days: how often a river bettor beats a bluff-catcher of made-hand percentile x', '', 'Predicted = the range\'s share of holdings with a higher percentile than x; observed = how often the revealed holding had one.', '', '| x | n | Version 2 predicts | Estimator predicts | Observed |', '|---|---|---|---|---|');
  for (const x of [0.5, 0.6, 0.7, 0.8]) {
    let pb = 0, pe = 0, ob = 0;
    for (const o of test) {
      for (const [th, add] of [[undefined, (v: number) => { pb += v; }], [model.theta[o.cell], (v: number) => { pe += v; }]] as const) {
        const w = tilt(o.range, o.hs, th); let t = 0, a = 0; for (let k = 0; k < 1326; k++) if (w[k] > 0) { t += w[k]; if (o.hs[k] > x) a += w[k]; } add(a / (t || 1));
      }
      if (o.hs[o.combo] > x) ob++;
    }
    const n = test.length, p = ob / n;
    L.push(`| ${x} | ${n} | ${pct(pb / n)} | ${pct(pe / n)} | ${pct(p)} ± ${(196 * Math.sqrt(p * (1 - p) / n)).toFixed(1)} |`);
  }
  L.push('', '## Fitted tilts (log-weight per percentile bin, fitted on days 1-18)', '', '| Cell | <0.2 | 0.2-0.4 | 0.4-0.6 | 0.6-0.75 | 0.75-0.9 | ≥0.9 | Observations |', '|---|---|---|---|---|---|---|---|');
  for (const [c, th] of Object.entries(fitted.theta).sort()) L.push(`| ${c} | ${th.map((t) => (t >= 0 ? '+' : '') + t.toFixed(2)).join(' | ')} | ${[...train, ...val].filter((o) => c === 'all' || o.cell === c).length} |`);
  fs.writeFileSync(out, L.join('\n') + '\n');
  fs.writeFileSync(tablePath, JSON.stringify({ source: 'phh-dataset@e47fbd5 HandHQ sample', fittedOn: 'days 1-18', l2: best, pooled: bestPooled, bins: [0.2, 0.4, 0.6, 0.75, 0.9], theta: fitted.theta }, null, 1) + '\n');
  console.log(`report ${out}, table ${tablePath}`);
}

if (process.argv[1] && /river-eval\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
