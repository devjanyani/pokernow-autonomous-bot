// Quick look at version 3 against version 2 on a few hand-built spots (development aid; prints decisions and timings).
//   npx tsx sim/bot/v3-smoke.ts [--samples 600]
import { BotAgent } from '../../src/bot/agent';
import { buildSpot } from './scenarios';

const argN = (f: string, d: number) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const SPOTS: { name: string; spot: Parameters<typeof buildSpot>[0] }[] = [
  { name: 'BB, set of fives on K-9-5 rainbow vs button c-bet range (checked to Hero first)', spot: { players: 6, hero: 'BB', cards: '5c 5d', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9d 5s:'] } },
  { name: 'BB, bottom pair 5c4c on K-9-5', spot: { players: 6, hero: 'BB', cards: '5c 4c', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9d 5s:'] } },
  { name: 'BB, flush draw + gutshot on K-9-5 two-tone', spot: { players: 6, hero: 'BB', cards: 'Qs Js', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Ks 9d 5s:'] } },
  { name: 'BB facing a c-bet with top pair weak kicker', spot: { players: 6, hero: 'BB', cards: 'Kc 4c', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9d 5s: BB x, BTN b2'] } },
  { name: 'BTN c-bets, BB check-raises; Hero (BTN) has an overpair', spot: { players: 6, hero: 'BTN', cards: 'Qd Qc', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9d 5s: BB x, BTN b2, BB r7'] } },
  { name: 'BTN in position, checked to, air', spot: { players: 6, hero: 'BTN', cards: '7d 6d', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9c 2s: BB x'] } },
  { name: 'River, BB bluff-catcher facing a pot bet', spot: { players: 6, hero: 'BB', cards: '9h 8h', lines: ['UTG f, HJ f, CO f, BTN r2.5, SB f, BB c', 'Kh 9d 5s: BB x, BTN x', '2c: BB x, BTN x', '3d: BB x, BTN b5.5'] } },
];

async function main(): Promise<void> {
  const samples = argN('samples', 600);
  for (const { name, spot } of SPOTS) {
    let b;
    try { b = buildSpot(spot); } catch (e) { console.log(`\n## ${name}\n  cannot build: ${(e as Error).message}`); continue; }
    console.log(`\n## ${name}`);
    for (const engine of ['v2', 'v3'] as const) {
      const t0 = performance.now();
      const d = new BotAgent({ seed: 5, engine }).decideSync(b.h, b.heroSeat, b.heroCards, samples);
      const ms = performance.now() - t0;
      console.log(`  ${engine}: ${d.label}  (${ms.toFixed(0)} ms)  ${d.candidates.map((c) => `${c.label} ${c.ev === null ? '-' : c.ev.toFixed(2)}`).join(' | ')}`);
      if (engine === 'v3') for (const l of d.basis.slice(1)) console.log(`      ${l.slice(0, 260)}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
