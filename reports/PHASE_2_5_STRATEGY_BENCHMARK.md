# Phase 2.5 strategy benchmark: empirical opponent learning in version 3

Configurations, all with the same decks (duplicate rotation, paired by deal), 2,000 hands per table, blinds 10/20, 100 bb,
400 samples per decision, no rake (`sim/bot/phase23-bench.ts`, tables `sim/bot/phase23-report.ts`):

| Name | Engine |
|---|---|
| v2 | production version 2 (unchanged) |
| v3 | version 3 as at 0.8.1 |
| v3p | v3 with the population calibration fitted to real hands (model D, `src/bot/strategy/v3/population-calibration.json`) |
| v3r | v3 with the river betting-range estimator (`src/bot/strategy/v3/river-range-calibration.json`) |
| v3pr | both |

Opponents: the 14 heads-up benchmark programs: four archetypes, nine simple and independent programs, and version 2's
own model. **They are programs, not people.** The corrections were fitted to people (2009 online cash games), so a
better fit to people need not help, and could hurt, against them. Better probability prediction (reports/PHASE_2_5_CALIBRATION.md)
is a different claim from stronger play.

**Seeds fixed before any run:** 13100 = evaluation set A; 13300 = final set; 13150 = per-decision reference evaluation.
Nothing was changed after set A was seen.

**Final set not completed.** The seed 13300 run (and the seed 13150 reference evaluation) was stopped by Claude Code
because the machine ran low on memory, before any table finished; the orphaned processes were then stopped. Seed 13300
therefore remains untouched and is the set to use for the final check (`npm run bot:phase25 -- --bench --seed 13300 --jobs 1`).

## Evaluation set A (seed 13100)

| Table | Opponents | Hands | v2 | v3 | v3p | v3r | v3pr | v3 − v2 | v3p − v3 | v3r − v3 | v3pr − v3 | v3pr − v2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| hu-tag | tight-aggressive | 2000 | +51.7 ± 37.1 * | +41.6 ± 44.0 | +49.2 ± 40.9 * | +44.5 ± 43.2 * | +62.1 ± 45.3 * | -10.1 ± 31.6 | +7.6 ± 21.8 | +2.9 ± 16.4 | +20.5 ± 27.4 | +10.4 ± 31.5 |
| hu-lag | loose-aggressive | 2000 | +91.6 ± 47.4 * | +94.4 ± 60.0 * | +79.2 ± 58.9 * | +88.3 ± 60.4 * | +69.9 ± 53.7 * | +2.7 ± 40.6 | -15.2 ± 38.5 | -6.0 ± 25.1 | -24.4 ± 37.9 | -21.7 ± 40.9 |
| hu-tight-passive | tight-passive | 2000 | +43.5 ± 30.6 * | +18.7 ± 43.2 | +38.0 ± 39.5 | +19.8 ± 42.8 | +31.0 ± 41.8 | -24.8 ± 31.7 | +19.3 ± 23.7 | +1.1 ± 10.4 | +12.2 ± 25.3 | -12.5 ± 31.0 |
| hu-loose-passive | loose-passive | 2000 | +94.1 ± 55.5 * | +87.4 ± 60.6 * | +92.2 ± 64.2 * | +82.5 ± 61.1 * | +81.3 ± 63.9 * | -6.6 ± 33.7 | +4.8 ± 31.8 | -5.0 ± 6.0 | -6.1 ± 29.7 | -12.7 ± 39.6 |
| hu-station | calling-station | 2000 | +1093.2 ± 118.7 * | +1118.0 ± 123.2 * | +1162.7 ± 121.7 * | +1118.0 ± 123.2 * | +1162.7 ± 121.7 * | +24.7 ± 44.1 | +44.8 ± 33.6 * | +0.0 ± 0.0 | +44.8 ± 33.6 * | +69.5 ± 37.9 * |
| hu-maniac | maniac | 2000 | +340.5 ± 112.3 * | +325.8 ± 114.0 * | +308.0 ± 111.1 * | +310.8 ± 114.4 * | +302.3 ± 110.3 * | -14.7 ± 78.5 | -17.8 ± 51.1 | -15.0 ± 20.0 | -23.5 ± 53.1 | -38.2 ± 82.0 |
| hu-raiser | raiser | 2000 | +79.8 ± 49.5 * | +77.8 ± 54.3 * | +44.2 ± 50.3 | +74.6 ± 54.4 * | +42.8 ± 51.0 | -1.9 ± 30.4 | -33.6 ± 36.3 | -3.2 ± 3.6 | -35.1 ± 38.3 | -37.0 ± 42.0 |
| hu-trapper | trapper | 2000 | +114.6 ± 55.0 * | +105.0 ± 52.6 * | +125.9 ± 57.3 * | +112.4 ± 53.6 * | +125.3 ± 55.9 * | -9.5 ± 25.9 | +20.9 ± 32.4 | +7.4 ± 16.0 | +20.2 ± 30.5 | +10.7 ± 33.7 |
| hu-mdf | mdf-defender | 2000 | +81.4 ± 43.9 * | +87.3 ± 48.8 * | +88.0 ± 48.9 * | +86.9 ± 48.8 * | +87.0 ± 49.0 * | +6.0 ± 20.2 | +0.7 ± 12.8 | -0.4 ± 0.8 | -0.3 ± 12.7 | +5.6 ± 21.9 |
| hu-punisher | adaptive-punisher | 2000 | +142.0 ± 58.3 * | +135.7 ± 58.8 * | +154.3 ± 63.8 * | +135.0 ± 58.8 * | +149.6 ± 63.9 * | -6.2 ± 34.1 | +18.6 ± 25.1 | -0.8 ± 12.2 | +13.9 ± 25.1 | +7.6 ± 33.5 |
| hu-caller | pot-odds-caller | 2000 | +248.4 ± 67.5 * | +243.9 ± 69.9 * | +251.3 ± 71.1 * | +241.3 ± 69.7 * | +247.8 ± 71.6 * | -4.6 ± 29.7 | +7.4 ± 21.8 | -2.6 ± 5.5 | +4.0 ± 24.0 | -0.6 ± 31.3 |
| hu-nit | nit | 2000 | -4.3 ± 37.4 | -11.4 ± 39.3 | +3.1 ± 36.5 | -11.4 ± 39.3 | +1.1 ± 37.5 | -7.1 ± 34.8 | +14.5 ± 20.4 | +0.0 ± 0.0 | +12.5 ± 24.8 | +5.4 ± 30.3 |
| hu-re | range-equity | 2000 | +36.8 ± 27.1 * | +36.0 ± 39.6 | +27.4 ± 33.1 | +39.6 ± 38.5 * | +26.2 ± 33.3 | -0.8 ± 31.8 | -8.6 ± 29.4 | +3.6 ± 7.1 | -9.8 ± 28.9 | -10.6 ± 20.4 |
| hu-ra | range-aware | 2000 | +40.8 ± 21.1 * | +70.0 ± 50.1 * | +43.5 ± 31.7 * | +52.4 ± 48.9 * | +43.1 ± 31.7 * | +29.2 ± 45.1 | -26.4 ± 44.4 | -17.6 ± 35.0 | -26.9 ± 44.4 | +2.3 ± 28.8 |

**Pooled by opponent family** (equal weight per table; interval from the tables' own standard errors, which are independent):

| Family | Tables | v3 − v2 | v3p − v3 | v3r − v3 | v3pr − v3 | v3pr − v2 |
|---|---|---|---|---|---|---|
| archetypes (version 1 model) | 4 | -9.7 ± 17.3 | +4.1 ± 14.8 | -1.7 ± 8.1 | +0.6 ± 15.2 | -9.1 ± 18.0 |
| simple and independent | 9 | -1.6 ± 13.3 | +5.2 ± 10.3 | -1.2 ± 3.3 | +3.0 ± 10.6 | +1.4 ± 13.6 |
| version 2 model | 1 | +29.2 ± 45.1 | -26.4 ± 44.4 | -17.6 ± 35.0 | -26.9 ± 44.4 | +2.3 ± 28.8 |
| all heads-up | 14 | -1.7 ± 10.4 | +2.6 ± 8.5 | -2.5 ± 4.0 | +0.1 ± 8.7 | -1.6 ± 10.4 |
| all heads-up except version 2 model | 13 | -4.1 ± 10.6 | +4.9 ± 8.5 | -1.4 ± 3.4 | +2.2 ± 8.7 | -1.9 ± 10.9 |

**What each engine did after the flop** (bets when checked to / folds facing a bet / raises facing a bet / check-raises when possible, with the number of check-raise chances):

| Table | v2 | v3 | v3p | v3r | v3pr |
|---|---|---|---|---|---|
| hu-tag | 62% / 73% / 10% / 4% (158) | 58% / 55% / 20% / 26% (209) | 61% / 59% / 17% / 24% (188) | 58% / 56% / 19% / 23% (202) | 61% / 59% / 18% / 26% (188) |
| hu-lag | 69% / 65% / 15% / 6% (164) | 57% / 46% / 22% / 33% (248) | 59% / 47% / 24% / 36% (254) | 57% / 46% / 22% / 31% (253) | 59% / 48% / 25% / 40% (250) |
| hu-tight-passive | 51% / 72% / 12% / 4% (142) | 54% / 62% / 18% / 15% (147) | 56% / 63% / 18% / 11% (136) | 54% / 61% / 18% / 15% (147) | 55% / 60% / 19% / 13% (138) |
| hu-loose-passive | 43% / 69% / 14% / 1% (250) | 47% / 58% / 17% / 12% (263) | 48% / 59% / 16% / 9% (246) | 47% / 57% / 17% / 12% (263) | 49% / 58% / 16% / 10% (246) |
| hu-station | 50% / – / – / – (0) | 52% / – / – / – (0) | 54% / – / – / – (0) | 52% / – / – / – (0) | 54% / – / – / – (0) |
| hu-maniac | 58% / 62% / 19% / 4% (297) | 38% / 48% / 20% / 21% (493) | 38% / 47% / 19% / 21% (526) | 38% / 47% / 20% / 21% (495) | 37% / 47% / 19% / 21% (528) |
| hu-raiser | 54% / 70% / 13% / 0% (31) | 45% / 51% / 11% / 3% (36) | 48% / 52% / 13% / 8% (36) | 45% / 48% / 10% / 3% (36) | 48% / 49% / 14% / 8% (37) |
| hu-trapper | 47% / 68% / 10% / 0% (61) | 51% / 60% / 10% / 4% (48) | 51% / 59% / 10% / 6% (52) | 51% / 57% / 12% / 4% (50) | 51% / 58% / 9% / 6% (51) |
| hu-mdf | 47% / 73% / 14% / 0% (36) | 50% / 66% / 17% / 10% (30) | 52% / 66% / 18% / 6% (31) | 50% / 66% / 17% / 10% (30) | 52% / 66% / 18% / 6% (31) |
| hu-punisher | 47% / 70% / 14% / 0% (55) | 49% / 65% / 15% / 4% (54) | 50% / 62% / 13% / 2% (50) | 48% / 65% / 14% / 4% (55) | 50% / 61% / 14% / 2% (50) |
| hu-caller | 49% / 73% / 14% / 0% (97) | 51% / 67% / 15% / 0% (99) | 53% / 66% / 16% / 0% (91) | 51% / 66% / 15% / 0% (99) | 53% / 66% / 16% / 0% (91) |
| hu-nit | 89% / 55% / 30% / 8% (12) | 63% / 44% / 15% / 35% (17) | 77% / 44% / 15% / 40% (15) | 63% / 44% / 15% / 35% (17) | 77% / 43% / 16% / 36% (14) |
| hu-re | 72% / 77% / 12% / 9% (32) | 60% / 60% / 15% / 16% (37) | 66% / 70% / 12% / 9% (35) | 60% / 60% / 14% / 14% (37) | 66% / 69% / 12% / 9% (35) |
| hu-ra | 82% / 83% / 9% / 11% (54) | 50% / 18% / 57% / 77% (228) | 74% / 49% / 33% / 61% (98) | 57% / 23% / 49% / 72% (182) | 74% / 48% / 33% / 61% (98) |

Version 3 postflop decision time in the simulator (400 deals, no sensitivity pass): median of table medians 69 ms; largest 95th percentile 149 ms.

## Reading

- No candidate is significantly better or worse than v3 pooled over the 14 tables: population calibration +2.6 ± 8.5,
  river range −2.5 ± 4.0, both +0.1 ± 8.7 bb/100. Both against v2: −1.6 ± 10.4.
- The one significant table is v3p against the calling station (+44.8 ± 33.6): the calibrated model predicts fewer
  folds, so version 3 bluffs less into a player who never folds. One table in 56 comparisons is about what chance gives.
- The river-range tilt changes few decisions in these games (river bets faced heads-up are rare, and the programs' river
  ranges are not people's): its differences are small at every table (largest −17.6 ± 35.0).
- Solver references (`reports/phase25-solver-spots.md`, seven river spots, true ranges given): v2 0.22 ± 0.07,
  v3 0.24 ± 0.08, v3p 0.22 ± 0.08 bb per decision lost; v3p in the solution's support 86% ± 4 (v3 83%). On the condensed
  river lead v3p stops version 3's all-in bluffs (0% against 55%) and folds 48% like v2.
- Latency: the corrections add a table lookup per opponent node and one range re-weighting per river decision; median
  postflop decision times in the simulator are in the tables above.
