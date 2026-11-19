// ============================================================
// Phase 2.5: version 3's model predictions for every heads-up-pot decision after the flop in the sample.
//
//   npx tsx sim/bot/phase25/run-predict.ts [--data data/phh-handhq] [--max-files N]
//
// Writes data/phh-handhq/derived/preds.jsonl: one line per decision with the public features (extract.ts Opp),
// the action taken and version 3's predicted probabilities on the calibration grids of predict.ts. Single process,
// sequential; memory stays small (one hand at a time).
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { FeatureCache } from '../../../src/bot/strategy/villains';
import { forEachHand, Opp, opportunities } from './extract';
import { predict } from './predict';

export interface PredLine extends Opp { facing: boolean; grid: number[]; poorFit: boolean; checkRaised: boolean; ownRaised: boolean; role: string }

async function main(): Promise<void> {
  const argS = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
  const dataDir = argS('data', 'data/phh-handhq');
  const maxFiles = Number(argS('max-files', '1e9'));
  const out = fs.openSync(path.join(dataDir, 'derived', 'preds.jsonl'), 'w');
  const cache = new FeatureCache();
  const t0 = Date.now();
  let n = 0, skipped = 0;
  const stat = forEachHand(dataDir, (h, fi) => {
    if (fi >= maxFiles) return { ok: false, reason: 'beyond --max-files' };
    const buf: PredLine[] = [];
    const ex = opportunities(h, fi, undefined, (st, o) => {
      if (o.n !== 2) return;
      const p = predict(st, st.toAct!, cache);
      if (!p) { skipped++; return; }
      const r = (x: number) => Math.round(x * 1e5) / 1e5;
      buf.push({ ...o, facing: p.facing, grid: Array.from(p.grid, r), poorFit: p.poorFit, checkRaised: p.ctx.checkRaised, ownRaised: p.ctx.ownRaised, role: p.ctx.role });
    });
    if (ex.ok) for (const b of buf) { fs.writeSync(out, JSON.stringify(b) + '\n'); n++; }
    return ex;
  });
  fs.closeSync(out);
  console.log(`hands kept ${stat.kept}, heads-up decisions predicted ${n}, not predictable ${skipped}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

if (process.argv[1] && /run-predict\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
