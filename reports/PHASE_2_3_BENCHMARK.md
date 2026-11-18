# Phase 2.3 benchmark (0.8.0)

Versions 1, 2 and 3 of the strategy engine and the PokerBench model (offline comparison only), against simulated
opponents. Every engine plays the same decks from the same seats against the same opponent seeds (duplicate
rotation, each deck from every seat counts as one sample); results are bb/100 with 95% intervals; differences are
paired by deal; `*` = the interval excludes 0. Preflop is version 2 for v2, v3 and ml; version 3 and the model
replace version 2 only in heads-up pots after the flop. Blinds 10/20, 100 bb stacks, 2,000 hands per table, 400
samples per decision, no rake. Tool: `sim/bot/phase23-bench.ts`; tables: `sim/bot/phase23-report.ts`.

Interpretation and the decision taken: `docs/bot/PHASE_2_3_ADVANCED_STRATEGY.md`, sections 9 to 11. The opponents
are programs; nothing here measures profit against people.

## 1. Held-out run: seed 12300 (not used by any earlier experiment), final version 3 model

| Table | Opponents | Hands | v1 | v2 | v3 | v3 − v2 | v3 − v1 |
|---|---|---|---|---|---|---|---|
| hu-nit | nit | 2000 | +28.6 ± 32.2 | +27.6 ± 38.7 | -3.4 ± 40.9 | -30.9 ± 30.8 * | -32.0 ± 39.1 |
| hu-re | range-equity | 2000 | +60.4 ± 33.7 * | +36.0 ± 33.0 * | +13.6 ± 34.4 | -22.4 ± 21.4 * | -46.8 ± 26.9 * |
| hu-tag | tight-aggressive | 2000 | +51.3 ± 47.2 * | +32.4 ± 48.0 | +46.1 ± 53.5 | +13.8 ± 38.7 | -5.2 ± 41.9 |
| hu-lag | loose-aggressive | 2000 | +136.2 ± 59.6 * | +70.4 ± 57.2 * | +97.3 ± 64.5 * | +26.9 ± 44.5 | -38.9 ± 59.2 |
| hu-tight-passive | tight-passive | 2000 | +54.3 ± 41.5 * | +27.0 ± 40.2 | +27.6 ± 46.7 | +0.6 ± 30.9 | -26.7 ± 37.0 |
| hu-trapper | trapper | 2000 | -79.4 ± 79.0 * | +106.5 ± 52.6 * | +80.4 ± 55.3 * | -26.1 ± 38.4 | +159.8 ± 68.1 * |
| hu-mdf | mdf-defender | 2000 | -27.2 ± 53.5 | +52.5 ± 42.5 * | +32.9 ± 43.7 | -19.6 ± 27.9 | +60.0 ± 47.5 * |
| hu-raiser | raiser | 2000 | -75.5 ± 73.0 * | +48.1 ± 48.8 | +45.9 ± 51.8 | -2.2 ± 32.9 | +121.4 ± 68.1 * |
| hu-punisher | adaptive-punisher | 2000 | +32.1 ± 99.4 | +113.4 ± 53.1 * | +112.6 ± 58.9 * | -0.8 ± 37.5 | +80.4 ± 84.3 |
| hu-caller | pot-odds-caller | 2000 | +265.8 ± 79.9 * | +256.2 ± 68.5 * | +253.2 ± 71.7 * | -3.0 ± 31.3 | -12.6 ± 53.0 |
| hu-maniac | maniac | 2000 | +410.2 ± 124.6 * | +410.4 ± 113.4 * | +450.9 ± 117.6 * | +40.5 ± 85.0 | +40.7 ± 97.4 |
| six-mixed | range-aware, tight-aggressive, range-equity, loose-passive, range-aware | 1998 | +82.8 ± 61.3 * | +61.5 ± 48.6 * | +52.7 ± 54.4 | -8.8 ± 23.3 | -30.1 ± 48.9 |
| hu-ra | range-aware | 2000 | +15.7 ± 38.3 | +50.6 ± 23.5 * | -63.4 ± 66.0 | -114.0 ± 60.2 * | -79.1 ± 66.4 * |
| hu-loose-passive | loose-passive | 2000 | +144.3 ± 59.6 * | +79.2 ± 57.5 * | +83.2 ± 61.2 * | +4.0 ± 38.2 | -61.0 ± 49.1 * |
| six-aggro | loose-aggressive, raiser, maniac, adaptive-punisher, trapper | 1998 | +79.3 ± 94.4 | +103.1 ± 78.9 * | +127.5 ± 81.8 * | +24.5 ± 41.4 | +48.2 ± 70.2 |

**Pooled by opponent family** (equal weight per table; interval from the tables' own standard errors, which are independent):

| Family | Tables | v3 − v2 | v3 − v1 | v2 − v1 |
|---|---|---|---|---|
| simple and independent | 8 | -8.1 ± 15.0 | +46.4 ± 22.8 * | +54.4 ± 21.5 * |
| archetypes (version 1 model) | 4 | +11.3 ± 19.2 | -33.0 ± 23.8 * | -44.3 ± 21.8 * |
| six-handed | 2 | +7.8 ± 23.8 | +9.1 ± 42.8 | +1.2 ± 42.9 |
| version 2 model | 1 | -114.0 ± 60.2 * | -79.1 ± 66.4 * | +34.8 ± 33.2 * |
| all heads-up | 13 | -10.3 ± 11.9 | +12.3 ± 16.6 | +22.6 ± 15.0 * |

**What each engine did after the flop** (bets when checked to / folds facing a bet / raises facing a bet / check-raises when possible):

| Table | v1 | v2 | v3 |
|---|---|---|---|
| hu-nit | 87% / 53% / 17% / 7% (14) | 84% / 51% / 28% / 13% (15) | 53% / 34% / 19% / 38% (21) |
| hu-re | 73% / 64% / 11% / 3% (32) | 55% / 70% / 13% / 6% (49) | 50% / 57% / 13% / 11% (61) |
| hu-tag | 78% / 61% / 11% / 1% (108) | 59% / 68% / 12% / 6% (186) | 52% / 51% / 22% / 25% (232) |
| hu-lag | 81% / 56% / 16% / 4% (118) | 67% / 64% / 14% / 7% (189) | 55% / 46% / 26% / 36% (276) |
| hu-tight-passive | 73% / 63% / 16% / 1% (89) | 44% / 67% / 14% / 5% (155) | 48% / 59% / 17% / 14% (155) |
| hu-trapper | 82% / 50% / 28% / 0% (27) | 50% / 67% / 13% / 0% (60) | 51% / 57% / 14% / 4% (55) |
| hu-mdf | 83% / 66% / 15% / 0% (20) | 49% / 72% / 13% / 0% (37) | 52% / 61% / 15% / 13% (38) |
| hu-raiser | 87% / 45% / 29% / 0% (6) | 57% / 63% / 15% / 0% (22) | 50% / 50% / 13% / 11% (27) |
| hu-punisher | 78% / 47% / 33% / 0% (12) | 48% / 68% / 15% / 0% (40) | 51% / 58% / 15% / 2% (44) |
| hu-caller | 77% / 64% / 16% / 0% (59) | 49% / 62% / 17% / 0% (80) | 51% / 58% / 17% / 3% (91) |
| hu-maniac | 75% / 51% / 23% / 6% (199) | 59% / 63% / 18% / 3% (297) | 42% / 47% / 23% / 23% (456) |
| six-mixed | 72% / 56% / 15% / 7% (59) | 55% / 70% / 12% / 0% (92) | 54% / 60% / 16% / 5% (91) |
| hu-ra | 86% / 69% / 13% / 4% (48) | 75% / 75% / 12% / 12% (74) | 40% / 13% / 76% / 87% (238) |
| hu-loose-passive | 75% / 59% / 15% / 1% (154) | 43% / 66% / 11% / 1% (262) | 47% / 56% / 16% / 11% (265) |
| six-aggro | 70% / 54% / 20% / 3% (77) | 43% / 71% / 13% / 1% (112) | 42% / 64% / 16% / 5% (129) |

Version 3 postflop decision time in the simulator (400 deals, no sensitivity pass): median of table medians 74 ms; largest 95th percentile 139 ms.

## 2. Development run: seed 12100, version 3 model before the fix

The opponent model then added 0.04 / 0.06 / 0.08 to the continue threshold when raised, check-raised and at the
third raise. This run found the over-raising, and the fix was chosen from it.

| Table | Opponents | Hands | v1 | v2 | v3 | ml | v3 − v2 | v3 − v1 | ml − v2 |
|---|---|---|---|---|---|---|---|---|---|
| hu-tag | tight-aggressive | 2000 | +61.2 ± 44.0 * | +35.7 ± 39.0 | +42.6 ± 42.1 * | -28.6 ± 43.2 | +6.8 ± 30.7 | -18.6 ± 38.7 | -64.3 ± 49.0 * |
| hu-lag | loose-aggressive | 2000 | +88.4 ± 54.0 * | +71.8 ± 47.0 * | +59.3 ± 56.1 * | -39.0 ± 52.1 | -12.4 ± 44.6 | -29.0 ± 58.2 | -110.8 ± 58.1 * |
| hu-tight-passive | tight-passive | 2000 | +81.5 ± 40.1 * | +73.5 ± 39.6 * | +52.4 ± 42.4 * | +21.3 ± 37.4 | -21.1 ± 35.7 | -29.1 ± 34.6 | -52.2 ± 30.8 * |
| hu-loose-passive | loose-passive | 2000 | +178.3 ± 65.0 * | +133.9 ± 57.5 * | +150.8 ± 66.6 * | +16.9 ± 54.3 | +16.9 ± 37.1 | -27.5 ± 51.7 | -117.0 ± 60.0 * |
| hu-station | calling-station | 2000 | +993.2 ± 150.7 * | +1089.7 ± 115.5 * | +1120.2 ± 121.8 * | +137.2 ± 59.7 * | +30.5 ± 41.6 | +127.0 ± 106.8 * | -952.5 ± 104.4 * |
| hu-maniac | maniac | 2000 | +308.9 ± 122.2 * | +282.1 ± 107.7 * | +297.6 ± 115.6 * | +46.0 ± 99.5 | +15.5 ± 84.9 | -11.3 ± 101.1 | -236.1 ± 105.1 * |
| hu-raiser | raiser | 2000 | +18.1 ± 76.6 | +71.4 ± 48.0 * | +55.6 ± 54.9 * | +43.1 ± 45.2 | -15.8 ± 48.8 | +37.5 ± 68.9 | -28.3 ± 51.9 |
| hu-trapper | trapper | 2000 | +1.4 ± 80.7 | +141.8 ± 48.4 * | +104.3 ± 56.3 * | +22.7 ± 44.1 | -37.5 ± 34.1 * | +102.9 ± 65.0 * | -119.0 ± 52.2 * |
| hu-mdf | mdf-defender | 2000 | +41.7 ± 57.3 | +72.9 ± 41.0 * | +50.0 ± 39.6 * | +2.7 ± 39.7 | -22.9 ± 24.2 | +8.3 ± 44.6 | -70.2 ± 44.7 * |
| hu-punisher | adaptive-punisher | 2000 | +140.7 ± 103.6 * | +181.6 ± 54.7 * | +162.9 ± 59.9 * | +4.0 ± 38.7 | -18.7 ± 29.1 | +22.2 ± 86.3 | -177.6 ± 55.8 * |
| hu-caller | pot-odds-caller | 2000 | +330.2 ± 83.0 * | +313.6 ± 66.8 * | +316.8 ± 71.4 * | +0.6 ± 47.2 | +3.2 ± 28.8 | -13.4 ± 53.2 | -313.0 ± 65.5 * |
| hu-nit | nit | 2000 | +41.9 ± 27.0 * | +2.6 ± 39.1 | -52.6 ± 44.2 * | +13.5 ± 30.4 | -55.2 ± 41.0 * | -94.5 ± 38.1 * | +11.0 ± 39.4 |
| hu-re | range-equity | 2000 | +69.3 ± 33.5 * | +54.3 ± 30.2 * | +11.3 ± 42.3 | +28.9 ± 29.9 | -42.9 ± 36.1 * | -58.0 ± 36.7 * | -25.4 ± 25.9 |
| hu-ra | range-aware | 2000 | +36.5 ± 31.9 * | +38.2 ± 20.1 * | +47.0 ± 62.8 | +3.6 ± 32.6 | +8.7 ± 61.5 | +10.5 ± 62.3 | -34.7 ± 34.4 * |
| six-mixed | range-aware, tight-aggressive, range-equity, loose-passive, range-aware | 1998 | +133.0 ± 61.3 * | +112.1 ± 54.6 * | +102.8 ± 63.3 * | +78.4 ± 62.5 * | -9.3 ± 42.3 | -30.3 ± 54.5 | -33.7 ± 49.7 |
| six-independent | pot-odds-caller, mdf-defender, trapper, maniac, nit | 1998 | +183.9 ± 105.3 * | +169.9 ± 88.8 * | +170.8 ± 88.8 * | +79.1 ± 88.9 | +0.8 ± 31.7 | -13.1 ± 78.7 | -90.8 ± 61.7 * |
| six-aggro | loose-aggressive, raiser, maniac, adaptive-punisher, trapper | 1998 | +218.2 ± 114.7 * | +211.4 ± 88.7 * | +198.1 ± 86.0 * | +128.8 ± 93.1 * | -13.3 ± 41.5 | -20.1 ± 86.2 | -82.6 ± 64.2 * |

**Pooled by opponent family** (equal weight per table; interval from the tables' own standard errors, which are independent):

| Family | Tables | v3 − v2 | v3 − v1 | v2 − v1 |
|---|---|---|---|---|
| archetypes (version 1 model) | 4 | -2.5 ± 18.7 | -26.1 ± 23.4 * | -23.6 ± 20.7 * |
| simple and independent | 9 | -16.0 ± 14.8 * | +13.4 ± 23.7 | +29.4 ± 22.9 * |
| version 2 model | 1 | +8.7 ± 61.5 | +10.5 ± 62.3 | +1.7 ± 25.7 |
| six-handed | 3 | -7.2 ± 22.4 | -21.2 ± 42.9 | -13.9 ± 39.5 |
| all heads-up | 14 | -10.3 ± 11.8 | +1.9 ± 17.2 | +12.3 ± 16.0 |

**What each engine did after the flop** (bets when checked to / folds facing a bet / raises facing a bet / check-raises when possible):

| Table | v1 | v2 | v3 | ml |
|---|---|---|---|---|
| hu-tag | 79% / 65% / 14% / 0% (99) | 54% / 69% / 11% / 3% (204) | 56% / 58% / 22% / 24% (205) | 41% / 46% / 8% / 4% (279) |
| hu-lag | 82% / 59% / 18% / 1% (107) | 66% / 67% / 13% / 3% (183) | 55% / 46% / 28% / 38% (284) | 39% / 47% / 8% / 3% (379) |
| hu-tight-passive | 75% / 63% / 13% / 0% (94) | 50% / 67% / 10% / 1% (165) | 51% / 59% / 19% / 16% (165) | 42% / 46% / 8% / 3% (210) |
| hu-loose-passive | 77% / 60% / 19% / 0% (143) | 45% / 67% / 13% / 2% (245) | 50% / 58% / 19% / 12% (261) | 41% / 45% / 11% / 4% (318) |
| hu-station | 76% / – / – / – (0) | 50% / – / – / – (0) | 52% / – / – / – (0) | 42% / – / – / – (0) |
| hu-maniac | 73% / 50% / 24% / 7% (207) | 55% / 62% / 17% / 3% (292) | 41% / 50% / 19% / 19% (449) | 40% / 52% / 11% / 3% (432) |
| hu-raiser | 88% / 50% / 29% / 7% (15) | 59% / 71% / 11% / 0% (25) | 51% / 54% / 16% / 13% (30) | 37% / 57% / 11% / 3% (39) |
| hu-trapper | 82% / 53% / 27% / 0% (32) | 52% / 67% / 12% / 0% (58) | 54% / 60% / 15% / 9% (54) | 39% / 50% / 16% / 6% (70) |
| hu-mdf | 85% / 68% / 16% / 0% (17) | 49% / 79% / 9% / 0% (25) | 56% / 74% / 11% / 8% (26) | 40% / 52% / 12% / 3% (36) |
| hu-punisher | 79% / 54% / 28% / 0% (10) | 50% / 75% / 11% / 0% (43) | 54% / 66% / 11% / 0% (41) | 38% / 52% / 12% / 5% (65) |
| hu-caller | 76% / 71% / 14% / 0% (69) | 49% / 74% / 13% / 0% (92) | 52% / 68% / 14% / 2% (92) | 42% / 51% / 11% / 3% (119) |
| hu-nit | 89% / 50% / 15% / 0% (6) | 88% / 49% / 35% / 11% (9) | 57% / 29% / 35% / 78% (18) | 40% / 45% / 12% / 4% (26) |
| hu-re | 76% / 72% / 12% / 7% (29) | 66% / 77% / 14% / 3% (35) | 54% / 56% / 22% / 21% (43) | 42% / 44% / 7% / 3% (73) |
| hu-ra | 87% / 71% / 10% / 0% (40) | 74% / 83% / 10% / 11% (74) | 45% / 5% / 73% / 88% (242) | 39% / 47% / 8% / 4% (224) |
| six-mixed | 74% / 56% / 15% / 2% (64) | 52% / 72% / 14% / 5% (88) | 51% / 60% / 22% / 16% (97) | 43% / 48% / 14% / 9% (115) |
| six-independent | 72% / 51% / 21% / 7% (71) | 52% / 69% / 13% / 4% (103) | 48% / 62% / 15% / 9% (115) | 41% / 58% / 14% / 5% (132) |
| six-aggro | 68% / 56% / 23% / 5% (73) | 44% / 70% / 15% / 1% (98) | 46% / 65% / 14% / 8% (106) | 39% / 55% / 13% / 5% (130) |

Version 3 postflop decision time in the simulator (400 deals, no sensitivity pass): median of table medians 77 ms; largest 95th percentile 146 ms.

### The fix on the development decks (version 3 only, same decks, compared with the run above)

| Table | fixed v3 - v2 | fixed v3 - old v3 | old v3 - v2 | fixed v3: check-raises / raises facing a bet |
|---|---|---|---|---|
| hu-nit | -4.1 ± 34.6 | +51.1 ± 28.8 * | -55.2 ± 41.0 * | 33% / 24% |
| hu-re | -19.5 ± 31.6 | +23.4 ± 19.4 * | -42.9 ± 36.1 * | 14% / 16% |
| hu-tag | +7.4 ± 37.6 | +0.6 ± 20.6 | +6.8 ± 30.7 | 26% / 23% |
| hu-ra | +17.9 ± 47.5 | +9.1 ± 59.4 | +8.7 ± 61.5 | 75% / 65% |
| hu-lag | -20.8 ± 42.1 | -8.3 ± 28.3 | -12.4 ± 44.6 | 35% / 24% |
| hu-tight-passive | -7.9 ± 32.3 | +13.3 ± 18.2 | -21.1 ± 35.7 | 13% / 18% |

## 3. Per-decision reference evaluation (version 3 against version 2, true opponent policies)

`sim/bot/reference-eval.ts`, 600 hands, seed 12500; each postflop decision of the measured seat is valued under
the opponent's true policy with enumerated run-outs and common random numbers.

| Opponent | Model | v3 choice minus v2 choice, bb per decision | Report |
|---|---|---|---|
| tight-aggressive | before the fix | -0.417 ± 0.811 (n = 422); river facing a bet: folding +15.29 ± 15.12 * better than v3's choices | `reference-eval-v3v2-hu-tag.md` |
| tight-aggressive | fixed | +0.074 ± 0.620 (n = 423); river facing a bet: v3 raises all-in 10% (was 19%) | `reference-eval-v3v2-hu-tag-fixed.md` |
| nit | fixed | -0.922 ± 2.026 (n = 108) | `reference-eval-v3v2-hu-nit-fixed.md` |

## 4. Solver spots

`reports/solver-spots-2026-11-18.md` (final model) and `solver-spots-2026-11-18-before-fix.md`: loss against an
equilibrium of seven river spots with independently specified ranges, 40 hands each. All 280 decisions: v1
0.37 ± 0.09, v2 0.22 ± 0.07, v3 0.24 ± 0.08 (before the fix 0.31 ± 0.12), PokerBench model 1.31 ± 0.28 bb per
decision.

## 5. Live-path latency

`sim/bot/v3-latency.ts`, the anytime `decide()` with a 20-second action clock: version 3 took 24 to 267 ms on five
test spots (version 2: 16 to 252 ms).
