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

**Final set completed (seed 13300), result: no configuration of version 3 is shown to play better than version 2.**
The final set was run once, untouched, after set A and after all code and tables were frozen at 0.8.2 (commit 7314571):
`npm run bot:phase25 -- --bench --seed 13300 --jobs 1`, one process, exit 0, 2026-11-19. The command re-derives the
calibration tables first; both came out byte-identical (SHA-256 checked before and after), so the run used exactly the
tables evaluated on set A. Nothing was changed after it. Per-deal results: `reports/phase25-bench-13300.jsonl`.

| Pooled, all 14 tables (bb/100, 95% interval) | Set A (13100) | Final (13300) |
|---|---|---|
| v3 − v2 | -1.7 ± 10.4 | -5.4 ± 11.7 |
| v3p − v3 (population calibration) | +2.6 ± 8.5 | +6.1 ± 8.8 |
| v3r − v3 (river range tilt) | -2.5 ± 4.0 | **-5.6 ± 3.7** (significant, worse) |
| v3pr − v3 (both) | +0.1 ± 8.7 | +6.5 ± 8.8 |
| **v3pr − v2** (what the extension's version 3 option runs) | -1.6 ± 10.4 | **+1.1 ± 11.4** (not significant) |

## Final set (seed 13300)

| Table | Opponents | Hands | v2 | v3 | v3p | v3r | v3pr | v3 − v2 | v3p − v3 | v3r − v3 | v3pr − v3 | v3pr − v2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| hu-tag | tight-aggressive | 2000 | +62.0 ± 43.7 * | +38.8 ± 52.9 | +54.8 ± 53.9 * | +38.8 ± 53.0 | +50.4 ± 54.2 | -23.2 ± 38.2 | +16.0 ± 23.8 | +0.0 ± 2.5 | +11.6 ± 22.3 | -11.6 ± 36.8 |
| hu-lag | loose-aggressive | 2000 | +68.4 ± 52.0 * | +80.5 ± 61.0 * | +87.4 ± 62.3 * | +60.4 ± 61.9 | +68.0 ± 62.2 * | +12.1 ± 44.8 | +6.9 ± 33.5 | -20.1 ± 21.2 | -12.6 ± 33.4 | -0.5 ± 44.9 |
| hu-tight-passive | tight-passive | 2000 | +39.6 ± 38.2 * | +52.4 ± 44.1 * | +29.6 ± 43.3 | +30.1 ± 46.2 | +40.2 ± 44.6 | +12.7 ± 34.7 | -22.8 ± 25.6 | -22.3 ± 21.2 * | -12.2 ± 18.7 | +0.6 ± 33.1 |
| hu-loose-passive | loose-passive | 2000 | +115.1 ± 58.1 * | +136.5 ± 69.9 * | +122.5 ± 67.5 * | +133.5 ± 69.8 * | +124.7 ± 67.1 * | +21.4 ± 42.6 | -14.0 ± 33.2 | -3.1 ± 4.0 | -11.8 ± 33.9 | +9.6 ± 39.4 |
| hu-station | calling-station | 2000 | +1218.8 ± 121.3 * | +1240.8 ± 124.6 * | +1297.2 ± 123.5 * | +1240.8 ± 124.6 * | +1297.2 ± 123.5 * | +22.0 ± 41.9 | +56.3 ± 34.0 * | +0.0 ± 0.0 | +56.3 ± 34.0 * | +78.4 ± 37.1 * |
| hu-maniac | maniac | 2000 | +396.0 ± 114.1 * | +402.0 ± 115.6 * | +389.0 ± 112.0 * | +402.9 ± 116.2 * | +410.4 ± 112.4 * | +5.9 ± 92.1 | -13.0 ± 63.3 | +1.0 ± 23.9 | +8.4 ± 63.9 | +14.4 ± 92.5 |
| hu-raiser | raiser | 2000 | +33.0 ± 53.0 | +48.0 ± 58.1 | +44.1 ± 55.9 | +42.4 ± 56.5 | +49.6 ± 54.7 | +15.0 ± 40.0 | -3.9 ± 32.4 | -5.6 ± 17.8 | +1.6 ± 33.4 | +16.6 ± 37.3 |
| hu-trapper | trapper | 2000 | +142.3 ± 54.1 * | +117.8 ± 51.7 * | +107.6 ± 53.6 * | +111.7 ± 51.1 * | +116.8 ± 52.0 * | -24.5 ± 29.7 | -10.2 ± 23.9 | -6.1 ± 6.6 | -1.0 ± 22.3 | -25.5 ± 31.3 |
| hu-mdf | mdf-defender | 2000 | +70.9 ± 41.8 * | +60.8 ± 46.9 * | +63.5 ± 48.0 * | +58.6 ± 47.2 * | +65.1 ± 48.5 * | -10.1 ± 27.9 | +2.7 ± 18.3 | -2.2 ± 9.3 | +4.2 ± 18.7 | -5.9 ± 29.9 |
| hu-punisher | adaptive-punisher | 2000 | +167.4 ± 60.6 * | +138.7 ± 63.5 * | +145.4 ± 64.6 * | +149.9 ± 62.4 * | +141.7 ± 65.2 * | -28.8 ± 36.4 | +6.7 ± 33.5 | +11.2 ± 17.5 | +3.0 ± 33.0 | -25.8 ± 42.4 |
| hu-caller | pot-odds-caller | 2000 | +302.5 ± 73.5 * | +293.2 ± 77.7 * | +314.7 ± 78.0 * | +287.0 ± 78.9 * | +307.4 ± 79.0 * | -9.3 ± 32.1 | +21.5 ± 29.4 | -6.2 ± 9.3 | +14.2 ± 29.0 | +4.9 ± 36.7 |
| hu-nit | nit | 2000 | +35.1 ± 29.9 * | +2.6 ± 38.7 | +34.1 ± 29.4 * | +1.3 ± 38.9 | +30.4 ± 30.3 * | -32.5 ± 35.2 | +31.4 ± 23.5 * | -1.3 ± 3.6 | +27.8 ± 22.7 * | -4.6 ± 29.2 |
| hu-re | range-equity | 2000 | +31.3 ± 27.3 * | +16.4 ± 30.9 | +25.2 ± 31.6 | +15.5 ± 30.9 | +24.0 ± 33.2 | -14.9 ± 27.9 | +8.8 ± 17.5 | -0.9 ± 5.7 | +7.6 ± 23.8 | -7.4 ± 25.2 |
| hu-ra | range-aware | 2000 | +43.0 ± 29.3 * | +21.7 ± 53.1 | +21.3 ± 44.0 | -0.8 ± 54.3 | +15.4 ± 43.2 | -21.3 ± 50.6 | -0.4 ± 42.2 | -22.5 ± 17.5 * | -6.3 ± 43.8 | -27.6 ± 38.4 |

**Pooled by opponent family** (equal weight per table; interval from the tables' own standard errors, which are independent):

| Family | Tables | v3 − v2 | v3p − v3 | v3r − v3 | v3pr − v3 | v3pr − v2 |
|---|---|---|---|---|---|---|
| archetypes (version 1 model) | 4 | +5.8 ± 20.1 | -3.5 ± 14.7 | -11.4 ± 7.6 * | -6.2 ± 13.9 | -0.5 ± 19.4 |
| simple and independent | 9 | -8.6 ± 14.9 | +11.2 ± 11.1 * | -1.1 ± 4.2 | +13.6 ± 11.2 * | +5.0 ± 14.8 |
| version 2 model | 1 | -21.3 ± 50.6 | -0.4 ± 42.2 | -22.5 ± 17.5 * | -6.3 ± 43.8 | -27.6 ± 38.4 |
| all heads-up | 14 | -5.4 ± 11.7 | +6.1 ± 8.8 | -5.6 ± 3.7 * | +6.5 ± 8.8 | +1.1 ± 11.4 |
| all heads-up except version 2 model | 13 | -4.2 ± 12.0 | +6.7 ± 8.9 | -4.3 ± 3.7 * | +7.5 ± 8.9 | +3.3 ± 11.9 |

**What each engine did after the flop** (bets when checked to / folds facing a bet / raises facing a bet / check-raises when possible, with the number of check-raise chances):

| Table | v2 | v3 | v3p | v3r | v3pr |
|---|---|---|---|---|---|
| hu-tag | 57% / 68% / 13% / 3% (201) | 53% / 51% / 24% / 27% (243) | 55% / 53% / 23% / 26% (235) | 53% / 50% / 24% / 27% (243) | 55% / 52% / 23% / 26% (235) |
| hu-lag | 67% / 61% / 18% / 8% (198) | 58% / 46% / 27% / 35% (280) | 59% / 46% / 27% / 35% (264) | 57% / 45% / 29% / 37% (283) | 60% / 45% / 28% / 36% (265) |
| hu-tight-passive | 44% / 72% / 13% / 4% (151) | 53% / 56% / 21% / 21% (156) | 56% / 61% / 18% / 18% (129) | 53% / 56% / 20% / 19% (152) | 56% / 62% / 18% / 15% (126) |
| hu-loose-passive | 43% / 64% / 15% / 1% (256) | 48% / 55% / 21% / 15% (253) | 48% / 55% / 20% / 12% (250) | 48% / 54% / 21% / 15% (253) | 48% / 55% / 21% / 12% (250) |
| hu-station | 51% / – / – / – (0) | 53% / – / – / – (0) | 55% / – / – / – (0) | 53% / – / – / – (0) | 55% / – / – / – (0) |
| hu-maniac | 58% / 59% / 20% / 2% (292) | 38% / 46% / 22% / 22% (504) | 38% / 45% / 21% / 22% (516) | 38% / 45% / 22% / 22% (505) | 39% / 44% / 21% / 22% (515) |
| hu-raiser | 60% / 66% / 15% / 9% (22) | 51% / 45% / 14% / 0% (43) | 53% / 49% / 13% / 2% (49) | 51% / 42% / 11% / 0% (46) | 53% / 46% / 12% / 2% (46) |
| hu-trapper | 52% / 67% / 14% / 0% (57) | 56% / 59% / 13% / 8% (50) | 58% / 60% / 15% / 8% (51) | 56% / 58% / 13% / 8% (51) | 58% / 60% / 15% / 9% (53) |
| hu-mdf | 54% / 74% / 13% / 0% (39) | 58% / 65% / 15% / 19% (43) | 59% / 67% / 16% / 15% (41) | 58% / 66% / 15% / 19% (43) | 59% / 67% / 16% / 15% (41) |
| hu-punisher | 53% / 69% / 12% / 0% (53) | 54% / 62% / 11% / 6% (52) | 56% / 62% / 12% / 6% (52) | 53% / 62% / 10% / 8% (52) | 56% / 63% / 12% / 6% (50) |
| hu-caller | 53% / 66% / 16% / 0% (85) | 56% / 60% / 18% / 1% (87) | 57% / 59% / 19% / 3% (87) | 56% / 60% / 19% / 2% (88) | 57% / 59% / 20% / 2% (87) |
| hu-nit | 89% / 58% / 33% / 0% (7) | 64% / 42% / 20% / 29% (21) | 73% / 46% / 18% / 22% (18) | 63% / 41% / 21% / 27% (22) | 73% / 45% / 18% / 22% (18) |
| hu-re | 65% / 73% / 11% / 0% (39) | 53% / 63% / 16% / 17% (54) | 61% / 67% / 11% / 13% (47) | 53% / 62% / 14% / 17% (54) | 60% / 64% / 13% / 13% (47) |
| hu-ra | 76% / 73% / 16% / 12% (86) | 48% / 24% / 49% / 70% (237) | 71% / 45% / 36% / 63% (120) | 49% / 26% / 48% / 70% (227) | 71% / 45% / 36% / 63% (120) |

Version 3 postflop decision time in the simulator (400 deals, no sensitivity pass): median of table medians 44 ms; largest 95th percentile 105 ms.

## Reading of the final set

- **Against version 2, calibrated version 3 (v3pr) is level: +1.1 ± 11.4 bb/100 over the 14 tables** (+3.3 ± 11.9
  without version 2's own model). The interval includes losing about 10 and winning about 12 bb/100; this is no
  evidence that it is stronger. One table is significant: the calling station (+78.4 ± 37.1), where calibrated
  version 3 bluffs less into a player who never folds; set A showed the same table in the same direction.
- **Population calibration (model D)**: +6.1 ± 8.8 pooled, not significant. Significant for the nine simple and
  independent programs (+11.2 ± 11.1), driven by the calling station (+56.3) and the nit (+31.4). In set A the same family
  was +5.2 ± 10.3. The direction agrees between the two sets; the size is not established.
- **River range tilt alone hurts**: -5.6 ± 3.7 pooled, significant, worst against the archetypes (-11.4 ± 7.6) and
  version 2's model (-22.5 ± 17.5). Set A was -2.5 ± 4.0, the same direction. It was fitted to people's river bets, and
  these programs do not bet the river like people. Combined with the population calibration (v3pr) the net is
  +6.5 ± 8.8 against v3, not distinguishable from v3p alone.
- About 70 comparisons are reported; at the 5% level three or four significant ones are expected by chance. Seven appear, three of them the calling-station table (the differences share decks and are not independent).
- **Prediction is not play.** The fitted tables predict real players' responses better on held-out real hands
  (reports/PHASE_2_5_CALIBRATION.md); that is a statement about probabilities. These tables measure chips won against
  programs. Better prediction of people did not translate into measurably more chips here, and the river tilt, which
  predicts people better, lost chips against programs.
- Behaviour: version 3 check-raises far more than version 2 (for example 26-36% against 3-8% at the aggressive tables)
  and folds less facing bets; the calibration moves these little except against version 2's own model.
- Decision: version 3 stays off by default and recommendation-only. It is offered in the extension only as an
  experimental option (0.9.0), using v3pr plus spot checks (see reports/V3_EXTENSION_INTEGRATION.md).

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

## Reading of set A

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
