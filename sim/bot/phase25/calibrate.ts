// ============================================================
// Phase 2.5: fit and evaluate the opponent-response models on the real hands (heads-up pots after the flop).
//
//   npx tsx sim/bot/phase25/calibrate.ts [--data data/phh-handhq] [--out reports/PHASE_2_5_CALIBRATION.md]
//        [--table src/bot/strategy/v3/population-calibration.json]
//
// Protocol: hyperparameters chosen on the validation days (15-18) with models fitted on the training days (1-14);
// then each model is refitted on training + validation and scored ONCE on the test days (19 and later). A second
// protocol holds out a fifth of the players entirely (all their days). Losses are compared pairwise with 95%
// intervals clustered by hand. Writes the report and the fitted residual-calibration table (model D) that the
// experimental version 3 candidate reads.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import type { PredLine } from './run-predict';
import { calibration, CellFit, daySplit, fitFrequency, fitLogistic, fitResidual as fitResidualRaw, modelA, modelD, monotoneShifts, pairedByHand, playerGroup, Row, score } from './models';

/** Model D as used by version 3: the residual fit with folding monotone in the bet size. */
const fitResidual = (rs: readonly Row[], l: number) => monotoneShifts(fitResidualRaw(rs, l));
import { BETS, MULTS, SHIFTS } from './predict';

const argS = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };

export function rowOf(p: PredLine): Row | null {
  const y = p.facing ? (p.act === 'fold' ? 0 : p.act === 'call' ? 1 : p.act === 'raise' ? 2 : -1) : (p.act === 'check' ? 0 : p.act === 'bet' ? 1 : -1);
  if (y < 0) return null;
  return { hand: p.k, day: p.day, player: p.player, street: p.street, facing: p.facing, kind: p.facing ? p.type : p.role, frac: p.frac, ip: p.ip, agg: p.agg, spr: p.spr, canAgg: p.canAgg, y, grid: Float32Array.from(p.grid) };
}

async function main(): Promise<void> {
  const dataDir = argS('data', 'data/phh-handhq');
  const outPath = argS('out', 'reports/PHASE_2_5_CALIBRATION.md');
  const tablePath = argS('table', 'src/bot/strategy/v3/population-calibration.json');
  const rows: Row[] = [];
  for (const line of fs.readFileSync(path.join(dataDir, 'derived', 'preds.jsonl'), 'utf8').split('\n')) { if (!line) continue; const r = rowOf(JSON.parse(line) as PredLine); if (r) rows.push(r); }
  const ext = JSON.parse(fs.readFileSync(path.join(dataDir, 'derived', 'extract.json'), 'utf8'));
  const split = (s: string) => rows.filter((r) => daySplit(r.day) === s);
  const train = split('train'), val = split('val'), test = split('test'), trval = [...train, ...val];
  const L: string[] = [];
  const f3 = (x: number) => x.toFixed(4);
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

  // ---- hyperparameters on validation ----
  const tune = <T>(grid: T[], fit: (rs: Row[], h: T) => (r: Row) => number[]) => {
    let best = grid[0], bv = Infinity; const lines: string[] = [];
    for (const h of grid) { const s = score(val, fit(train, h)); lines.push(`${String(h)}: ${f3(s.logLoss)}`); if (s.logLoss < bv) { bv = s.logLoss; best = h; } }
    return { best, lines };
  };
  const fitC = (rs: Row[], l2: number) => { const a = fitLogistic(rs, l2, true), b = fitLogistic(rs, l2, false); return (r: Row) => (r.facing ? a(r) : b(r)); };
  const tB = tune([1, 3, 10, 30, 100], (rs, a) => fitFrequency(rs, a));
  const tC = tune([1e-4, 1e-3, 1e-2], fitC);
  const tD = tune([0.5, 2, 8, 32], (rs, l) => modelD(fitResidual(rs, l)));
  console.error('tuned', tB.best, tC.best, tD.best);

  // ---- final fits on train + validation, one evaluation on test ----
  const models: [string, (r: Row) => number[]][] = [
    ['A  version 3 as it is (hand-set)', modelA],
    ['B  frequency table', fitFrequency(trval, tB.best)],
    ['C  logistic regression', fitC(trval, tC.best)],
    ['D  version 3, residual-calibrated', modelD(fitResidual(trval, tD.best))],
  ];
  const fitDFinal = fitResidual(trval, tD.best);

  const section = (title: string, rs: Row[], ms: [string, (r: Row) => number[]][]) => {
    const sc = ms.map(([n, m]) => [n, score(rs, m)] as const);
    L.push(`### ${title}`, '', `${rs.length} decisions in ${new Set(rs.map((r) => r.hand)).size} hands (facing a bet: ${rs.filter((r) => r.facing).length}; may bet first: ${rs.filter((r) => !r.facing).length}).`, '');
    L.push('| Model | Log loss (nats) | Brier | Log loss minus A (95%, clustered by hand) | Brier minus A |', '|---|---|---|---|---|');
    const a = sc[0][1];
    for (const [n, s] of sc) {
      const dl = pairedByHand(rs, s.ll, a.ll), db = pairedByHand(rs, s.br, a.br);
      const mark = (d: { mean: number; ci95: number }) => `${d.mean >= 0 ? '+' : ''}${f3(d.mean)} ± ${f3(d.ci95)}${Math.abs(d.mean) > d.ci95 && n !== sc[0][0] ? ' *' : ''}`;
      L.push(`| ${n} | ${f3(s.logLoss)} | ${f3(s.brier)} | ${n === sc[0][0] ? '–' : mark(dl)} | ${n === sc[0][0] ? '–' : mark(db)} |`);
    }
    L.push('');
    return sc;
  };

  L.push('# Phase 2.5 calibration: opponent-response models on real hands', '');
  L.push(`Generated by \`npx tsx sim/bot/phase25/calibrate.ts\` from ${ext.dataset}, HandHQ sample (\`sim/bot/data/fetch-handhq.ts\`, ${ext.files} files). Account: \`docs/bot/PHASE_2_5_OPPONENT_LEARNING.md\`.`, '');
  L.push('## Data', '');
  L.push(`| | Count |`, `|---|---|`);
  L.push(`| Hand sections in the files | ${ext.sections} |`, `| Parsed | ${ext.parsed} |`, `| Heads-up-table hands excluded (blind order inconsistent in the conversion) | ${ext.headsUpTable} |`, `| Duplicates | ${ext.duplicate} |`);
  for (const [k, v] of Object.entries(ext.rejected as Record<string, number>).sort((a, b) => b[1] - a[1])) L.push(`| Rejected: ${k} | ${v} |`);
  L.push(`| **Valid cash hands kept** | **${ext.kept}** |`, `| of which stacks not recorded (iPoker) | ${ext.stacksUnknownHands} |`, `| Distinct anonymised players | ${ext.players} |`, `| Decisions after the flop (all pots) | ${ext.opps} |`);
  L.push(`| Heads-up-pot decisions with version 3 predictions | ${rows.length} |`, `| Called river bets / bettor's cards shown / both players' cards shown | ${ext.riverCalled} / ${ext.riverBettorShown} / ${ext.riverBothShown} |`, '');
  L.push('Sites and stakes kept: ' + Object.entries(ext.byVenue as Record<string, number>).map(([k, v]) => `${k} ${v}`).join(', ') + '.', '');
  L.push('Decision opportunities by street and situation (all pots, extract.ts types):', '', '| Street | may bet | facing a bet | own bet raised | bet check-raised | facing two bets cold |', '|---|---|---|---|---|---|');
  for (const st of ['flop', 'turn', 'river']) L.push(`| ${st} | ${['open', 'bet', 'raise', 'xr', 'cold'].map((t) => ext.oppsByType[`${st} ${t}`] ?? 0).join(' | ')} |`);
  L.push('', `Heads-up pots: train ${train.length}, validation ${val.length}, test ${test.length} decisions.`, '');

  L.push('## Hyperparameters (chosen on validation log loss)', '');
  L.push(`- B smoothing strength: ${tB.lines.join(', ')} → **${tB.best}**`, `- C L2 strength: ${tC.lines.join(', ')} → **${tC.best}**`, `- D penalty λ: ${tD.lines.join(', ')} → **${tD.best}**`, '');

  L.push('## Held-out test: days 19 and later (each model scored once)', '');
  const sc = section('All heads-up-pot decisions after the flop', test, models);
  section('Facing a bet or raise', test.filter((r) => r.facing), models);
  section('May bet first', test.filter((r) => !r.facing), models);
  section('River, facing a bet or raise', test.filter((r) => r.facing && r.street === 'river'), models);

  // Player-grouped protocol.
  const gTrain = rows.filter((r) => playerGroup(r.player) !== 0), gTest = rows.filter((r) => playerGroup(r.player) === 0);
  const gModels: [string, (r: Row) => number[]][] = [
    ['A  version 3 as it is (hand-set)', modelA],
    ['B  frequency table', fitFrequency(gTrain, tB.best)],
    ['C  logistic regression', fitC(gTrain, tC.best)],
    ['D  version 3, residual-calibrated', modelD(fitResidual(gTrain, tD.best))],
  ];
  L.push('## Held-out players: a fifth of the players never seen in fitting (all days)', '');
  section('All heads-up-pot decisions of the held-out players', gTest, gModels);

  // Calibration tables.
  const cal = (title: string, m: (r: Row) => number[], key: (r: Row) => string, rs: Row[]) => {
    L.push(`### ${title}`, '', '| Group | n | predicted | observed |', '|---|---|---|---|');
    for (const g of calibration(rs, m, key)) {
      const names = g.pred.length === 3 ? ['fold', 'call', 'raise'] : ['check', 'bet'];
      L.push(`| ${g.group} | ${g.n} | ${g.pred.map((x, i) => `${names[i]} ${pct(x)}`).join(', ')} | ${g.obs.map((x, i) => `${names[i]} ${pct(x)}`).join(', ')} |`);
    }
    L.push('');
  };
  L.push('## Calibration by street and situation (test days)', '');
  const key = (r: Row) => `${r.street} ${r.facing ? `facing ${r.kind}` : 'may bet'}`;
  cal('A  version 3 as it is', modelA, key, test);
  cal('D  version 3, residual-calibrated', models[3][1], key, test);
  cal('A by bet size, facing a first bet', modelA, (r) => `${r.street} ${r.frac < 0.4 ? 'a: <40%' : r.frac < 0.8 ? 'b: 40-80%' : r.frac < 1.3 ? 'c: 80-130%' : 'd: >130%'}`, test.filter((r) => r.facing && r.kind === 'bet'));
  cal('D by bet size, facing a first bet', models[3][1], (r) => `${r.street} ${r.frac < 0.4 ? 'a: <40%' : r.frac < 0.8 ? 'b: 40-80%' : r.frac < 1.3 ? 'c: 80-130%' : 'd: >130%'}`, test.filter((r) => r.facing && r.kind === 'bet'));

  // Fitted D table.
  L.push('## Model D: fitted corrections (training + validation days)', '');
  L.push('Shift = added to the fold threshold of every holding (positive: folds more); multiplier = on raising (facing) or on betting (may bet first). Cells with few decisions stay near no correction by the penalty.', '');
  L.push('| Cell | Decisions | Shift | Multiplier |', '|---|---|---|---|');
  const table: Record<string, { shift: number; mult: number; n: number }> = {};
  for (const [c, f] of [...fitDFinal.entries()].sort()) { L.push(`| ${c} | ${f.n} | ${f.shift >= 0 ? '+' : ''}${f.shift.toFixed(2)} | ×${f.mult.toFixed(2)} |`); table[c] = { shift: f.shift, mult: f.mult, n: f.n }; }
  L.push('', `Grids: shifts ${SHIFTS.join(', ')}; raise multipliers ${MULTS.join(', ')}; bet multipliers ${BETS.join(', ')}.`, '');
  void sc;
  fs.writeFileSync(outPath, L.join('\n') + '\n');
  fs.writeFileSync(tablePath, JSON.stringify({ source: ext.dataset, sample: `HandHQ, ${ext.kept} hands, fetch-handhq.ts`, fittedOn: 'days 1-18 (train + validation)', lambda: tD.best, cells: table }, null, 1) + '\n');
  console.log(`report ${outPath}, table ${tablePath}`);
  void (null as unknown as CellFit);
}

if (process.argv[1] && /calibrate\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
