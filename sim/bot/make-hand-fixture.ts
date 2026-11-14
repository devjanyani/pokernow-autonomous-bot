// ============================================================
// Turn the hand records of real debug bundles into an anonymised fixture of
// replayable hands for the strategy tests.
//
//   npx tsx sim/bot/make-hand-fixture.ts <out.json> <label=bundle.json> [<label=bundle.json> ...]
//
// Kept: blinds, seats (as P<n>), positions, stacks, the recorded actions, the
// board and Hero's own cards. Dropped: names, player ids, table ids, hand ids,
// timestamps and every other field. Only hands the rules engine can replay from
// the first action and in which Hero held cards are kept.
// ============================================================
import * as fs from 'fs';
import { anonymiseRecord, rebuildHand, RecordedHand } from '../../src/bot/diag/rebuild';

const [out, ...inputs] = process.argv.slice(2);
if (!out || inputs.length === 0) { console.error('usage: make-hand-fixture <out.json> <label=bundle.json> ...'); process.exit(2); }
const hands: RecordedHand[] = [];
for (const spec of inputs) {
  const [label, file] = spec.split('=');
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { handRecords?: (RecordedHand & { valid?: boolean })[] };
  for (const rec of data.handRecords ?? []) {
    if (rec.heroSeat === null || !rec.heroCards || rec.heroCards.length !== 2) continue;
    const n = rec.handId.split(':')[2] ?? String(hands.length);
    const anon = anonymiseRecord(rec, `${label}-${n}`);
    try { rebuildHand(anon); } catch { continue; }
    if (hands.some((h) => h.handId === anon.handId)) continue;
    hands.push(anon);
  }
}
fs.writeFileSync(out, JSON.stringify({ note: 'Anonymised hand records from real recommend-mode sessions (2026-11-13). Player-visible information only.', hands }, null, 0) + '\n');
console.log(`${hands.length} hands written to ${out}`);
