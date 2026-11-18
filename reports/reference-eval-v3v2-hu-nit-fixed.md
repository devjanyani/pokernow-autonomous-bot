## hu-nit (nit): 600 hands, seed 12500, measured seat plays v3; 108 postflop decisions valued in 99 s

Settings: engine 300 samples, continuation version 2 at 150 samples, flop 12 run-outs, turn 22 rivers, 1 repetition(s). Measured seat's result in the session itself: 13.7 bb/100 (one unpaired run; not a benchmark).

### hu-nit: value of version 3's choice minus version 2's choice (bb per decision, same state and cards)

| Decisions | All | Share where the two differ | Only where they differ |
|---|---|---|---|
| all postflop | -0.922 ± 2.026 (n=108) | 48% | -1.915 ± 4.213 (n=52) |
| flop | +0.796 ± 2.629 (n=59) | 49% | +1.620 ± 5.381 (n=29) |
| turn | -1.443 ± 2.406 (n=32) | 41% | -3.552 ± 5.867 (n=13) |
| river | -5.906 ± 7.603 (n=17) | 59% | -10.040 ± 12.528 (n=10) |

### hu-nit: version 3: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 45 | check 58%, bet small 24%, bet medium 9%, bet large 2%, bet overbet 7% | – | +0.26 ± 1.23 (n=45) | – | -0.20 ± 1.70 (n=45) | -0.60 ± 1.16 (n=45) | -0.21 ± 1.24 (n=45) | +0.01 ± 2.41 (n=45) | 24.53 (n=1) | – | – | – |
| flop, facing a bet | 14 | fold 50%, call 21%, raise medium 21%, raise large 7% | +3.12 ± 3.35 (n=14) | – | -3.77 ± 5.83 (n=14) | – | – | – | – | – | -13.89 ± 7.68 * (n=14) | -21.73 ± 9.69 * (n=13) | -58.04 ± 11.80 * (n=2) |
| turn, checked to | 24 | check 42%, bet small 25%, bet medium 13%, bet large 17%, bet overbet 4% | – | +3.61 ± 4.09 (n=24) | – | +0.45 ± 0.99 (n=23) | -0.74 ± 1.55 (n=23) | -0.72 ± 2.49 (n=23) | -3.92 ± 5.74 (n=23) | -30.41 (n=1) | – | – | – |
| turn, facing a bet | 8 | fold 50%, call 50% | +1.64 ± 2.13 (n=8) | – | -3.15 ± 4.07 (n=8) | – | – | – | – | – | -23.95 ± 13.30 * (n=6) | -23.62 ± 10.24 * (n=6) | -41.13 ± 43.00 (n=2) |
| river, checked to | 13 | check 15%, bet small 8%, bet medium 8%, bet overbet 46%, bet all-in 23% | – | +0.42 ± 16.53 (n=13) | – | +8.72 ± 9.44 (n=12) | +8.00 ± 8.03 (n=12) | +7.25 ± 8.79 (n=12) | +0.00 ± 0.00 (n=9) | +18.46 ± 36.19 (n=4) | – | – | – |
| river, facing a bet | 4 | fold 75%, call 25% | -13.70 ± 26.85 (n=4) | – | -20.09 ± 23.82 (n=4) | – | – | – | – | – | -10.65 (n=1) | -16.25 (n=1) | -11.75 ± 142.30 (n=2) |

### hu-nit: version 2: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 45 | check 20%, bet small 58%, bet medium 9%, bet overbet 13% | – | -0.74 ± 1.65 (n=45) | – | -1.20 ± 1.09 * (n=45) | -1.60 ± 1.40 * (n=45) | -1.21 ± 1.40 (n=45) | -0.99 ± 1.44 (n=45) | 9.33 (n=1) | – | – | – |
| flop, facing a bet | 14 | fold 57%, call 7%, raise medium 7%, raise large 21%, raise all-in 7% | +9.69 ± 10.39 (n=14) | – | +2.81 ± 8.97 (n=14) | – | – | – | – | – | -7.32 ± 10.92 (n=14) | -18.65 ± 8.66 * (n=13) | -32.03 ± 62.78 (n=2) |
| turn, checked to | 24 | check 38%, bet small 33%, bet medium 4%, bet large 8%, bet overbet 17% | – | +1.99 ± 3.14 (n=24) | – | -1.24 ± 3.38 (n=23) | -2.43 ± 3.02 (n=23) | -2.42 ± 2.83 (n=23) | -5.62 ± 5.99 (n=23) | -30.41 (n=1) | – | – | – |
| turn, facing a bet | 8 | fold 75%, call 25% | +0.74 ± 1.94 (n=8) | – | -4.05 ± 3.87 * (n=8) | – | – | – | – | – | -25.15 ± 13.75 * (n=6) | -24.82 ± 10.93 * (n=6) | -41.13 ± 43.00 (n=2) |
| river, checked to | 13 | check 38%, bet small 8%, bet medium 8%, bet large 15%, bet overbet 15%, bet all-in 15% | – | -7.31 ± 14.44 (n=13) | – | +0.36 ± 7.35 (n=12) | -0.36 ± 4.07 (n=12) | -1.11 ± 4.02 (n=12) | -0.97 ± 4.58 (n=9) | -4.45 ± 24.88 (n=4) | – | – | – |
| river, facing a bet | 4 | fold 75%, call 25% | -13.70 ± 26.85 (n=4) | – | -20.09 ± 23.82 (n=4) | – | – | – | – | – | -10.65 (n=1) | -16.25 (n=1) | -11.75 ± 142.30 (n=2) |

### hu-nit: version 3's own EV estimate minus the reference value (bb; positive = the engine is optimistic)

| Action | All streets | Flop | Turn | River |
|---|---|---|---|---|
| check | +3.29 ± 4.01 (n=82) | +0.86 ± 4.57 (n=45) | +0.99 ± 1.37 (n=24) | +15.90 ± 18.72 (n=13) |
| call | +6.97 ± 6.36 * (n=26) | +9.48 ± 8.58 * (n=14) | +7.93 ± 7.58 * (n=8) | -3.72 ± 25.16 (n=4) |
| bets and raises | +5.59 ± 1.99 * (n=370) | +4.34 ± 2.26 * (n=210) | +7.96 ± 3.12 * (n=107) | +5.78 ± 8.61 (n=53) |

