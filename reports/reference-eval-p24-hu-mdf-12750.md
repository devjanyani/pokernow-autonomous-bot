## hu-mdf (mdf-defender): 600 hands, seed 12750, measured seat plays v3; 335 postflop decisions valued in 378 s

Settings: engine 300 samples, continuation version 2 at 150 samples, flop 12 run-outs, turn 22 rivers, 1 repetition(s). Measured seat's result in the session itself: 86.1 bb/100 (one unpaired run; not a benchmark).

### hu-mdf: value of version 3's choice minus version 2's choice (bb per decision, same state and cards)

| Decisions | All | Share where the two differ | Only where they differ |
|---|---|---|---|
| all postflop | -0.003 ± 0.472 (n=335) | 33% | -0.009 ± 1.440 (n=110) |
| flop | +0.055 ± 0.536 (n=140) | 44% | +0.125 ± 1.216 (n=62) |
| turn | -0.246 ± 0.970 (n=115) | 28% | -0.884 ± 3.517 (n=32) |
| river | +0.244 ± 1.045 (n=80) | 20% | +1.222 ± 5.333 (n=16) |

### hu-mdf: version 3: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 126 | check 40%, bet small 21%, bet medium 13%, bet large 12%, bet overbet 14% | – | -2.26 ± 1.44 * (n=126) | – | -1.09 ± 1.27 (n=110) | -0.66 ± 0.91 (n=126) | -0.70 ± 1.11 (n=126) | -0.39 ± 1.01 (n=126) | – | – | – | – |
| flop, facing a bet | 14 | fold 57%, call 29%, raise large 14% | +17.57 ± 14.72 * (n=14) | – | -0.17 ± 10.82 (n=14) | – | – | – | – | – | -21.37 ± 17.60 * (n=13) | -29.84 ± 14.95 * (n=13) | -37.92 ± 74.32 (n=2) |
| turn, checked to | 97 | check 51%, bet small 15%, bet medium 4%, bet large 6%, bet overbet 23%, bet all-in 1% | – | -1.73 ± 2.58 (n=97) | – | -2.28 ± 2.23 * (n=89) | -1.71 ± 1.83 (n=96) | -1.77 ± 1.64 * (n=96) | -1.35 ± 1.33 * (n=95) | -31.38 ± 61.50 (n=2) | – | – | – |
| turn, facing a bet | 18 | fold 50%, call 33%, raise medium 6%, raise all-in 11% | -1.93 ± 14.67 (n=18) | – | -0.39 ± 3.94 (n=18) | – | – | – | – | – | -23.81 ± 12.60 * (n=15) | -25.91 ± 12.92 * (n=15) | -35.40 ± 33.72 * (n=7) |
| river, checked to | 65 | check 48%, bet small 20%, bet medium 3%, bet large 8%, bet overbet 14%, bet all-in 8% | – | -4.75 ± 4.09 * (n=65) | – | -5.49 ± 3.95 * (n=62) | -5.50 ± 3.80 * (n=61) | -3.08 ± 3.31 (n=58) | -1.30 ± 2.75 (n=58) | -8.68 ± 21.19 (n=9) | – | – | – |
| river, facing a bet | 15 | fold 87%, call 7%, raise medium 7% | -1.01 ± 1.66 (n=15) | – | -9.00 ± 4.08 * (n=15) | – | – | – | – | – | -32.16 ± 19.00 * (n=13) | -31.92 ± 14.24 * (n=11) | -62.40 ± 40.80 * (n=4) |

### hu-mdf: version 2: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 126 | check 34%, bet small 25%, bet medium 21%, bet large 4%, bet overbet 17% | – | -2.12 ± 1.35 * (n=126) | – | -0.91 ± 1.18 (n=110) | -0.52 ± 0.83 (n=126) | -0.56 ± 1.06 (n=126) | -0.26 ± 1.02 (n=126) | – | – | – | – |
| flop, facing a bet | 14 | fold 64%, call 21%, raise medium 7%, raise all-in 7% | +16.88 ± 14.71 * (n=14) | – | -0.86 ± 10.64 (n=14) | – | – | – | – | – | -22.11 ± 17.24 * (n=13) | -30.58 ± 14.55 * (n=13) | -37.92 ± 74.32 (n=2) |
| turn, checked to | 97 | check 47%, bet small 23%, bet medium 4%, bet large 7%, bet overbet 19% | – | -1.60 ± 2.42 (n=97) | – | -2.16 ± 1.94 * (n=89) | -1.58 ± 1.62 (n=96) | -1.63 ± 1.65 (n=96) | -1.22 ± 1.51 (n=95) | -31.38 ± 61.50 (n=2) | – | – | – |
| turn, facing a bet | 18 | fold 61%, call 22%, raise large 6%, raise all-in 11% | -4.21 ± 15.20 (n=18) | – | -2.67 ± 3.41 (n=18) | – | – | – | – | – | -26.55 ± 13.57 * (n=15) | -28.65 ± 13.52 * (n=15) | -37.50 ± 31.11 * (n=7) |
| river, checked to | 65 | check 62%, bet small 9%, bet medium 6%, bet large 3%, bet overbet 12%, bet all-in 8% | – | -4.45 ± 3.94 * (n=65) | – | -5.20 ± 3.92 * (n=62) | -5.18 ± 3.88 * (n=61) | -2.74 ± 3.55 (n=58) | -0.96 ± 2.60 (n=58) | -4.82 ± 20.24 (n=9) | – | – | – |
| river, facing a bet | 15 | fold 87%, call 7%, raise medium 7% | -1.01 ± 1.66 (n=15) | – | -9.00 ± 4.08 * (n=15) | – | – | – | – | – | -32.16 ± 19.00 * (n=13) | -31.92 ± 14.24 * (n=11) | -62.40 ± 40.80 * (n=4) |

### hu-mdf: version 3's own EV estimate minus the reference value (bb; positive = the engine is optimistic)

| Action | All streets | Flop | Turn | River |
|---|---|---|---|---|
| check | +0.24 ± 1.35 (n=288) | +0.27 ± 1.13 (n=126) | +1.07 ± 3.15 (n=97) | -1.05 ± 2.96 (n=65) |
| call | +9.29 ± 6.46 * (n=47) | +19.80 ± 14.04 * (n=14) | +6.08 ± 12.03 (n=18) | +3.33 ± 2.57 * (n=15) |
| bets and raises | +1.80 ± 1.08 * (n=1234) | +0.67 ± 1.40 (n=532) | +2.93 ± 1.89 * (n=423) | +2.23 ± 2.71 (n=279) |

