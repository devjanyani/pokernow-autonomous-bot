## hu-ra (range-aware): 600 hands, seed 12300, measured seat plays v3; 426 postflop decisions valued in 403 s

Settings: engine 300 samples, continuation version 2 at 150 samples, flop 12 run-outs, turn 22 rivers, 1 repetition(s). Measured seat's result in the session itself: 34.4 bb/100 (one unpaired run; not a benchmark).

### hu-ra: value of version 3's choice minus version 2's choice (bb per decision, same state and cards)

| Decisions | All | Share where the two differ | Only where they differ |
|---|---|---|---|
| all postflop | +0.195 ± 0.556 (n=426) | 38% | +0.513 ± 1.463 (n=162) |
| flop | -0.056 ± 0.502 (n=224) | 39% | -0.143 ± 1.296 (n=87) |
| turn | -0.221 ± 0.902 (n=138) | 36% | -0.622 ± 2.553 (n=49) |
| river | +1.968 ± 2.590 (n=64) | 41% | +4.844 ± 6.282 (n=26) |

### hu-ra: version 3: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 169 | check 47%, bet small 37%, bet medium 9%, bet large 1%, bet overbet 6% | – | -0.38 ± 0.65 (n=169) | – | -0.53 ± 0.69 (n=127) | -0.41 ± 0.67 (n=169) | -0.82 ± 0.61 * (n=169) | -1.06 ± 0.87 * (n=169) | – | – | – | – |
| flop, facing a bet | 55 | fold 49%, call 13%, raise medium 11%, raise large 27% | -2.47 ± 4.38 (n=55) | – | -0.74 ± 1.99 (n=55) | – | – | – | – | – | -2.12 ± 2.49 (n=54) | -3.66 ± 2.59 * (n=53) | -13.57 ± 22.86 (n=4) |
| turn, checked to | 105 | check 46%, bet small 25%, bet medium 12%, bet large 4%, bet overbet 13% | – | +0.36 ± 0.60 (n=105) | – | +0.80 ± 0.98 (n=88) | +0.46 ± 1.04 (n=104) | -0.01 ± 1.21 (n=104) | +0.33 ± 1.32 (n=102) | -4.98 ± 39.02 (n=5) | – | – | – |
| turn, facing a bet | 33 | fold 64%, call 30%, raise large 3%, raise all-in 3% | -3.46 ± 10.07 (n=33) | – | -3.34 ± 3.87 (n=33) | – | – | – | – | – | -5.19 ± 7.52 (n=28) | -3.68 ± 7.92 (n=25) | -27.50 ± 32.68 (n=8) |
| river, checked to | 59 | check 31%, bet small 22%, bet medium 12%, bet large 3%, bet overbet 25%, bet all-in 7% | – | -5.29 ± 3.62 * (n=59) | – | -3.06 ± 2.86 * (n=50) | -0.97 ± 2.82 (n=57) | +0.59 ± 2.05 (n=55) | -0.76 ± 1.98 (n=53) | +0.72 ± 24.02 (n=10) | – | – | – |
| river, facing a bet | 5 | fold 40%, call 40%, raise all-in 20% | +3.41 ± 22.36 (n=5) | – | -1.97 ± 2.49 (n=5) | – | – | – | – | – | +1.88 ± 13.57 (n=4) | -0.04 ± 16.46 (n=4) | -12.72 ± 24.94 (n=2) |

### hu-ra: version 2: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 169 | check 21%, bet small 50%, bet medium 11%, bet large 7%, bet overbet 11% | – | -0.27 ± 0.53 (n=169) | – | -0.45 ± 0.73 (n=127) | -0.30 ± 0.57 (n=169) | -0.71 ± 0.82 (n=169) | -0.95 ± 0.96 (n=169) | – | – | – | – |
| flop, facing a bet | 55 | fold 56%, call 9%, raise medium 9%, raise large 24%, raise all-in 2% | -3.03 ± 4.44 (n=55) | – | -1.31 ± 2.40 (n=55) | – | – | – | – | – | -2.46 ± 2.69 (n=54) | -4.01 ± 3.28 * (n=53) | -24.06 ± 29.66 (n=4) |
| turn, checked to | 105 | check 39%, bet small 28%, bet medium 13%, bet large 9%, bet overbet 10%, bet all-in 1% | – | +0.51 ± 0.70 (n=105) | – | +0.98 ± 1.01 (n=88) | +0.58 ± 1.06 (n=104) | +0.10 ± 1.16 (n=104) | +0.43 ± 1.32 (n=102) | -3.95 ± 39.08 (n=5) | – | – | – |
| turn, facing a bet | 33 | fold 76%, call 21%, raise medium 3% | -4.86 ± 9.38 (n=33) | – | -4.74 ± 2.93 * (n=33) | – | – | – | – | – | -4.80 ± 7.75 (n=28) | -2.97 ± 8.11 (n=25) | -35.15 ± 32.50 * (n=8) |
| river, checked to | 59 | check 49%, bet small 15%, bet medium 10%, bet large 3%, bet overbet 19%, bet all-in 3% | – | -2.80 ± 3.24 (n=59) | – | -0.11 ± 2.50 (n=50) | +1.61 ± 3.43 (n=57) | +3.27 ± 3.02 * (n=55) | +2.02 ± 2.56 (n=53) | +11.83 ± 23.85 (n=10) | – | – | – |
| river, facing a bet | 5 | fold 80%, call 20% | -0.84 ± 1.65 (n=5) | – | -6.22 ± 21.93 (n=5) | – | – | – | – | – | +7.91 ± 17.18 (n=4) | +6.00 ± 20.29 (n=4) | -23.35 ± 93.10 (n=2) |

### hu-ra: version 3's own EV estimate minus the reference value (bb; positive = the engine is optimistic)

| Action | All streets | Flop | Turn | River |
|---|---|---|---|---|
| check | +1.00 ± 1.21 (n=333) | +0.05 ± 0.89 (n=169) | +1.82 ± 2.52 (n=105) | +2.25 ± 4.48 (n=59) |
| call | +2.76 ± 3.70 (n=93) | +1.34 ± 3.94 (n=55) | +4.81 ± 7.45 (n=33) | +4.81 ± 23.86 (n=5) |
| bets and raises | +0.31 ± 0.71 (n=1511) | +0.46 ± 0.77 (n=787) | +1.35 ± 1.49 (n=481) | -2.22 ± 2.16 * (n=243) |

