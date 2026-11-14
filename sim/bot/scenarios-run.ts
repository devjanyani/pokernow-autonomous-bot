// ============================================================
// Run the decision scenarios against both engines and print the comparison.
//
//   npm run bot:scenarios [-- --samples 3000] [--md reports/scenarios.md] [--verbose]
//
// Version 1 is the engine as it was at 0.5.1; version 2 is the current one.
// Solver references are compared only when an imported strategy pack supplies
// them; none ship with the repository.
// ============================================================

import * as fs from 'fs';
import { cardsStr } from '../../src/bot/cards';
import { defaultLibrary } from '../../src/bot/strategy/library/builtin';
import { potTotal } from '../../src/bot/table/engine';
import type { Decision } from '../../src/bot/strategy/types';
import { betFrequency, runScenarios, SCENARIOS } from './scenarios';

const arg = (f: string) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const samples = Number(arg('samples') ?? 3000);
const out: string[] = [];
const say = (s = '') => { out.push(s); console.log(s); };
const show = (d: Decision) => `${d.label}${betFrequency(d) > 0.005 && betFrequency(d) < 0.995 ? ` (bets ${(100 * betFrequency(d)).toFixed(0)}%)` : ''}`;
const evs = (d: Decision) => d.candidates.map((c) => `${c.label} ${c.ev === null ? 'n/a' : c.ev.toFixed(1)}`).join(', ');

const v1 = runScenarios('v1', samples), v2 = runScenarios('v2', samples);
const refs = new Map(defaultLibrary().packs.flatMap((p) => (p.references ?? []).map((r) => [r.scenario, { r, pack: p.name }] as const)));

say(`# Decision scenarios`);
say();
say(`${SCENARIOS.length} scenarios, ${samples} Monte Carlo deals per postflop decision, blinds 10/20. EV in chips relative to folding.`);
say(`Solver references available: ${refs.size} of ${SCENARIOS.length}${refs.size === 0 ? ' (none imported; see docs/bot/STRATEGY_LIBRARY.md for the data needed)' : ''}.`);
say();
for (const set of ['design', 'held-out'] as const) {
  say(`## ${set === 'design' ? 'Design set (looked at while changing the engine)' : 'Held-out set (written afterwards, not used for tuning)'}`);
  say();
  say(`| Scenario | Board, hand, pot | Version 1 | Version 2 | Properties (v1) | Properties (v2) | Solver reference |`);
  say(`|---|---|---|---|---|---|---|`);
  v2.forEach((r, i) => {
    if (r.scenario.set !== set) return;
    const p1 = v1[i].checks.filter((c) => c.kind === 'property'), p2 = r.checks.filter((c) => c.kind === 'property');
    const ref = refs.get(r.scenario.id);
    say(`| ${r.scenario.title} | ${cardsStr(r.built.h.board) || 'preflop'}, ${cardsStr(r.built.heroCards)}, ${potTotal(r.built.h)} | ${show(v1[i].decision)} | ${show(r.decision)} | ${p1.filter((c) => c.pass).length}/${p1.length} | ${p2.filter((c) => c.pass).length}/${p2.length} | ${ref ? Object.entries(ref.r.frequencies).map(([a, f]) => `${a} ${(100 * f).toFixed(0)}%`).join(', ') : 'none'} |`);
  });
  say();
}
const fails = (rs: typeof v2, kind = 'property') => rs.flatMap((r) => r.checks.filter((c) => c.kind === kind && !c.pass).map((c) => `- ${r.scenario.id}: ${c.text}`));
const tot = (rs: typeof v2, kind = 'property') => rs.reduce((a, r) => a + r.checks.filter((c) => c.kind === kind).length, 0);
say(`## Property checks`);
say();
say(`Version 1: ${tot(v1) - fails(v1).length} of ${tot(v1)} hold. Version 2: ${tot(v2) - fails(v2).length} of ${tot(v2)} hold.`);
say();
say(`Failed under version 1:`);
say(fails(v1).join('\n') || '- none');
say();
say(`Failed under version 2:`);
say(fails(v2).join('\n') || '- none');
say();
say(`## Observations (plausible comparisons that are not theorems; reported, not asserted)`);
say();
say(`Version 1: ${tot(v1, 'observation') - fails(v1, 'observation').length} of ${tot(v1, 'observation')} hold. Version 2: ${tot(v2, 'observation') - fails(v2, 'observation').length} of ${tot(v2, 'observation')} hold.`);
say();
say(`Not holding under version 2:`);
say(fails(v2, 'observation').join('\n') || '- none');
if (process.argv.includes('--verbose')) {
  say();
  say(`## Detail (version 2)`);
  for (const r of v2) {
    say();
    say(`### ${r.scenario.id}: ${r.scenario.title}`);
    say(`- v1: ${evs(v1[v2.indexOf(r)].decision)}`);
    say(`- v2: ${evs(r.decision)}`);
    for (const b of r.decision.basis) say(`  - ${b}`);
    for (const c of r.checks) say(`- ${c.kind} ${c.pass ? 'holds' : 'DOES NOT HOLD'}: ${c.text}`);
  }
}
const md = arg('md');
if (md) { fs.writeFileSync(md, out.join('\n') + '\n'); console.log(`\nwrote ${md}`); }
