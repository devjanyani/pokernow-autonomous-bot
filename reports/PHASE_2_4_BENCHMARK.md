# Phase 2.4 benchmark (0.8.1): corrected version 3 against version 2

Setup as in Phase 2.3 (`sim/bot/phase23-bench.ts`): same decks for both engines, duplicate rotation, 2,000 hands per
table, blinds 10/20, 100 bb stacks, 400 samples per decision, no rake, bb/100 with 95% intervals, differences
paired by deal, `*` = the interval excludes 0. Preflop and multiway pots are version 2 for both engines.
Tables: `sim/bot/phase23-report.ts`. Raw lines: `phase24-bench-12700.jsonl`, `phase24-bench-12900.jsonl`.
Account: `docs/bot/PHASE_2_4_MODEL_CALIBRATION.md`. The opponents are programs; nothing here measures profit
against people.

**Seeds, fixed before any of these runs:** 12100 and 12300 are development seeds (Phase 2.3 runs, and the Phase 2.4
diagnosis and correction). 12700 = evaluation set A. 12900 = final set, run once after every decision was taken.
12750 = per-decision reference evaluations. Nothing was changed after set A was seen.

## 1. Final set: seed 12900 (untouched until the end)

| Table | Opponents | Hands | v2 | v3 | v3 − v2 |
|---|---|---|---|---|---|
| hu-tag | tight-aggressive | 2000 | +90.8 ± 46.0 * | +95.6 ± 56.1 * | +4.8 ± 38.5 |
| hu-lag | loose-aggressive | 2000 | +102.9 ± 53.9 * | +159.2 ± 68.5 * | +56.4 ± 53.2 * |
| hu-tight-passive | tight-passive | 2000 | +52.0 ± 36.9 * | +52.4 ± 41.1 * | +0.4 ± 28.0 |
| hu-loose-passive | loose-passive | 2000 | +143.1 ± 56.0 * | +127.3 ± 58.8 * | -15.8 ± 31.8 |
| hu-station | calling-station | 2000 | +1173.7 ± 122.5 * | +1204.2 ± 127.2 * | +30.5 ± 47.0 |
| hu-maniac | maniac | 2000 | +453.9 ± 116.2 * | +459.8 ± 119.9 * | +5.9 ± 76.0 |
| hu-raiser | raiser | 2000 | +91.7 ± 52.5 * | +88.6 ± 53.7 * | -3.1 ± 41.0 |
| hu-trapper | trapper | 2000 | +78.9 ± 51.0 * | +69.0 ± 55.8 * | -9.8 ± 38.0 |
| hu-mdf | mdf-defender | 2000 | +63.6 ± 44.9 * | +42.0 ± 49.1 | -21.7 ± 33.8 |
| hu-punisher | adaptive-punisher | 2000 | +149.2 ± 62.4 * | +109.4 ± 61.4 * | -39.8 ± 33.2 * |
| hu-caller | pot-odds-caller | 2000 | +289.9 ± 70.9 * | +275.1 ± 73.2 * | -14.8 ± 30.5 |
| hu-nit | nit | 2000 | +16.2 ± 33.1 | +9.7 ± 35.8 | -6.6 ± 34.0 |
| hu-re | range-equity | 2000 | +26.2 ± 34.2 | +41.5 ± 36.6 * | +15.4 ± 22.5 |
| hu-ra | range-aware | 2000 | +58.6 ± 28.9 * | +48.7 ± 39.4 * | -9.9 ± 33.5 |
| six-mixed | range-aware, tight-aggressive, range-equity, loose-passive, range-aware | 1998 | +109.7 ± 56.2 * | +115.0 ± 60.0 * | +5.4 ± 22.5 |
| six-independent | pot-odds-caller, mdf-defender, trapper, maniac, nit | 1998 | +219.6 ± 81.0 * | +221.1 ± 80.4 * | +1.5 ± 36.3 |
| six-aggro | loose-aggressive, raiser, maniac, adaptive-punisher, trapper | 1998 | +159.1 ± 92.2 * | +154.6 ± 91.0 * | -4.5 ± 40.3 |

**Pooled by opponent family** (equal weight per table; interval from the tables' own standard errors, which are independent):

| Family | Tables | v3 − v2 |
|---|---|---|
| archetypes (version 1 model) | 4 | +11.5 ± 19.5 |
| simple and independent | 9 | -4.9 ± 14.0 |
| version 2 model | 1 | -9.9 ± 33.5 |
| six-handed | 3 | +0.8 ± 19.6 |
| all heads-up | 14 | -0.6 ± 10.9 |
| all heads-up except version 2 model | 13 | +0.1 ± 11.4 |

**What each engine did after the flop** (bets when checked to / folds facing a bet / raises facing a bet / check-raises when possible, with the number of check-raise chances):

| Table | v2 | v3 |
|---|---|---|
| hu-tag | 59% / 65% / 13% / 5% (182) | 54% / 55% / 22% / 25% (237) |
| hu-lag | 64% / 61% / 17% / 8% (186) | 56% / 45% / 25% / 35% (287) |
| hu-tight-passive | 51% / 71% / 13% / 2% (133) | 51% / 57% / 18% / 15% (145) |
| hu-loose-passive | 44% / 66% / 12% / 0% (272) | 48% / 58% / 16% / 9% (266) |
| hu-station | 51% / – / – / – (0) | 53% / – / – / – (0) |
| hu-maniac | 59% / 60% / 20% / 3% (298) | 39% / 47% / 22% / 20% (510) |
| hu-raiser | 60% / 71% / 10% / 0% (27) | 51% / 53% / 11% / 0% (37) |
| hu-trapper | 50% / 71% / 9% / 0% (68) | 50% / 56% / 14% / 8% (62) |
| hu-mdf | 50% / 76% / 10% / 0% (37) | 53% / 68% / 9% / 0% (33) |
| hu-punisher | 51% / 75% / 9% / 0% (52) | 49% / 64% / 13% / 2% (53) |
| hu-caller | 49% / 75% / 13% / 0% (99) | 51% / 67% / 15% / 3% (101) |
| hu-nit | 87% / 64% / 26% / 13% (8) | 59% / 39% / 16% / 41% (17) |
| hu-re | 66% / 64% / 13% / 3% (32) | 49% / 57% / 11% / 17% (42) |
| hu-ra | 77% / 79% / 9% / 7% (81) | 60% / 47% / 27% / 42% (155) |
| six-mixed | 50% / 68% / 15% / 1% (83) | 48% / 61% / 15% / 5% (85) |
| six-independent | 47% / 63% / 18% / 0% (104) | 45% / 55% / 17% / 6% (117) |
| six-aggro | 44% / 70% / 13% / 1% (129) | 43% / 67% / 12% / 5% (141) |

Version 3 postflop decision time in the simulator (400 deals, no sensitivity pass): median of table medians 55 ms; largest 95th percentile 100 ms.

## 2. Evaluation set A: seed 12700

| Table | Opponents | Hands | v2 | v3 | v3 − v2 |
|---|---|---|---|---|---|
| hu-tag | tight-aggressive | 2000 | +61.0 ± 48.2 * | +70.2 ± 53.6 * | +9.2 ± 34.3 |
| hu-lag | loose-aggressive | 2000 | +77.4 ± 53.8 * | +62.6 ± 61.0 * | -14.9 ± 48.4 |
| hu-tight-passive | tight-passive | 2000 | +85.0 ± 34.5 * | +76.3 ± 39.4 * | -8.7 ± 23.2 |
| hu-loose-passive | loose-passive | 2000 | +136.5 ± 59.0 * | +137.0 ± 62.6 * | +0.4 ± 35.2 |
| hu-station | calling-station | 2000 | +1093.4 ± 122.0 * | +1126.9 ± 126.3 * | +33.5 ± 39.5 |
| hu-maniac | maniac | 2000 | +455.3 ± 115.8 * | +434.8 ± 120.0 * | -20.5 ± 78.4 |
| hu-raiser | raiser | 2000 | +42.2 ± 43.7 | +67.5 ± 46.8 * | +25.3 ± 35.5 |
| hu-trapper | trapper | 2000 | +130.2 ± 52.6 * | +105.9 ± 50.8 * | -24.3 ± 27.1 |
| hu-mdf | mdf-defender | 2000 | +56.2 ± 40.2 * | +51.6 ± 43.5 * | -4.5 ± 28.7 |
| hu-punisher | adaptive-punisher | 2000 | +194.8 ± 66.0 * | +191.1 ± 64.7 * | -3.7 ± 28.8 |
| hu-caller | pot-odds-caller | 2000 | +325.1 ± 71.7 * | +341.7 ± 75.7 * | +16.6 ± 31.6 |
| hu-nit | nit | 2000 | +0.4 ± 31.6 | -22.8 ± 37.4 | -23.3 ± 30.5 |
| hu-re | range-equity | 2000 | +26.2 ± 26.1 * | +15.2 ± 34.9 | -11.0 ± 24.2 |
| hu-ra | range-aware | 2000 | +52.3 ± 31.4 * | +53.5 ± 37.3 * | +1.3 ± 31.9 |
| six-mixed | range-aware, tight-aggressive, range-equity, loose-passive, range-aware | 1998 | +101.5 ± 57.0 * | +110.0 ± 61.2 * | +8.5 ± 25.9 |
| six-independent | pot-odds-caller, mdf-defender, trapper, maniac, nit | 1998 | +201.3 ± 88.4 * | +206.0 ± 92.6 * | +4.7 ± 37.2 |
| six-aggro | loose-aggressive, raiser, maniac, adaptive-punisher, trapper | 1998 | +217.8 ± 95.2 * | +213.9 ± 98.4 * | -3.9 ± 27.2 |

**Pooled by opponent family** (equal weight per table; interval from the tables' own standard errors, which are independent):

| Family | Tables | v3 − v2 |
|---|---|---|
| archetypes (version 1 model) | 4 | -3.5 ± 18.2 |
| simple and independent | 9 | -1.3 ± 13.1 |
| version 2 model | 1 | +1.3 ± 31.9 |
| six-handed | 3 | +3.1 ± 17.6 |
| all heads-up | 14 | -1.8 ± 10.1 |
| all heads-up except version 2 model | 13 | -2.0 ± 10.6 |

**What each engine did after the flop** (bets when checked to / folds facing a bet / raises facing a bet / check-raises when possible, with the number of check-raise chances):

| Table | v2 | v3 |
|---|---|---|
| hu-tag | 57% / 68% / 12% / 2% (188) | 54% / 56% / 21% / 23% (231) |
| hu-lag | 66% / 63% / 16% / 5% (190) | 55% / 44% / 29% / 37% (299) |
| hu-tight-passive | 50% / 71% / 13% / 1% (133) | 51% / 62% / 20% / 13% (140) |
| hu-loose-passive | 43% / 66% / 16% / 0% (261) | 51% / 59% / 19% / 7% (234) |
| hu-station | 51% / – / – / – (0) | 53% / – / – / – (0) |
| hu-maniac | 58% / 60% / 20% / 2% (296) | 38% / 45% / 22% / 26% (512) |
| hu-raiser | 59% / 69% / 10% / 0% (15) | 52% / 54% / 8% / 3% (37) |
| hu-trapper | 50% / 64% / 14% / 0% (68) | 52% / 56% / 16% / 2% (53) |
| hu-mdf | 50% / 72% / 11% / 0% (34) | 54% / 62% / 12% / 8% (37) |
| hu-punisher | 52% / 66% / 15% / 0% (40) | 52% / 62% / 14% / 7% (44) |
| hu-caller | 52% / 73% / 11% / 0% (93) | 54% / 67% / 14% / 2% (97) |
| hu-nit | 91% / 70% / 20% / 0% (3) | 66% / 51% / 15% / 20% (15) |
| hu-re | 71% / 74% / 8% / 0% (41) | 56% / 60% / 11% / 11% (57) |
| hu-ra | 74% / 78% / 11% / 8% (75) | 61% / 51% / 27% / 42% (128) |
| six-mixed | 49% / 68% / 15% / 0% (65) | 43% / 59% / 17% / 7% (82) |
| six-independent | 52% / 69% / 16% / 1% (88) | 48% / 61% / 15% / 8% (105) |
| six-aggro | 48% / 70% / 15% / 1% (103) | 45% / 60% / 13% / 3% (111) |

Version 3 postflop decision time in the simulator (400 deals, no sensitivity pass): median of table medians 70 ms; largest 95th percentile 130 ms.

## 3. Both fresh sets together (28 heads-up table runs)

| | v3 − v2, bb/100 |
|---|---|
| Set A, 14 heads-up tables | −1.8 ± 10.1 |
| Final set, 14 heads-up tables | −0.6 ± 10.9 |
| Both, equal weight | **−1.2 ± 7.4** |
| Tables significant (either direction), out of 34 | 2 (loose-aggressive +56.4, adaptive punisher −39.8, both in the final set); about 1.7 expected by chance |

## 4. Development decks (seed 12300): the correction itself

Corrected version 3 played the decks of the stored Phase 2.3 run (`reports/phase23-bench-12300.jsonl`), so it is
paired with both version 2 and 0.8.0's version 3 (`phase24-dev-12300-v3-corrected.jsonl`).

| Table | corrected v3 − v2 | corrected v3 − 0.8.0 v3 | 0.8.0 v3 − v2 | corrected v3: check-raises / raises facing a bet |
|---|---|---|---|---|
| hu-ra | −41.0 ± 40.5 * | **+73.0 ± 50.4 *** | −114.0 ± 60.2 * | 71% / 52% (0.8.0: 87% / 76%) |
| hu-nit | −29.5 ± 31.9 | +1.5 ± 18.6 | −30.9 ± 30.8 * | 28% / 15% |
| hu-re | −20.5 ± 26.0 | +1.9 ± 14.4 | −22.4 ± 21.4 * | 14% / 15% |
| hu-tag | +5.4 ± 40.8 | −8.4 ± 17.7 | +13.8 ± 38.7 | 26% / 22% |
| hu-lag | +43.3 ± 48.6 | +16.4 ± 32.9 | +26.9 ± 44.5 | 35% / 26% |
| hu-trapper | −14.8 ± 35.7 | +11.3 ± 22.1 | −26.1 ± 38.4 | 4% / 13% |
| hu-mdf | −12.6 ± 27.7 | +7.0 ± 17.0 | −19.6 ± 27.9 | 11% / 16% |
| hu-punisher | +6.2 ± 36.2 | +7.0 ± 18.8 | −0.8 ± 37.5 | 2% / 14% |

## 5. Per-decision reference evaluation (true opponent policies, enumerated run-outs)

Each version 3 decision is valued with version 2 playing on afterwards and compared with version 2's choice at the
same state. Summed over the decisions version 3 reaches, this is the paired performance difference. 600 hands each.

| Opponent | Seed | Model | v3 choice minus v2 choice, bb per decision | v3's own estimate minus reference, bets and raises | Report |
|---|---|---|---|---|---|
| range-aware | 12300 | 0.8.0 | +0.195 ± 0.556 (n = 426) | +0.31 ± 0.71 | `reference-eval-p24-hu-ra-12300-before.md` |
| range-aware | 12300 | corrected | +0.062 ± 0.551 (n = 440) | +0.34 ± 0.74 | `reference-eval-p24-hu-ra-12300-after.md` |
| tight-aggressive | 12750 | corrected | −0.048 ± 0.710 (n = 445) | −1.32 ± 0.96 * | `reference-eval-p24-hu-tag-12750.md` |
| trapper | 12750 | corrected | −0.148 ± 0.402 (n = 548) | +1.48 ± 0.92 * | `reference-eval-p24-hu-trapper-12750.md` |
| mdf-defender | 12750 | corrected | −0.003 ± 0.472 (n = 335) | +1.80 ± 1.08 * | `reference-eval-p24-hu-mdf-12750.md` |

## 6. Solver spots

`sim/bot/solver-spots.ts`, seven river spots with independently specified ranges, 40 hands each: version 3's rows
are identical to the 0.8.0 run (`solver-spots-2026-11-18.md`). These are single decisions without history, where
the residual calibration has nothing to act on. All 280 decisions: v1 0.37 ± 0.09, v2 0.22 ± 0.07, v3 0.24 ± 0.08 bb
per decision. Facing a condensed river bet version 3 still never folds (the equilibrium folds 34%).

## 7. Latency

`sim/bot/v3-latency.ts`, the live `decide()` with a 20-second clock: version 3 took 20 to 265 ms on five spots
(version 2: 13 to 205 ms). In the benchmark simulator the median is shown under each set's tables above.
