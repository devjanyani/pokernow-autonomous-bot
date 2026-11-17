// ============================================================
// Manifest of a data folder, and the import command.
//
//   npx tsx sim/bot/data/manifest.ts hash <folder>                 print path, SHA-256 and size of every file
//   npx tsx sim/bot/data/manifest.ts check <manifest.json>         validate provenance and file hashes only
//   npx tsx sim/bot/data/manifest.ts import <manifest.json> [--out data/normalized]
//
// A manifest is { sources: SourceInfo[], inputs: [{ source, path, format }] } next to the data files, where
// format is one of pokerbench-postflop-csv, phh, pokernow-log. Import refuses a source whose provenance is
// incomplete, whose approval is missing, or whose files do not match their recorded hashes; it reads only
// local files and never downloads anything. Normalised output goes to a git-ignored folder, one JSON record
// per line, each carrying its source id.
//
// `data/` is git-ignored. Nothing imported is ever committed.
// ============================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseLogCsv } from '../../../src/bot/adapter/pokernow/log';
import { parsePhh, parsePokerBenchPostflop, parsePokerNowLog } from './importers';
import { DecisionExample, errorsOf, HandHistory, Issue, SourceInfo } from './schema';
import { validateExample, validateHand, validateSource } from './validate';

export interface Manifest { sources: SourceInfo[]; inputs: { source: string; path: string; format: 'pokerbench-postflop-csv' | 'phh' | 'pokernow-log' }[] }
export const sha256 = (buf: Buffer | string): string => crypto.createHash('sha256').update(buf).digest('hex');

/** Provenance and file integrity. `read` returns a file's bytes, or null when it is missing. */
export function checkManifest(m: Manifest, read: (relPath: string) => Buffer | null): Issue[] {
  const issues: Issue[] = [];
  if (!m || !Array.isArray(m.sources) || !Array.isArray(m.inputs)) return [{ level: 'error', where: 'manifest', message: 'needs "sources" and "inputs" lists' }];
  const ids = new Set<string>();
  for (const s of m.sources) {
    issues.push(...validateSource(s));
    if (ids.has(s.id)) issues.push({ level: 'error', where: `source ${s.id}`, message: 'duplicate source id' });
    ids.add(s.id);
    for (const f of s.files ?? []) {
      if (/^([a-zA-Z]:|[\\/])|\.\./.test(f.path ?? '')) continue; // already reported; never read outside the folder
      const buf = read(f.path);
      if (!buf) { issues.push({ level: 'error', where: `source ${s.id}`, message: `file ${f.path} is missing` }); continue; }
      if (sha256(buf) !== f.sha256) issues.push({ level: 'error', where: `source ${s.id}`, message: `file ${f.path} does not match its recorded SHA-256 (it was changed or replaced)` });
      else if (buf.length !== f.bytes) issues.push({ level: 'error', where: `source ${s.id}`, message: `file ${f.path} is ${buf.length} bytes, the manifest says ${f.bytes}` });
    }
  }
  for (const i of m.inputs) {
    const s = m.sources.find((x) => x.id === i.source);
    if (!s) { issues.push({ level: 'error', where: `input ${i.path}`, message: `unknown source "${i.source}"` }); continue; }
    if (!s.files.some((f) => f.path === i.path)) issues.push({ level: 'error', where: `input ${i.path}`, message: 'not listed among the source\'s hashed files' });
  }
  return issues;
}

export interface ImportResult { hands: HandHistory[]; examples: DecisionExample[]; issues: Issue[]; counts: Record<string, { read: number; kept: number; rejected: number }> }

/** Parse and validate every input of a manifest whose provenance checks out. Records that fail validation are left out and reported. */
export function importManifest(m: Manifest, read: (relPath: string) => Buffer | null): ImportResult {
  const out: ImportResult = { hands: [], examples: [], issues: checkManifest(m, read), counts: {} };
  const blocked = new Set(errorsOf(out.issues).map((i) => /^source (\S+)/.exec(i.where)?.[1]).filter((x): x is string => !!x));
  if (errorsOf(out.issues).some((i) => i.where === 'manifest')) return out;
  for (const input of m.inputs) {
    const src = m.sources.find((s) => s.id === input.source);
    if (!src || blocked.has(src.id) || errorsOf(out.issues).some((i) => i.where === `input ${input.path}`)) continue;
    const text = (read(input.path) as Buffer).toString('utf8').trimStart();
    const c = out.counts[src.id] ?? (out.counts[src.id] = { read: 0, kept: 0, rejected: 0 });
    const keepHand = (h: HandHistory) => { c.read++; const iss = validateHand(h); out.issues.push(...iss); if (errorsOf(iss).length) c.rejected++; else { c.kept++; out.hands.push(h); } };
    if (input.format === 'pokerbench-postflop-csv') {
      const r = parsePokerBenchPostflop(text, src.id);
      out.issues.push(...r.issues); c.read += r.issues.length; c.rejected += r.issues.length;
      for (const e of r.examples) { c.read++; const iss = validateExample(e); out.issues.push(...iss); if (errorsOf(iss).length) c.rejected++; else { c.kept++; out.examples.push({ ...e, labelSemantics: src.labelSemantics }); } }
    } else if (input.format === 'phh') {
      const r = parsePhh(text, src.id, path.basename(input.path).replace(/\.phh$/, ''));
      out.issues.push(...r.issues);
      if (r.hand) keepHand(r.hand); else { c.read++; c.rejected++; }
    } else if (input.format === 'pokernow-log') {
      const r = parsePokerNowLog(text.trimStart().startsWith('entry,at,order') ? parseLogCsv(text) : text.split(/\r?\n/), src.id);
      out.issues.push(...r.issues); const bad = errorsOf(r.issues).length; c.read += bad; c.rejected += bad;
      for (const h of r.hands) keepHand(h);
    } else out.issues.push({ level: 'error', where: `input ${input.path}`, message: `unknown format "${String(input.format)}"` });
  }
  return out;
}

function main(): void {
  const [cmd, target] = process.argv.slice(2);
  if (cmd === 'hash' && target) {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(path.join(dir, f.name)) : [path.join(dir, f.name)]));
    for (const f of walk(target)) { const b = fs.readFileSync(f); console.log(JSON.stringify({ path: path.relative(target, f).replace(/\\/g, '/'), sha256: sha256(b), bytes: b.length })); }
    return;
  }
  if ((cmd === 'check' || cmd === 'import') && target) {
    const dir = path.dirname(path.resolve(target));
    const m = JSON.parse(fs.readFileSync(target, 'utf8')) as Manifest;
    const read = (rel: string) => { const p = path.resolve(dir, rel); return p.startsWith(dir) && fs.existsSync(p) ? fs.readFileSync(p) : null; };
    const r = cmd === 'check' ? { hands: [], examples: [], issues: checkManifest(m, read), counts: {} } as ImportResult : importManifest(m, read);
    for (const i of r.issues.slice(0, 200)) console.log(`${i.level.toUpperCase()}  ${i.where}: ${i.message}`);
    if (r.issues.length > 200) console.log(`... and ${r.issues.length - 200} more`);
    for (const [s, c] of Object.entries(r.counts)) console.log(`${s}: ${c.read} read, ${c.kept} kept, ${c.rejected} rejected`);
    if (cmd === 'import') {
      const i = process.argv.indexOf('--out');
      const out = path.resolve(i >= 0 ? process.argv[i + 1] : 'data/normalized');
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'hands.jsonl'), r.hands.map((h) => JSON.stringify(h)).join('\n') + (r.hands.length ? '\n' : ''));
      fs.writeFileSync(path.join(out, 'examples.jsonl'), r.examples.map((e) => JSON.stringify(e)).join('\n') + (r.examples.length ? '\n' : ''));
      fs.writeFileSync(path.join(out, 'sources.json'), JSON.stringify(m.sources, null, 1));
      console.log(`wrote ${r.hands.length} hand(s) and ${r.examples.length} example(s) to ${out}`);
    }
    if (errorsOf(r.issues).length) process.exitCode = 1;
    return;
  }
  console.error('usage: npx tsx sim/bot/data/manifest.ts hash <folder> | check <manifest.json> | import <manifest.json> [--out dir]');
  process.exit(2);
}
if (process.argv[1] && /manifest\.ts$/.test(process.argv[1])) main();
