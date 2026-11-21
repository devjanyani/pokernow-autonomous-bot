# Phase 3.1 preflop evaluation: suite "negative"

Engines v2, neg-limp-call, neg-nit, neg-random, neg-fold; 1000 deals per cell; 150 postflop samples per decision; seeds 32000 + cell index (development seeds). Paired by deal; 95% intervals. Opponents: independent programs (src/bot/sim/independent.ts); "big" = opponents' preflop raises resized to 4bb opens and 4.5x re-raises. Rake applied after the fact (the strategy does not model rake). Wall time 13.0 min.

## Results (6 cells)

| cell | deals | v2 bb/100 | neg-limp-call bb/100 | neg-nit bb/100 | neg-random bb/100 | neg-fold bb/100 | neg-limp-call − v2 | neg-nit − v2 | neg-random − v2 | neg-fold − v2 |
|---|---|---|---|---|---|---|---|---|---|---|
| hu-nit-100 | 1000 | +4.6 ± 56.0 | -290.4 ± 128.3 | -2.1 ± 8.0 | -100.2 ± 134.6 | -9.8 ± 3.3 | -295.0 ± 121.9 * | -6.8 ± 55.8 | -104.9 ± 132.5 | -14.5 ± 55.9 |
| hu-maniac-100 | 1000 | +504.2 ± 180.8 | +498.9 ± 217.7 | +79.5 ± 83.8 | -48.2 ± 261.9 | +0.4 ± 52.5 | -5.3 ± 178.6 | -424.7 ± 166.7 * | -552.4 ± 250.7 * | -503.8 ± 179.6 * |
| six-40-std | 1000 | +73.0 ± 71.7 | -2.8 ± 142.4 | +8.9 ± 30.1 | -29.0 ± 156.4 | -19.4 ± 15.8 | -75.8 ± 127.0 | -64.1 ± 66.7 | -102.0 ± 155.4 | -92.3 ± 71.2 * |
| six-100-std | 1000 | +172.1 ± 131.4 | +288.3 ± 268.4 | +47.1 ± 59.6 | -630.1 ± 331.5 | -9.0 ± 22.3 | +116.2 ± 257.7 | -125.0 ± 116.5 * | -802.2 ± 315.5 * | -181.1 ± 128.7 * |
| nine-100-std | 1000 | +209.2 ± 138.9 | +386.2 ± 288.0 | +128.5 ± 111.5 | -354.9 ± 411.0 | +18.5 ± 33.0 | +177.1 ± 258.0 | -80.6 ± 95.9 | -564.0 ± 392.3 * | -190.6 ± 134.7 * |
| nine-200-std | 1000 | +216.1 ± 189.8 | +310.0 ± 451.0 | +90.1 ± 117.2 | -829.9 ± 774.5 | -17.5 ± 7.4 | +93.9 ± 435.0 | -126.1 ± 179.1 | -1046.1 ± 756.4 * | -233.6 ± 189.5 * |

| pooled over the cells above | bb/100 (no rake) | − v2 (no rake) | bb/100 (5% rake, 3bb cap) | − v2 (rake) |
|---|---|---|---|---|
| v2 | +196.5 ± 56.3 | — | +182.2 ± 55.2 | — |
| neg-limp-call | +198.4 ± 111.0 | +1.8 ± 103.5 | +157.2 ± 109.4 | -25.0 ± 102.1 |
| neg-nit | +58.7 ± 32.4 | -137.9 ± 50.1 * | +54.9 ± 31.8 | -127.3 ± 49.2 * |
| neg-random | -332.1 ± 165.9 | -528.6 ± 160.9 * | -361.5 ± 164.6 | -543.7 ± 159.8 * |
| neg-fold | -6.1 ± 11.4 | -202.7 ± 55.7 * | -7.4 ± 11.0 | -189.6 ± 54.6 * |

`*`: the 95% interval excludes 0.

| engine | preflop decisions | VPIP | sources (share of preflop decisions) | legality-gate replacements | illegal actions | preflop latency median / p95 |
|---|---|---|---|---|---|---|
| v2 | 5725 | 33.2% | chart-approx 31.1%, heuristic 29.9%, hu-chart 25.5%, chart 13.0%, computed 0.5% | 0 | 0 | 1.4 / 2.3 ms |
| neg-limp-call | 7855 | 100.0% | n/a (scripted) | 0 | 0 | n/a |
| neg-nit | 5549 | 3.6% | n/a (scripted) | 0 | 0 | n/a |
| neg-random | 6401 | 75.8% | n/a (scripted) | 0 | 0 | n/a |
| neg-fold | 5502 | 0.0% | n/a (scripted) | 0 | 0 | n/a |

| situation | engine | decisions | fold | check | call | raise | all-in |
|---|---|---|---|---|---|---|---|
| cold-facing-3bet | v2 | 176 | 98.9% | 0.0% | 0.0% | 1.1% | 0.0% |
| cold-facing-4bet-plus | v2 | 5 | 100.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| facing-3bet | v2 | 160 | 56.9% | 0.0% | 33.1% | 5.6% | 4.4% |
| facing-4bet | v2 | 21 | 90.5% | 0.0% | 9.5% | 0.0% | 0.0% |
| facing-5bet-plus | v2 | 4 | 75.0% | 0.0% | 25.0% | 0.0% | 0.0% |
| facing-iso | v2 | 4 | 75.0% | 0.0% | 25.0% | 0.0% | 0.0% |
| facing-limpers | v2 | 424 | 72.2% | 0.0% | 1.4% | 26.4% | 0.0% |
| facing-open | v2 | 1282 | 66.9% | 0.0% | 20.4% | 12.7% | 0.0% |
| facing-open-callers | v2 | 522 | 77.2% | 0.0% | 17.0% | 5.0% | 0.8% |
| facing-squeeze | v2 | 32 | 40.6% | 0.0% | 31.3% | 18.8% | 9.4% |
| limped-bb-option | v2 | 244 | 0.0% | 73.4% | 0.0% | 26.6% | 0.0% |
| unopened | v2 | 2851 | 63.6% | 0.0% | 0.0% | 36.4% | 0.0% |

| first-in raise by position | BTN | CO | HJ | LJ | MP | SB | UTG | UTG+1 |
|---|---|---|---|---|---|---|---|---|
| v2 | 62.5% | 29.3% | 16.3% | 11.9% | 14.3% | 51.0% | 16.0% | 13.3% |
