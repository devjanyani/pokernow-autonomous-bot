// ============================================================
// Cash-game session analysis (Phase 2.3, stage 7).
//
//   npx tsx sim/bot/cash-session.ts <bundle.json> [--split 0.6] [--samples 1500] [--out report.md]
//
// 1. Hands: the stored hand records that are valid and observed to the end are rebuilt with the rules engine.
// 2. Split by time: the first `split` share of those hands is the CALIBRATION part (opponent statistics are
//    counted there), the rest is the EVALUATION part (only looked at, never counted into a statistic).
// 3. Calibration counts: every opponent action after the flop, by situation, through the Phase 2.2
//    calibration framework (sim/bot/data/calibration.ts), and every profile statistic with its opportunities.
//    Hero's own actions are excluded. Hole cards are used only where they were shown.
// 4. Hero decisions after the flop: classified (check-raise opportunity, facing a raise, delayed aggression,
//    river bluff-catch, weak pair betting, unusual opponent size, large pot) and re-run with version 2 and
//    version 3, each with opponent profiles built ONLY from hands that finished before the decision, as a
//    live session would have them. Hero's actual action and the recommendation stored at the time are listed.
//    No decision is judged by the result of the hand.
//
// Output is anonymised: positions and cards, never names or the table id.
// ============================================================

import * as fs from 'fs';
import { BotAgent } from '../../src/bot/agent';
import { cardsStr, comboIndex, parseCardStrict } from '../../src/bot/cards';
import { evaluateHand } from '../../src/core/equity/hand-eval';
import { rebuildHand, RecordedHand, recordedHeroCards } from '../../src/bot/diag/rebuild';
import type { HandRecord, DecisionRecord } from '../../src/bot/ext/records';
import { applyHandToProfiles, PlayerProfile, posterior, PRIORS, STAT_KEYS, StatKey } from '../../src/bot/opponents/profile';
import { computeFeatures } from '../../src/bot/ranges/postflop-model';
import type { Decision } from '../../src/bot/strategy/types';
import { completeHand, HandState, potTotal } from '../../src/bot/table/engine';
import { calibrationTable, countHand, newCounts } from './data/calibration';

const argS = (f: string, d: string) => { const i = process.argv.indexOf(`--${f}`); return i >= 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
if (!file) { console.error('usage: npx tsx sim/bot/cash-session.ts <bundle.json> [--split 0.6] [--samples 1500] [--out report.md]'); process.exit(2); }
const split = Number(argS('split', '0.6')), samples = Number(argS('samples', '1500'));
const b = JSON.parse(fs.readFileSync(file, 'utf8')) as { handRecords: HandRecord[]; decisions: DecisionRecord[] };
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;

interface Built { rec: HandRecord; h: HandState }
const usable: Built[] = [];
let rejected = 0;
for (const rec of [...b.handRecords].sort((x, y) => x.ts - y.ts)) {
  if (!rec.valid || !rec.observedToEnd) { rejected++; continue; }
  try {
    const h = rebuildHand(rec as unknown as RecordedHand);
    // A hand that reached showdown is settled from the cards shown (a hand not shown ranks below every shown hand),
    // so that it counts in the statistics. Without this every showdown hand would be left out of the profiles.
    if (h.phase === 'showdown') {
      const shown = new Map(rec.seats.filter((x) => x.shown && x.shown.length === 2).map((x) => [x.seat, x.shown!.map((cc) => parseCardStrict(cc) as number)]));
      completeHand(h, (seat) => { const cc = shown.get(seat); return cc && h.board.length === 5 ? evaluateHand([...cc, ...h.board]) : 0; });
    }
    usable.push({ rec, h });
  } catch { rejected++; }
}
const cut = Math.floor(split * usable.length);
const calib = usable.slice(0, cut), evalPart = usable.slice(cut);
const revealsOf = (r: HandRecord) => new Map(r.seats.filter((x) => x.shown && x.shown.length === 2 && x.seat !== r.heroSeat).map((x) => [x.seat, x.shown!.map((cc) => parseCardStrict(cc) as number) as [number, number]]));
const heroId = (r: HandRecord) => r.seats.find((s) => s.seat === r.heroSeat)?.playerId;

// ---- calibration counts ----
const counts = newCounts();
const profiles = new Map<string, PlayerProfile>();
for (const { rec, h } of calib) {
  countHand(counts, h, heroId(rec));
  applyHandToProfiles(profiles, h, revealsOf(rec), rec.ts);
}
const heroIds = new Set(usable.map((u) => heroId(u.rec)).filter(Boolean) as string[]);
const opp = [...profiles.values()].filter((p) => !heroIds.has(p.playerId));
const L: string[] = [];
L.push('## Cash-game session: decisions and calibration data', '',
  `Hands in the bundle: ${b.handRecords.length}; valid and observed to the end, rebuilt by the rules engine: ${usable.length}; left out: ${rejected}.`,
  `Calibration part (first ${pct(split)} by time): ${calib.length} hands. Evaluation part: ${evalPart.length} hands, never counted into a statistic.`,
  `Opponents with a profile from the calibration part: ${opp.length}; hands per opponent: ${opp.map((p) => p.hands).sort((a, b) => b - a).join(', ')}.`, '');

L.push('### Opportunities per statistic (opponents only, calibration part)', '',
  'Pooled = all opponents together. "Players with 30+" = players with at least 30 opportunities of their own, the level at which version 3 moves a knob about 60% of the way to the player\'s own estimate.', '',
  '| Statistic | Pooled: did / chances | Pooled estimate (90% interval) | Assumed (population prior) | Players with 30+ chances | Enough to calibrate? |', '|---|---|---|---|---|---|');
const keys: StatKey[] = ['vpip', 'pfr', 'threeBet', 'fourBet', 'foldTo3Bet', 'cbetFlop', 'cbetTurn', 'foldToCbetFlop', 'foldToCbetTurn', 'checkRaise', 'foldToCheckRaise', 'foldVsRaise', 'reraiseVsRaise',
  'raiseVsBetFlop', 'raiseVsBetTurn', 'raiseVsBetRiver', 'foldVsBetFlop', 'foldVsBetTurn', 'foldVsBetRiver', 'callVsBetRiver', 'betWhenCheckedToFlop', 'betWhenCheckedToTurn', 'betWhenCheckedToRiver', 'aggFreq', 'wtsd', 'wsd'];
for (const k of keys) {
  if (!STAT_KEYS.includes(k)) continue;
  let n = 0, d = 0, enough = 0;
  for (const p of opp) { n += p.stats[k].n; d += p.stats[k].d; if (p.stats[k].d >= 30) enough++; }
  const pooled = { ...profiles.values().next().value!, stats: { ...profiles.values().next().value!.stats, [k]: { n, d } } } as PlayerProfile;
  const q = posterior(pooled, k);
  const verdict = d >= 150 ? 'population: yes' : d >= 50 ? 'population: rough' : 'no';
  L.push(`| ${k} | ${n} / ${d} | ${d ? `${pct(q.mean)} (${pct(q.lo)}–${pct(q.hi)})` : '–'} | ${pct(PRIORS[k].mean)} | ${enough} | ${verdict}${enough ? `; per player: ${enough}` : '; per player: no'} |`);
}
L.push('', 'Bet sizes after the flop (opponents, calibration part): ' + (() => {
  const s = [0, 0, 0, 0];
  for (const p of opp) for (let i = 0; i < 4; i++) s[i] += p.betSizes[i];
  const t = s.reduce((a, x) => a + x, 0);
  return t ? `${t} bets: under 40% of the pot ${pct(s[0] / t)}, 40-70% ${pct(s[1] / t)}, 70-110% ${pct(s[2] / t)}, over 110% ${pct(s[3] / t)}` : 'none';
})(), '');

L.push('### Response frequencies by situation (calibration framework, opponents, calibration part)', '',
  'Each row compares what was counted with the engine\'s present assumption for the same thing. "Outside" = the assumption lies outside the 90% interval of the observed frequency, after shrinkage toward it.', '',
  '| Situation | Action | Observed | Estimate (90% interval) | Assumption | Outside? |', '|---|---|---|---|---|---|');
for (const r of calibrationTable(counts, 'cash session, calibration part')) {
  const e = r.estimate, p = e.population!;
  L.push(`| ${r.situation.replace(/\|/g, ' ')} | ${r.action} | ${p.n} of ${p.d} | ${pct(e.mean)} (${pct(e.lo)}–${pct(e.hi)}) | ${pct(e.assumption.mean)} | ${r.assumptionOutsideInterval ? 'yes' : 'no'} |`);
}
L.push('');

// ---- Hero decisions ----
interface Row { part: string; hand: string; street: string; pos: string; cards: string; board: string; potBB: number; facing: string; tags: string[]; actual: string; stored: string; v2: string; v3: string; v3Engine: string; v3Plan: string }
const rows: Row[] = [];
const live = new Map<string, PlayerProfile>();
const decisionsAt = (r: HandRecord, seq: number) => b.decisions.filter((x) => x.handId === r.handId && x.eventCount === seq).sort((x, y) => x.ts - y.ts).pop();
const label = (d: Decision) => d.label;
let idx = 0;
for (const { rec, h: full } of usable) {
  idx++;
  const part = idx <= cut ? 'calibration' : 'evaluation';
  const hero = recordedHeroCards(rec as unknown as RecordedHand);
  if (rec.heroSeat !== null && hero) {
    for (const e of rec.events) {
      if (e.seat !== rec.heroSeat || e.kind.startsWith('post') || e.street === 'preflop') continue;
      let h: HandState;
      try { h = rebuildHand(rec as unknown as RecordedHand, e.seq); } catch { break; }
      if (h.toAct !== rec.heroSeat) continue;
      const bb = h.bigBlind, pot = potTotal(h);
      const evs = h.events.filter((x) => x.street === h.street && !x.kind.startsWith('post'));
      const hs = h.seats.find((s) => s.seat === rec.heroSeat)!;
      const facing = h.currentBet - hs.streetCommit;
      const tags: string[] = [];
      const heroChecked = evs.some((x) => x.seat === rec.heroSeat && x.kind === 'check');
      if (facing > 0 && heroChecked) tags.push('check-raise opportunity');
      if (facing > 0 && evs.some((x) => x.seat === rec.heroSeat && (x.kind === 'bet' || x.kind === 'raise'))) tags.push('Hero\'s bet was raised');
      const preRaiser = h.aggressor.preflop;
      if (preRaiser === rec.heroSeat && h.street !== 'flop' && h.aggressor.flop === null && facing === 0) tags.push('delayed aggression opportunity');
      if (h.street === 'river' && facing > 0) tags.push('river bluff-catch');
      if (facing > 0) { const lastBet = [...evs].reverse().find((x) => x.kind === 'bet' || x.kind === 'raise'); if (lastBet) { const f = lastBet.amount / Math.max(1e-9, lastBet.potBefore); if (f > 1.2 || f < 0.25) tags.push(`unusual opponent size (${pct(f)} of the pot)`); } }
      const f = computeFeatures(h.board);
      const k = comboIndex(hero[0], hero[1]);
      if (f.hs[k] > 0.45 && f.hs[k] < 0.75 && (e.kind === 'bet' || e.kind === 'raise')) tags.push('Hero bet a middling made hand');
      if (pot / bb >= 40) tags.push('large pot');
      const players = h.seats.filter((s) => s.dealtIn && !s.folded).length;
      if (players > 2) tags.push(`multiway (${players})`);
      const stored = decisionsAt(rec, e.seq);
      const a2 = new BotAgent({ seed: 7, engine: 'v2' }), a3 = new BotAgent({ seed: 7, engine: 'v3' });
      for (const [kk, p] of live) { a2.profiles.set(kk, p); a3.profiles.set(kk, p); }
      const d2 = a2.decideSync(h, rec.heroSeat, hero, samples), d3 = a3.decideSync(h, rec.heroSeat, hero, samples);
      const close = /close/.test(d2.uncertainty) ? ' (close)' : '';
      rows.push({
        part, hand: rec.handId.split(':')[2] ?? '?', street: h.street, pos: hs.pos?.label ?? '?', cards: cardsStr(hero), board: cardsStr(h.board), potBB: pot / bb,
        facing: facing > 0 ? `${(facing / bb).toFixed(1)} bb` : '–', tags, actual: `${e.kind}${e.kind === 'bet' || e.kind === 'raise' ? ` ${(e.to / bb).toFixed(1)} bb` : ''}`,
        stored: stored ? label(stored.decision) : '–', v2: label(d2) + close, v3: label(d3), v3Engine: d3.engine ?? 'v2',
        v3Plan: d3.basis.find((x) => x.startsWith('plan after')) ?? '',
      });
    }
  }
  applyHandToProfiles(live, full, revealsOf(rec), rec.ts);
}
const tagCount = new Map<string, number>();
for (const r of rows) for (const t of r.tags) { const key = t.replace(/\(.*\)/, '').trim(); tagCount.set(key, (tagCount.get(key) ?? 0) + 1); }
const v3rows = rows.filter((r) => r.v3Engine === 'v3');
const kindOf = (s: string) => s.split(' ')[0];
L.push('### Hero\'s decisions after the flop', '',
  `${rows.length} decisions (${rows.filter((r) => r.part === 'calibration').length} in the calibration part, ${rows.filter((r) => r.part === 'evaluation').length} in the evaluation part). Version 3 applied to ${v3rows.length} (heads-up pots); the rest are multiway and use version 2.`,
  `Same class of action (fold / check / call / bet / raise): version 3 and version 2 ${v3rows.filter((r) => kindOf(r.v3) === kindOf(r.v2)).length} of ${v3rows.length}; Hero's actual action and version 2 now ${rows.filter((r) => kindOf(r.actual) === kindOf(r.v2)).length} of ${rows.length}; the stored recommendation and version 2 now ${rows.filter((r) => r.stored !== '–' && kindOf(r.stored) === kindOf(r.v2)).length} of ${rows.filter((r) => r.stored !== '–').length}.`, '',
  'Situations (a decision can have several):', '', ...[...tagCount].sort((a, b) => b[1] - a[1]).map(([t, n]) => `- ${t}: ${n}`), '',
  '| Part | Hand | Street | Pos | Cards | Board | Pot (bb) | Facing | Situation | Hero did | Stored then | v2 now | v3 now | v3 plan |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) L.push(`| ${r.part} | ${r.hand} | ${r.street} | ${r.pos} | ${r.cards} | ${r.board} | ${r.potBB.toFixed(1)} | ${r.facing} | ${r.tags.join('; ')} | ${r.actual} | ${r.stored} | ${r.v2} | ${r.v3Engine === 'v3' ? r.v3 : `(v2) ${r.v3}`} | ${r.v3Plan.replace(/\|/g, '/').slice(0, 160)} |`);
const out = argS('out', '');
console.log(L.join('\n'));
if (out) fs.writeFileSync(out, L.join('\n') + '\n');
