// ============================================================
// Replay a debug bundle exported from the dashboard (Diagnostics tab ->
// "Export Debug Bundle") through the reconstruction engine, offline.
//
//   npm run bot:replay -- path/to/poker-bot-debug-....json
//   npm run bot:replay -- bundle.json --hand 3        only the 3rd hand in the file
//   npm run bot:replay -- bundle.json --frames        also list every frame
//   npm run bot:replay -- bundle.json --json out.json write the full result as JSON
//
// It feeds the recorded observations, in order and with their timestamps, to a
// fresh HandTracker (the same code that runs in the extension) and prints the
// action timeline of each hand, which entries were deduced, the first frame at
// which the table and the reconstruction disagreed, and where the current code
// behaves differently from what was recorded live.
// ============================================================

import * as fs from 'fs';
import { parseBundle } from '../../src/bot/diag/recorder';
import { formatReplay, replayObservations } from '../../src/bot/diag/replay';

function main(): void {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--hand' && args[args.indexOf(a) - 1] !== '--json');
  if (!file) { console.error('usage: npm run bot:replay -- <bundle.json> [--hand N] [--frames] [--json out.json]'); process.exit(2); }
  const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const bundle = parseBundle(JSON.parse(fs.readFileSync(file, 'utf8').replace(new RegExp('^' + String.fromCharCode(0xfeff)), '')));
  console.log(`Bundle exported ${bundle.exportedAt} by extension ${bundle.build.extensionVersion}${bundle.anonymised ? ' (anonymised)' : ''}`);
  console.log(bundle.dropped.note);
  let hands = bundle.hands;
  const only = opt('hand');
  if (only !== undefined) hands = hands.slice(Number(only) - 1, Number(only));
  if (!hands.length) { console.error('no hands selected'); process.exit(2); }
  const partial = hands.filter((h) => !h.startsAtHandStart);
  if (partial.length) console.log(`NOTE: ${partial.length} hand(s) do not start at their first observation; the tracker cannot follow those until the next hand begins.`);
  const frames = hands.flatMap((h) => h.frames);
  const r = replayObservations(frames);
  console.log(`\nReplayed ${frames.length} frame(s) from ${hands.length} recorded hand(s).\n`);
  console.log(formatReplay(r));
  if (args.includes('--frames')) {
    console.log('\nFrames:');
    for (const s of r.steps) {
      const f = frames[s.index];
      console.log(`#${s.index} t=${Math.round(s.ts)} ${s.phase} table-actor=${String(s.observedActor)} engine-actor=${String(s.predictedActor)} ${s.turnStatus}${s.heroToActShown ? ' HERO-TURN-SHOWN' : ''} hero=${s.heroStatus}`
        + `${s.newEvents.length ? ` + ${s.newEvents.map((e) => e.text + (e.inferred ? '*' : '')).join(', ')}` : ''}`
        + `${s.blockers.length ? ` BLOCKED: ${s.blockers.join(' | ')}` : ''}${s.warnings.length ? ` warn: ${s.warnings.join(' | ')}` : ''}`
        + `${f.decision ? ` live-decision=${f.decision.state}${f.decision.label ? `(${f.decision.label})` : ''}` : ''}`);
    }
  }
  const out = opt('json');
  if (out) { fs.writeFileSync(out, JSON.stringify(r, null, 1)); console.log(`\nWrote ${out}`); }
  // Raw page facts worth a look when selectors are in doubt.
  const classes = new Set<string>();
  const buttons = new Set<string>();
  for (const f of frames) { for (const s of f.obs.seats) if (s.cls) classes.add(s.cls.replace(/table-player-\d+/, 'table-player-N')); for (const b of f.obs.raw?.buttons ?? []) buttons.add(b); }
  if (classes.size) console.log(`\nSeat class lists seen (${classes.size}): ${[...classes].slice(0, 25).join('  ||  ')}`);
  if (buttons.size) console.log(`Button class|text seen (${buttons.size}): ${[...buttons].slice(0, 25).join('  ||  ')}`);
}

main();
