# v3 raise diagnostic (sim/bot/v3-raise-diag.ts), seed 12300, development

Predicted = version 3's model; actual = what the simulated opponent did. Columns after the decomposition exist only where recorded.

## Before the correction (0.8.0 knobs)

### hu-ra (with the opponent's own strength and fold probability)

| Group | n | actual fold | predicted fold (actual holding) | predicted fold (range) | actual re-raise | predicted re-raise (holding) | mean value from folds / calls / raises (chips) | strength: model / opponent itself | predicted fold with the opponent itself strength | fold probability of the range-aware opponent itself |
|---|---|---|---|---|---|---|---|---|---|---|
| flop bet | 158 | 51% ± 8 | 48% | 53% | 9% | 10% | 46.9 / 25.5 / 6.1 | 0.54 / 0.47 | 60% | 54% |
| flop check-raise | 142 | 67% ± 8 | 69% | 69% | 7% | 3% | 103.8 / -2.2 / -4.6 | 0.62 / 0.50 | 82% | 67% |
| flop raise | 23 | 43% ± 20 | 46% | 65% | 4% | 4% | 176.6 / 27.1 / -2.4 | 0.77 / 0.64 | 69% | 42% |
| flop reraise | 14 | 21% ± 21 | 44% * | 68% | 0% | 0% | 543.5 / -272.5 / -1.5 | 0.84 / 0.77 | 58% | 21% |
| river bet | 112 | 65% ± 9 | 72% | 73% | 4% | 4% | 217.7 / -13.1 / -5.0 | 0.51 / 0.46 | 80% | 70% |
| river check-raise | 19 | 58% ± 22 | 94% * | 88% | 0% | 0% | 298.7 / -73.4 / -4.0 | 0.66 / 0.57 | 97% | 73% |
| river raise | 14 | 57% ± 26 | 78% | 75% | 0% | 1% | 565.9 / -220.8 / -6.5 | 0.68 / 0.57 | 88% | 69% |
| river reraise | 3 | 67% ± 53 | 68% | 78% | 0% | 0% | 1117.0 / -68.5 / 0.0 | 0.50 / 0.45 | 82% | 66% |
| turn bet | 151 | 64% ± 8 | 59% | 58% | 4% | 4% | 84.2 / 60.9 / 4.7 | 0.50 / 0.42 | 72% | 61% |
| turn check-raise | 37 | 59% ± 16 | 78% * | 72% | 3% | 2% | 273.7 / -109.3 / -3.2 | 0.63 / 0.57 | 83% | 57% |
| turn raise | 16 | 38% ± 24 | 56% | 74% | 6% | 2% | 405.8 / -167.6 / -3.5 | 0.77 / 0.66 | 70% | 44% |
| turn reraise | 5 | 40% ± 43 | 54% | 72% | 0% | 0% | 739.0 / -147.3 / -0.4 | 0.61 / 0.56 | 59% | 40% |

### hu-tag
| Group | n | actual fold | predicted fold (actual holding) | predicted fold (range) | actual re-raise | predicted re-raise (holding) | mean value from folds / calls / raises (chips) |
|---|---|---|---|---|---|---|---|
| flop bet | 276 | 31% ± 5 | 25% * | 31% | 9% | 13% | 28.3 / 16.6 / 0.1 |
| flop check-raise | 51 | 39% ± 13 | 31% | 41% | 12% | 6% | 68.9 / 230.0 / 2.8 |
| flop raise | 27 | 26% ± 17 | 26% | 33% | 11% | 7% | 72.6 / 235.6 / 0.2 |
| flop reraise | 3 | 0% ± 0 | 0% * | 37% | 0% | 1% | 275.0 / -84.2 / -6.0 |
| river bet | 93 | 42% ± 10 | 46% | 47% | 11% | 7% | 243.8 / 213.6 / -0.1 |
| river raise | 4 | 0% ± 0 | 2% * | 35% | 0% | 0% | 526.8 / 1356.0 / 0.0 |
| river reraise | 1 | 100% ± 0 | 98% * | 22% | 0% | 0% | 314.3 / 1861.3 / 0.0 |
| turn bet | 144 | 47% ± 8 | 44% | 39% | 6% | 8% | 75.2 / 167.0 / 19.2 |
| turn check-raise | 8 | 38% ± 34 | 45% | 28% | 0% | 3% | 101.9 / -30.3 / -12.3 |
| turn raise | 4 | 50% ± 49 | 47% | 18% | 0% | 0% | 277.6 / 990.2 / -8.3 |
| turn reraise | 1 | 100% ± 0 | 95% * | 42% | 0% | 1% | 300.8 / 738.2 / 7.8 |

### hu-nit
| Group | n | actual fold | predicted fold (actual holding) | predicted fold (range) | actual re-raise | predicted re-raise (holding) | mean value from folds / calls / raises (chips) |
|---|---|---|---|---|---|---|---|
| flop bet | 58 | 71% ± 12 | 30% * | 53% | 2% | 16% | 63.0 / 34.6 / 12.4 |
| flop check-raise | 4 | 0% ± 0 | 4% * | 45% | 50% | 20% | 94.9 / 44.6 / -12.3 |
| flop raise | 7 | 0% ± 0 | 2% * | 51% | 14% | 6% | 122.6 / 58.5 / 4.6 |
| flop reraise | 2 | 0% ± 0 | 1% * | 44% | 0% | 0% | 549.1 / -263.5 / 0.0 |
| river bet | 30 | 60% ± 18 | 65% | 78% | 10% | 7% | 212.1 / 16.0 / -10.6 |
| river check-raise | 3 | 0% ± 0 | 96% * | 89% | 0% | 0% | 499.9 / -197.0 / 0.0 |
| river raise | 4 | 0% ± 0 | 27% * | 59% | 0% | 0% | 504.3 / -25.8 / -0.1 |
| river reraise | 1 | 0% ± 0 | 0% * | 60% | 0% | 0% | 1441.0 / -516.0 / 0.0 |
| turn bet | 68 | 74% ± 10 | 26% * | 55% | 4% | 10% | 82.4 / 52.1 / 8.2 |
| turn raise | 1 | 0% ± 0 | 0% | 39% | 0% | 0% | 827.9 / -245.3 / 0.0 |

### hu-re
| Group | n | actual fold | predicted fold (actual holding) | predicted fold (range) | actual re-raise | predicted re-raise (holding) | mean value from folds / calls / raises (chips) |
|---|---|---|---|---|---|---|---|
| flop bet | 95 | 61% ± 10 | 29% * | 44% | 7% | 13% | 43.3 / 28.6 / 8.4 |
| flop check-raise | 7 | 0% ± 0 | 1% * | 42% | 86% | 19% | 78.9 / 42.8 / -12.4 |
| flop raise | 6 | 0% ± 0 | 2% * | 39% | 33% | 10% | 122.2 / 321.7 / 2.3 |
| flop reraise | 1 | 0% ± 0 | 0% | 16% | 0% | 0% | 416.2 / -203.7 / 0.0 |
| river bet | 55 | 49% ± 13 | 56% | 63% | 9% | 6% | 165.6 / 43.7 / -5.3 |
| river raise | 3 | 0% ± 0 | 28% * | 38% | 0% | 0% | 263.5 / 617.7 / -2.9 |
| turn bet | 64 | 59% ± 12 | 35% * | 48% | 3% | 7% | 77.3 / 107.3 / 16.3 |
| turn raise | 2 | 0% ± 0 | 32% * | 25% | 0% | 0% | 406.0 / 497.8 / 0.0 |

### hu-lag
| Group | n | actual fold | predicted fold (actual holding) | predicted fold (range) | actual re-raise | predicted re-raise (holding) | mean value from folds / calls / raises (chips) |
|---|---|---|---|---|---|---|---|
| flop bet | 358 | 33% ± 5 | 31% | 29% | 11% | 13% | 30.8 / 20.4 / -0.8 |
| flop check-raise | 85 | 45% ± 11 | 43% | 41% | 9% | 5% | 69.5 / 229.9 / 1.8 |
| flop raise | 44 | 39% ± 14 | 36% | 33% | 11% | 5% | 68.2 / 261.6 / -1.6 |
| flop reraise | 4 | 0% ± 0 | 12% * | 37% | 0% | 0% | 474.9 / -67.6 / 0.0 |
| river bet | 103 | 40% ± 9 | 49% * | 44% | 9% | 8% | 291.6 / 355.3 / -1.8 |
| river raise | 4 | 0% ± 0 | 4% * | 25% | 0% | 0% | 596.7 / 1095.4 / 0.0 |
| turn bet | 160 | 42% ± 8 | 45% | 39% | 11% | 11% | 91.4 / 240.8 / 27.9 |
| turn check-raise | 14 | 36% ± 25 | 38% | 28% | 7% | 2% | 89.5 / 72.1 / -6.3 |
| turn raise | 9 | 33% ± 31 | 44% | 26% | 0% | 0% | 318.4 / 777.1 / -9.5 |
| turn reraise | 3 | 100% ± 0 | 97% * | 42% | 0% | 1% | 413.8 / 382.0 / 12.5 |

## After the correction (residual calibration), hu-ra

| Group | n | actual fold | predicted fold (actual holding) | predicted fold (range) | actual re-raise | predicted re-raise (holding) | mean value from folds / calls / raises (chips) | strength: model / opponent itself | predicted fold with the opponent itself strength | fold probability of the range-aware opponent itself |
|---|---|---|---|---|---|---|---|---|---|---|
| flop bet | 204 | 52% ± 7 | 47% | 50% | 11% | 11% | 42.1 / 16.7 / 4.2 | 0.53 / 0.45 | 60% | 54% |
| flop check-raise | 108 | 64% ± 9 | 60% | 61% | 8% | 5% | 96.3 / 5.2 / -5.5 | 0.64 / 0.51 | 78% | 65% |
| flop raise | 12 | 33% ± 27 | 20% | 49% | 8% | 6% | 175.6 / 159.6 / -1.6 | 0.79 / 0.67 | 46% | 31% |
| flop reraise | 10 | 20% ± 25 | 40% | 49% | 0% | 1% | 323.2 / -212.5 / -2.7 | 0.77 / 0.67 | 57% | 29% |
| river bet | 125 | 68% ± 8 | 73% | 73% | 7% | 5% | 218.2 / -17.5 / -3.9 | 0.52 / 0.46 | 81% | 72% |
| river check-raise | 10 | 50% ± 31 | 83% * | 82% | 0% | 1% | 345.9 / -136.5 / -6.2 | 0.70 / 0.61 | 92% | 71% |
| river raise | 7 | 86% ± 26 | 54% * | 62% | 0% | 5% | 206.9 / -57.2 / -13.9 | 0.73 / 0.61 | 70% | 67% |
| river reraise | 5 | 60% ± 43 | 61% | 77% | 0% | 0% | 565.0 / -96.9 / -0.2 | 0.59 / 0.55 | 69% | 56% |
| turn bet | 177 | 59% ± 7 | 59% | 55% | 2% | 5% | 87.8 / 54.9 / 3.6 | 0.49 / 0.41 | 72% | 60% |
| turn check-raise | 14 | 64% ± 25 | 69% | 65% | 0% | 2% | 290.7 / -182.6 / -4.4 | 0.62 / 0.56 | 80% | 55% |
| turn raise | 1 | 0% ± 0 | 4% * | 56% | 0% | 0% | 812.2 / -447.8 / 0.0 | 0.79 / 0.75 | 8% | 3% |
| turn reraise | 2 | 50% ± 69 | 50% | 50% | 0% | 0% | 675.8 / 362.9 / -2.9 | 0.49 / 0.43 | 51% | 50% |
