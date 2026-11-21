# Phase 3.1 preflop evaluation: suite "main"

Engines v2, v2c; 1000 deals per cell; 150 postflop samples per decision; seeds 32000 + cell index (development seeds). Paired by deal; 95% intervals. Opponents: independent programs (src/bot/sim/independent.ts); "big" = opponents' preflop raises resized to 4bb opens and 4.5x re-raises. Rake applied after the fact (the strategy does not model rake). Wall time 21.9 min.

## Results (28 cells)

| cell | deals | v2 bb/100 | v2c bb/100 | v2c − v2 |
|---|---|---|---|---|
| hu-nit-40 | 1000 | +33.5 ± 23.3 | +33.5 ± 23.3 | +0.0 ± 0.0 |
| hu-nit-100 | 1000 | +4.6 ± 56.0 | +4.6 ± 56.0 | +0.0 ± 0.0 |
| hu-nit-200 | 1000 | -80.9 ± 107.4 | -80.9 ± 107.4 | +0.0 ± 0.0 |
| hu-maniac-40 | 1000 | +114.2 ± 93.7 | +114.2 ± 93.7 | +0.0 ± 0.0 |
| hu-maniac-100 | 1000 | +504.2 ± 180.8 | +504.2 ± 180.8 | +0.0 ± 0.0 |
| hu-maniac-200 | 1000 | +721.1 ± 327.4 | +721.1 ± 327.4 | +0.0 ± 0.0 |
| hu-pot-odds-caller-40 | 1000 | +114.8 ± 67.8 | +114.8 ± 67.8 | +0.0 ± 0.0 |
| hu-pot-odds-caller-100 | 1000 | +335.5 ± 123.6 | +335.5 ± 123.6 | +0.0 ± 0.0 |
| hu-pot-odds-caller-200 | 1000 | +530.3 ± 177.1 | +530.3 ± 177.1 | +0.0 ± 0.0 |
| hu-raiser-40 | 1000 | +45.7 ± 47.2 | +45.7 ± 47.2 | +0.0 ± 0.0 |
| hu-raiser-100 | 1000 | +107.5 ± 71.8 | +107.5 ± 71.8 | +0.0 ± 0.0 |
| hu-raiser-200 | 1000 | +203.4 ± 132.5 | +203.4 ± 132.5 | +0.0 ± 0.0 |
| hu-nit-100-big | 1000 | +54.5 ± 50.1 | +54.5 ± 50.1 | +0.0 ± 0.0 |
| hu-maniac-100-big | 1000 | +501.5 ± 194.3 | +501.5 ± 194.3 | +0.0 ± 0.0 |
| hu-pot-odds-caller-100-big | 1000 | +262.4 ± 119.4 | +262.4 ± 119.4 | +0.0 ± 0.0 |
| hu-raiser-100-big | 1000 | +17.1 ± 90.0 | +17.1 ± 90.0 | +0.0 ± 0.0 |
| six-40-std | 1000 | +73.0 ± 71.7 | +71.3 ± 70.7 | -1.7 ± 18.1 |
| six-40-big | 1000 | +81.4 ± 64.9 | +53.6 ± 64.1 | -27.8 ± 38.6 |
| six-100-std | 1000 | +172.1 ± 131.4 | +133.8 ± 130.8 | -38.3 ± 50.1 |
| six-100-big | 1000 | +29.5 ± 109.6 | +5.1 ± 103.0 | -24.4 ± 47.2 |
| six-200-std | 1000 | +419.7 ± 244.8 | +383.5 ± 236.7 | -36.2 ± 109.1 |
| six-200-big | 1000 | +304.4 ± 250.9 | +340.9 ± 244.2 | +36.5 ± 61.7 |
| nine-40-std | 1000 | +90.7 ± 58.9 | +82.4 ± 62.5 | -8.3 ± 19.1 |
| nine-40-big | 1000 | +97.2 ± 71.0 | +92.2 ± 67.7 | -5.0 ± 21.3 |
| nine-100-std | 1000 | +209.2 ± 138.9 | +189.1 ± 140.1 | -20.1 ± 55.9 |
| nine-100-big | 1000 | +238.6 ± 161.3 | +265.0 ± 168.0 | +26.4 ± 74.3 |
| nine-200-std | 1000 | +216.1 ± 189.8 | +219.9 ± 210.0 | +3.8 ± 98.4 |
| nine-200-big | 1000 | +219.6 ± 200.6 | +121.8 ± 195.1 | -97.8 ± 83.7 * |

| pooled over the cells above | bb/100 (no rake) | − v2 (no rake) | bb/100 (5% rake, 3bb cap) | − v2 (rake) |
|---|---|---|---|---|
| v2 | +200.7 ± 27.6 | — | +184.4 ± 27.1 | — |
| v2c | +193.9 ± 27.6 | -6.9 ± 7.9 | +177.6 ± 27.1 | -6.7 ± 7.8 |

`*`: the 95% interval excludes 0.

| engine | preflop decisions | VPIP | sources (share of preflop decisions) | legality-gate replacements | illegal actions | preflop latency median / p95 |
|---|---|---|---|---|---|---|
| v2 | 24848 | 43.4% | hu-chart 44.4%, chart-approx 25.2%, heuristic 24.2%, chart 5.3%, computed 0.8% | 0 | 0 | 1.3 / 2.8 ms |
| v2c | 24830 | 43.0% | hu-chart 44.5%, heuristic 26.0%, chart-approx 23.4%, chart 5.3%, computed 0.8% | 0 | 0 | 1.3 / 2.7 ms |

| situation | engine | decisions | fold | check | call | raise | all-in |
|---|---|---|---|---|---|---|---|
| cold-facing-3bet | v2 | 530 | 98.1% | 0.0% | 0.4% | 1.1% | 0.4% |
| cold-facing-3bet | v2c | 530 | 98.1% | 0.0% | 0.4% | 1.1% | 0.4% |
| cold-facing-4bet-plus | v2 | 16 | 87.5% | 0.0% | 12.5% | 0.0% | 0.0% |
| cold-facing-4bet-plus | v2c | 16 | 87.5% | 0.0% | 12.5% | 0.0% | 0.0% |
| facing-3bet | v2 | 679 | 61.4% | 0.0% | 31.7% | 2.8% | 4.1% |
| facing-3bet | v2c | 679 | 62.2% | 0.0% | 31.1% | 2.4% | 4.4% |
| facing-4bet | v2 | 87 | 81.6% | 0.0% | 18.4% | 0.0% | 0.0% |
| facing-4bet | v2c | 66 | 78.8% | 0.0% | 21.2% | 0.0% | 0.0% |
| facing-5bet-plus | v2 | 12 | 75.0% | 0.0% | 25.0% | 0.0% | 0.0% |
| facing-5bet-plus | v2c | 12 | 75.0% | 0.0% | 25.0% | 0.0% | 0.0% |
| facing-iso | v2 | 10 | 80.0% | 0.0% | 20.0% | 0.0% | 0.0% |
| facing-iso | v2c | 10 | 80.0% | 0.0% | 20.0% | 0.0% | 0.0% |
| facing-limpers | v2 | 1286 | 75.7% | 0.0% | 1.4% | 22.9% | 0.0% |
| facing-limpers | v2c | 1286 | 75.7% | 0.0% | 1.4% | 22.9% | 0.0% |
| facing-open | v2 | 5332 | 59.4% | 0.0% | 28.7% | 11.6% | 0.3% |
| facing-open | v2c | 5332 | 61.3% | 0.0% | 29.1% | 9.3% | 0.3% |
| facing-open-callers | v2 | 1559 | 75.0% | 0.0% | 20.0% | 3.9% | 1.1% |
| facing-open-callers | v2c | 1559 | 75.0% | 0.0% | 20.0% | 3.7% | 1.3% |
| facing-squeeze | v2 | 107 | 45.8% | 0.0% | 32.7% | 14.0% | 7.5% |
| facing-squeeze | v2c | 110 | 46.4% | 0.0% | 32.7% | 10.0% | 10.9% |
| limped-bb-option | v2 | 1689 | 0.0% | 71.6% | 0.0% | 28.4% | 0.0% |
| limped-bb-option | v2c | 1689 | 0.0% | 71.6% | 0.0% | 28.4% | 0.0% |
| unopened | v2 | 13541 | 52.0% | 0.0% | 0.0% | 48.0% | 0.0% |
| unopened | v2c | 13541 | 52.0% | 0.0% | 0.0% | 48.0% | 0.0% |

| first-in raise by position | BTN | CO | HJ | LJ | MP | SB | UTG | UTG+1 |
|---|---|---|---|---|---|---|---|---|
| v2 | 65.8% | 29.8% | 16.7% | 14.6% | 15.3% | 48.3% | 14.3% | 12.6% |
| v2c | 65.8% | 29.8% | 16.7% | 14.6% | 15.3% | 48.3% | 14.3% | 12.6% |
