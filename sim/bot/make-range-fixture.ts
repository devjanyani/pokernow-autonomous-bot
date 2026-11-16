// ============================================================
// Cut named frame ranges out of a debug bundle into a small regression fixture:
//
//   npx tsx sim/bot/make-range-fixture.ts <bundle.json> <out.json> <session number>:<from n>-<to n>:<name> [...]
//
// Session numbers are those printed by sim/bot/audit-bundle.ts (1 = oldest). Player names, player ids and the
// table id are replaced by placeholders (the same routine as the dashboard's anonymised export); only the
// observation of each frame is kept, unaltered apart from that. Each range should start at a hand's first frame.
// ============================================================

import * as fs from 'fs';
import { anonymiseBundle, parseBundle } from '../../src/bot/diag/recorder';

const [src, out, ...ranges] = process.argv.slice(2);
if (!src || !out || !ranges.length) { console.error('usage: npx tsx sim/bot/make-range-fixture.ts <bundle.json> <out.json> <session>:<from>-<to>:<name> [...]'); process.exit(2); }
const b = anonymiseBundle(parseBundle(JSON.parse(fs.readFileSync(src, 'utf8').trimStart())));
const frames = b.hands.flatMap((h) => h.frames).sort((x, y) => x.wall - y.wall || x.n - y.n);
const sessions = [...new Set(frames.map((f) => f.session))];
const segments = ranges.map((r) => {
  const m = /^(\d+):(\d+)-(\d+):(.+)$/.exec(r);
  if (!m) throw new Error(`bad range "${r}"`);
  const s = sessions[Number(m[1]) - 1];
  const fr = frames.filter((f) => f.session === s && f.n >= Number(m[2]) && f.n <= Number(m[3])).sort((x, y) => x.n - y.n);
  if (!fr.length) throw new Error(`no frames for "${r}"`);
  return { name: m[4], frames: fr.map((f) => ({ n: f.n, obs: { ...f.obs, raw: f.obs.raw ? { buttons: f.obs.raw.buttons, signal: f.obs.raw.signal, pot: f.obs.raw.pot, timer: null } : undefined } })) };
});
fs.writeFileSync(out, JSON.stringify({ format: 'poker-bot-frame-ranges', version: 1, source: 'live PokerNow session; names and table id replaced; observations otherwise unaltered', recordedWith: b.build.extensionVersion, segments }));
console.log(`${segments.length} segment(s), ${segments.reduce((a, s) => a + s.frames.length, 0)} frames -> ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
