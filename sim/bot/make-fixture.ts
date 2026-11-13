// ============================================================
// Turn a debug bundle from a live session into a regression fixture:
//   npx tsx sim/bot/make-fixture.ts <bundle.json> <out.json>
//
// Player names, player ids and the table id are replaced by placeholders, the
// browser string is dropped, and only what a replay needs is kept per frame:
// the observation (minus raw button texts) and the live decision state.
// The observations themselves are not altered.
// ============================================================

import * as fs from 'fs';
import { anonymiseBundle, parseBundle } from '../../src/bot/diag/recorder';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: npx tsx sim/bot/make-fixture.ts <bundle.json> <out.json>'); process.exit(2); }
const b = anonymiseBundle(parseBundle(JSON.parse(fs.readFileSync(src, 'utf8'))));
const fixture = {
  format: b.format, version: b.version, source: 'live PokerNow session, recommendation-only, names and table id replaced',
  recordedWith: b.build.extensionVersion, exportedAt: b.exportedAt,
  hands: b.hands.map((h) => ({
    handKey: h.handKey, firstWall: 0, lastWall: 0, startsAtHandStart: h.startsAtHandStart,
    frames: h.frames.map((f) => {
      const obs = { ...f.obs };
      delete obs.raw;
      return { n: f.n, obs, liveDecision: f.decision.state, livePredictedActor: f.tracker.predictedActor, livePhase: f.tracker.phase };
    }),
  })),
};
fs.writeFileSync(out, JSON.stringify(fixture));
console.log(`${fixture.hands.length} hands, ${fixture.hands.reduce((a, h) => a + h.frames.length, 0)} frames -> ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
