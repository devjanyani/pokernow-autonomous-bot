// ============================================================
// Phase 2.5: the whole experiment, reproducibly, in one command.
//
//   npm run bot:phase25 -- [--per-folder 30] [--bench] [--seed 13100] [--hands 2000] [--jobs 2] [--tables a,b,...]
//
// Steps (each skipped only by its own flag, never silently):
//   1. data       fetch-handhq.ts: the pinned dataset version (DATASET_COMMIT), PER_FOLDER files per folder; files
//                 already present with the recorded sha256 are not downloaded again.
//   2. extract    extract.ts: valid cash hands -> decision opportunities and called river bets (data/, git-ignored).
//   3. predict    run-predict.ts: version 3's range-conditional predictions for every heads-up-pot decision.
//   4. calibrate  calibrate.ts: models A-D, chronological and player-grouped evaluation, the fitted table, the report.
//   5. river      river-eval.ts: the river betting-range estimator, its evaluation and fitted table.
//   6. bench      (only with --bench) phase23-bench.ts for v2, v3 and the three candidates on the given seed, at most
//                 --jobs processes at a time (memory), then phase23-report.ts.
// Writes data/phh-handhq/derived/experiment.json: the configuration, seeds, dataset version, file hashes and the
// time of each step. Raw hands never leave data/.
// ============================================================

import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DATASET_COMMIT, DATASET_VERSION } from '../data/fetch-handhq';

const argS = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const flag = (k: string) => process.argv.includes(`--${k}`);
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (args: string[]) => { const t0 = Date.now(); const r = spawnSync(npx, ['tsx', ...args], { stdio: 'inherit', shell: process.platform === 'win32' }); if (r.status !== 0) throw new Error(`${args.join(' ')} failed (${r.status})`); return (Date.now() - t0) / 1000; };

export const BENCH_ENGINES = 'v2,v3,v3p,v3r,v3pr';
export const BENCH_HU_TABLES = ['hu-tag', 'hu-lag', 'hu-tight-passive', 'hu-loose-passive', 'hu-station', 'hu-maniac', 'hu-raiser', 'hu-trapper', 'hu-mdf', 'hu-punisher', 'hu-caller', 'hu-nit', 'hu-re', 'hu-ra'];

async function main(): Promise<void> {
  const dataDir = 'data/phh-handhq';
  const per = argS('per-folder', '30'), seed = argS('seed', '13100'), hands = argS('hands', '2000'), jobs = Number(argS('jobs', '2'));
  const tables = argS('tables', BENCH_HU_TABLES.join(',')).split(',');
  const record: Record<string, unknown> = { dataset: DATASET_VERSION, commit: DATASET_COMMIT, perFolder: Number(per), started: new Date().toISOString(), steps: {} as Record<string, number> };
  const steps = record.steps as Record<string, number>;
  steps.data = run(['sim/bot/data/fetch-handhq.ts', '--per-folder', per]);
  steps.extract = run(['sim/bot/phase25/extract.ts']);
  steps.predict = run(['sim/bot/phase25/run-predict.ts']);
  steps.calibrate = run(['sim/bot/phase25/calibrate.ts']);
  steps.river = run(['sim/bot/phase25/river-eval.ts']);
  record.files = JSON.parse(fs.readFileSync(path.join(dataDir, 'manifest.json'), 'utf8')).files.map((f: { file: string; sha256: string }) => ({ file: f.file, sha256: f.sha256 }));
  if (flag('bench')) {
    const outDir = path.join(dataDir, 'derived', `bench-${seed}`);
    fs.mkdirSync(outDir, { recursive: true });
    record.bench = { seed: Number(seed), hands: Number(hands), engines: BENCH_ENGINES, tables, jobs };
    const t0 = Date.now();
    const queue = tables.slice();
    const worker = async (): Promise<void> => {
      while (queue.length) {
        const t = queue.shift()!;
        await new Promise<void>((res, rej) => {
          const p = spawn(npx, ['tsx', 'sim/bot/phase23-bench.ts', '--engines', BENCH_ENGINES, '--hands', hands, '--seed', seed, '--tables', t, '--json', path.join(outDir, `${t}.jsonl`)], { stdio: 'ignore', shell: process.platform === 'win32' });
          p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`bench ${t} failed (${c})`))));
        });
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
    steps.bench = (Date.now() - t0) / 1000;
    const report = spawnSync(npx, ['tsx', 'sim/bot/phase23-report.ts', ...tables.map((t) => path.join(outDir, `${t}.jsonl`))], { encoding: 'utf8', shell: process.platform === 'win32' });
    fs.writeFileSync(path.join(outDir, 'report.md'), report.stdout);
  }
  record.finished = new Date().toISOString();
  fs.writeFileSync(path.join(dataDir, 'derived', 'experiment.json'), JSON.stringify(record, null, 1));
  console.log(`experiment record ${path.join(dataDir, 'derived', 'experiment.json')}`);
}

if (process.argv[1] && /experiment\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
