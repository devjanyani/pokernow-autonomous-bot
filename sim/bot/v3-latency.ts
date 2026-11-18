// Live-path latency of version 3 against version 2: the anytime decide() with a 20-second action clock, as the
// extension calls it (time budget, stopping rule, deal cap). Development measurement.
//   npx tsx sim/bot/v3-latency.ts
import { BotAgent } from '../../src/bot/agent';
import { buildSpot } from './scenarios';

const spots = [
  { players: 6, hero: 'BB', cards: '5c 5d', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9d 5s:'] },
  { players: 6, hero: 'BB', cards: 'Qs Js', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Ks 9d 5s:'] },
  { players: 6, hero: 'BB', cards: 'Kc 4c', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9d 5s: BB x, BTN b2'] },
  { players: 6, hero: 'BTN', cards: '7d 6d', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9c 2s: BB x'] },
  { players: 6, hero: 'BB', cards: 'Ah Qh', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9d 5s: BB x, BTN b2, BB c', '2c: BB x, BTN x', '7h:'] },
];
async function main(): Promise<void> {
  for (const sp of spots) {
    const b = buildSpot(sp);
    const row: string[] = [];
    for (const engine of ['v2', 'v3'] as const) {
      const t0 = performance.now();
      const d = await new BotAgent({ seed: 3, engine }).decide(b.h, b.heroSeat, b.heroCards, { timeRemainingMs: 20000 });
      row.push(`${engine}: ${d.label} in ${(performance.now() - t0).toFixed(0)} ms, ${d.samples} deals`);
    }
    console.log(`${sp.cards} | ${sp.lines.slice(1).join(' / ')} :: ${row.join(' ; ')}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
