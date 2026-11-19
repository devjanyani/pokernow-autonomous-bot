// ============================================================
// Phase 2.5: reproducible, bounded download of a sample of the HandHQ no-limit hold'em CASH-GAME hand histories
// from the PHH dataset (University of Toronto Computer Poker Research Group).
//
//   npx tsx sim/bot/data/fetch-handhq.ts [--per-folder 30] [--out data/phh-handhq]
//
// Source: https://github.com/uoftcprg/phh-dataset (MIT licence), pinned to commit DATASET_COMMIT so that the same
// files are fetched every time. HandHQ logs: anonymised (player names replaced by hashes), July 1-23 2009, online
// cash games 25NL-1000NL. Only cash-game folders are listed here; the WSOP and Pluribus folders of the dataset are
// never fetched (tournament / bot hands are not cash-game population data).
//
// The sample: PER_FOLDER files from each of the folders below, evenly spaced over each folder's file numbers. Files
// are numbered in time order, so the sample covers all 23 days, which the chronological split needs. One file =
// 1,000 hands, ~0.7 MB. Downloads are sequential, skip files already present with the recorded hash, and write
// `manifest.json` (file, URL, bytes, sha256) next to the data. Everything goes under data/, which git ignores.
// ============================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const DATASET_COMMIT = 'e47fbd5816372360bade4de5d712346fe1bb70f6';
export const DATASET_VERSION = 'phh-dataset@e47fbd5 (release v3, 2025-09-18)';
/** Folder, file-name prefix, number of files in the folder (from the git tree at DATASET_COMMIT). */
export const HANDHQ_FOLDERS: { folder: string; prefix: string; files: number; site: string; stake: string }[] = [
  { folder: 'PS-2009-07-01_2009-07-23_200NLH_OBFU/2', prefix: 'ps', files: 1198, site: 'PokerStars', stake: '200NL' },
  { folder: 'IPN-2009-07-01_2009-07-23_100NLH_OBFU/1', prefix: 'ipn', files: 2081, site: 'iPoker Network', stake: '100NL' },
  { folder: 'IPN-2009-07-01_2009-07-23_200NLH_OBFU/2', prefix: 'ipn', files: 1820, site: 'iPoker Network', stake: '200NL' },
  { folder: 'ABS-2009-07-01_2009-07-23_100NLH_OBFU/1', prefix: 'abs', files: 325, site: 'Absolute Poker', stake: '100NL' },
];

export interface FetchedFile { folder: string; file: string; url: string; bytes: number; sha256: string }

/** The deterministic sample: `per` file numbers evenly spaced over 1..n (always including 1 and n). */
export function sampleNumbers(n: number, per: number): number[] {
  if (per >= n) return Array.from({ length: n }, (_, i) => i + 1);
  return [...new Set(Array.from({ length: per }, (_, k) => 1 + Math.round((k * (n - 1)) / (per - 1))))];
}

export function sampleList(per: number): { folder: string; file: string; url: string }[] {
  const out: { folder: string; file: string; url: string }[] = [];
  for (const f of HANDHQ_FOLDERS) {
    for (const k of sampleNumbers(f.files, per)) {
      const file = `${f.prefix} NLH handhq_${k}-OBFUSCATED.phhs`;
      out.push({ folder: f.folder, file, url: `https://raw.githubusercontent.com/uoftcprg/phh-dataset/${DATASET_COMMIT}/data/handhq/${f.folder.split('/').map(encodeURIComponent).join('/')}/${encodeURIComponent(file)}` });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const argS = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
  const per = Number(argS('per-folder', '30'));
  const outDir = argS('out', 'data/phh-handhq');
  const manifestPath = path.join(outDir, 'manifest.json');
  const old: FetchedFile[] = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files : [];
  const known = new Map(old.map((x) => [`${x.folder}/${x.file}`, x]));
  const files: FetchedFile[] = [];
  const list = sampleList(per);
  let fetched = 0;
  for (const [i, item] of list.entries()) {
    const local = path.join(outDir, item.folder, item.file);
    const prev = known.get(`${item.folder}/${item.file}`);
    if (prev && fs.existsSync(local)) {
      const buf = fs.readFileSync(local);
      if (crypto.createHash('sha256').update(buf).digest('hex') === prev.sha256) { files.push(prev); continue; }
    }
    const res = await fetch(item.url);
    if (!res.ok) throw new Error(`${item.url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(local, buf);
    files.push({ ...item, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
    fetched++;
    if ((i + 1) % 10 === 0) console.error(`${i + 1} / ${list.length}`);
  }
  fs.writeFileSync(manifestPath, JSON.stringify({ dataset: DATASET_VERSION, commit: DATASET_COMMIT, perFolder: per, retrieved: new Date().toISOString().slice(0, 10), files }, null, 1));
  const bytes = files.reduce((t, f) => t + f.bytes, 0);
  console.log(`${files.length} files (${fetched} downloaded now), ${(bytes / 1e6).toFixed(1)} MB, manifest ${manifestPath}`);
}

if (process.argv[1] && /fetch-handhq\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
