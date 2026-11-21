# Phase 3.1 preflop evaluation: suite "ablation"

Engines v2, v2-prec, v2-opener, v2-sizes; 1000 deals per cell; 150 postflop samples per decision; seeds 32000 + cell index (development seeds). Paired by deal; 95% intervals. Opponents: independent programs (src/bot/sim/independent.ts); "big" = opponents' preflop raises resized to 4bb opens and 4.5x re-raises. Rake applied after the fact (the strategy does not model rake). Wall time 5.5 min.

## Results (4 cells)

| cell | deals | v2 bb/100 | v2-prec bb/100 | v2-opener bb/100 | v2-sizes bb/100 | v2-prec − v2 | v2-opener − v2 | v2-sizes − v2 |
|---|---|---|---|---|---|---|---|---|
| six-100-std | 1000 | +172.1 ± 131.4 | +138.3 ± 128.6 | +172.1 ± 131.4 | +168.4 ± 133.6 | -33.9 ± 49.3 | +0.0 ± 0.0 | -3.7 ± 9.6 |
| six-100-big | 1000 | +29.5 ± 109.6 | +15.7 ± 100.5 | +29.5 ± 109.6 | -1.4 ± 111.0 | -13.8 ± 45.9 | +0.0 ± 0.0 | -30.9 ± 37.3 |
| nine-100-std | 1000 | +209.2 ± 138.9 | +176.4 ± 135.3 | +201.9 ± 140.7 | +232.9 ± 143.5 | -32.8 ± 44.3 | -7.2 ± 22.1 | +23.7 ± 31.8 |
| nine-100-big | 1000 | +238.6 ± 161.3 | +235.0 ± 163.7 | +271.5 ± 171.6 | +250.8 ± 162.4 | -3.6 ± 55.7 | +32.9 ± 68.2 | +12.2 ± 23.5 |

| pooled over the cells above | bb/100 (no rake) | − v2 (no rake) | bb/100 (5% rake, 3bb cap) | − v2 (rake) |
|---|---|---|---|---|
| v2 | +162.3 ± 68.3 | — | +150.9 ± 67.0 | — |
| v2-prec | +141.3 ± 67.0 | -21.0 ± 24.5 | +130.4 ± 65.8 | -20.5 ± 24.1 |
| v2-opener | +168.8 ± 70.1 | +6.4 ± 17.9 | +157.1 ± 68.8 | +6.2 ± 17.6 |
| v2-sizes | +162.7 ± 69.5 | +0.4 ± 13.8 | +151.1 ± 68.2 | +0.2 ± 13.6 |

`*`: the 95% interval excludes 0.

| engine | preflop decisions | VPIP | sources (share of preflop decisions) | legality-gate replacements | illegal actions | preflop latency median / p95 |
|---|---|---|---|---|---|---|
| v2 | 4135 | 22.3% | heuristic 37.9%, chart 32.1%, chart-approx 29.2%, computed 0.7% | 0 | 0 | 1.7 / 3.4 ms |
| v2-prec | 4128 | 21.7% | heuristic 38.0%, chart 32.2%, chart-approx 29.3%, computed 0.6% | 0 | 0 | 1.8 / 3.9 ms |
| v2-opener | 4135 | 22.1% | heuristic 41.3%, chart 32.1%, chart-approx 25.8%, computed 0.7% | 0 | 0 | 1.7 / 3.5 ms |
| v2-sizes | 4135 | 22.3% | heuristic 37.9%, chart 32.1%, chart-approx 29.2%, computed 0.7% | 0 | 0 | 1.7 / 3.1 ms |

| situation | engine | decisions | fold | check | call | raise | all-in |
|---|---|---|---|---|---|---|---|
| cold-facing-3bet | v2 | 172 | 98.3% | 0.0% | 0.0% | 1.2% | 0.6% |
| cold-facing-3bet | v2-prec | 172 | 98.3% | 0.0% | 0.0% | 1.2% | 0.6% |
| cold-facing-3bet | v2-opener | 172 | 98.3% | 0.0% | 0.0% | 1.2% | 0.6% |
| cold-facing-3bet | v2-sizes | 172 | 98.3% | 0.0% | 0.0% | 1.2% | 0.6% |
| cold-facing-4bet-plus | v2 | 5 | 80.0% | 0.0% | 20.0% | 0.0% | 0.0% |
| cold-facing-4bet-plus | v2-prec | 5 | 80.0% | 0.0% | 20.0% | 0.0% | 0.0% |
| cold-facing-4bet-plus | v2-opener | 5 | 80.0% | 0.0% | 20.0% | 0.0% | 0.0% |
| cold-facing-4bet-plus | v2-sizes | 5 | 80.0% | 0.0% | 20.0% | 0.0% | 0.0% |
| facing-3bet | v2 | 94 | 54.3% | 0.0% | 33.0% | 3.2% | 9.6% |
| facing-3bet | v2-prec | 94 | 54.3% | 0.0% | 33.0% | 3.2% | 9.6% |
| facing-3bet | v2-opener | 94 | 54.3% | 0.0% | 33.0% | 3.2% | 9.6% |
| facing-3bet | v2-sizes | 94 | 54.3% | 0.0% | 33.0% | 2.1% | 10.6% |
| facing-4bet | v2 | 24 | 91.7% | 0.0% | 8.3% | 0.0% | 0.0% |
| facing-4bet | v2-prec | 17 | 88.2% | 0.0% | 11.8% | 0.0% | 0.0% |
| facing-4bet | v2-opener | 23 | 91.3% | 0.0% | 8.7% | 0.0% | 0.0% |
| facing-4bet | v2-sizes | 24 | 91.7% | 0.0% | 8.3% | 0.0% | 0.0% |
| facing-5bet-plus | v2 | 2 | 100.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| facing-5bet-plus | v2-prec | 2 | 100.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| facing-5bet-plus | v2-opener | 2 | 100.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| facing-5bet-plus | v2-sizes | 2 | 100.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| facing-iso | v2 | 4 | 100.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| facing-iso | v2-prec | 4 | 100.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| facing-iso | v2-opener | 4 | 100.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| facing-iso | v2-sizes | 4 | 100.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| facing-limpers | v2 | 401 | 77.1% | 0.0% | 2.0% | 20.9% | 0.0% |
| facing-limpers | v2-prec | 401 | 77.1% | 0.0% | 2.0% | 20.9% | 0.0% |
| facing-limpers | v2-opener | 401 | 77.1% | 0.0% | 2.0% | 20.9% | 0.0% |
| facing-limpers | v2-sizes | 401 | 77.1% | 0.0% | 2.0% | 20.9% | 0.0% |
| facing-open | v2 | 922 | 78.6% | 0.0% | 5.7% | 15.6% | 0.0% |
| facing-open | v2-prec | 922 | 81.3% | 0.0% | 6.0% | 12.7% | 0.0% |
| facing-open | v2-opener | 922 | 79.5% | 0.0% | 6.5% | 14.0% | 0.0% |
| facing-open | v2-sizes | 922 | 78.6% | 0.0% | 5.7% | 15.6% | 0.0% |
| facing-open-callers | v2 | 535 | 73.8% | 0.0% | 20.4% | 5.8% | 0.0% |
| facing-open-callers | v2-prec | 535 | 73.8% | 0.0% | 20.4% | 5.8% | 0.0% |
| facing-open-callers | v2-opener | 535 | 73.8% | 0.0% | 20.4% | 5.8% | 0.0% |
| facing-open-callers | v2-sizes | 535 | 73.8% | 0.0% | 20.4% | 5.8% | 0.0% |
| facing-squeeze | v2 | 36 | 41.7% | 0.0% | 36.1% | 19.4% | 2.8% |
| facing-squeeze | v2-prec | 36 | 41.7% | 0.0% | 36.1% | 19.4% | 2.8% |
| facing-squeeze | v2-opener | 37 | 43.2% | 0.0% | 35.1% | 18.9% | 2.7% |
| facing-squeeze | v2-sizes | 36 | 41.7% | 0.0% | 36.1% | 16.7% | 5.6% |
| limped-bb-option | v2 | 88 | 0.0% | 76.1% | 0.0% | 23.9% | 0.0% |
| limped-bb-option | v2-prec | 88 | 0.0% | 76.1% | 0.0% | 23.9% | 0.0% |
| limped-bb-option | v2-opener | 88 | 0.0% | 76.1% | 0.0% | 23.9% | 0.0% |
| limped-bb-option | v2-sizes | 88 | 0.0% | 76.1% | 0.0% | 23.9% | 0.0% |
| unopened | v2 | 1852 | 77.4% | 0.0% | 0.0% | 22.6% | 0.0% |
| unopened | v2-prec | 1852 | 77.4% | 0.0% | 0.0% | 22.6% | 0.0% |
| unopened | v2-opener | 1852 | 77.4% | 0.0% | 0.0% | 22.6% | 0.0% |
| unopened | v2-sizes | 1852 | 77.4% | 0.0% | 0.0% | 22.6% | 0.0% |

| first-in raise by position | BTN | CO | HJ | LJ | MP | SB | UTG | UTG+1 |
|---|---|---|---|---|---|---|---|---|
| v2 | 50.9% | 33.5% | 18.7% | 13.3% | 16.1% | 57.1% | 15.5% | 15.0% |
| v2-prec | 50.9% | 33.5% | 18.7% | 13.3% | 16.1% | 57.1% | 15.5% | 15.0% |
| v2-opener | 50.9% | 33.5% | 18.7% | 13.3% | 16.1% | 57.1% | 15.5% | 15.0% |
| v2-sizes | 50.9% | 33.5% | 18.7% | 13.3% | 16.1% | 57.1% | 15.5% | 15.0% |
