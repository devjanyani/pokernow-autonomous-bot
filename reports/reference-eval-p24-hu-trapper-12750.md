## hu-trapper (trapper): 600 hands, seed 12750, measured seat plays v3; 548 postflop decisions valued in 553 s

Settings: engine 300 samples, continuation version 2 at 150 samples, flop 12 run-outs, turn 22 rivers, 1 repetition(s). Measured seat's result in the session itself: 101.7 bb/100 (one unpaired run; not a benchmark).

### hu-trapper: value of version 3's choice minus version 2's choice (bb per decision, same state and cards)

| Decisions | All | Share where the two differ | Only where they differ |
|---|---|---|---|
| all postflop | -0.148 ± 0.402 (n=548) | 35% | -0.426 ± 1.154 (n=191) |
| flop | -0.478 ± 0.486 (n=217) | 44% | -1.092 ± 1.101 (n=95) |
| turn | +0.619 ± 0.840 (n=178) | 38% | +1.619 ± 2.187 (n=68) |
| river | -0.573 ± 0.790 (n=153) | 18% | -3.130 ± 4.251 (n=28) |

### hu-trapper: version 3: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 204 | check 49%, bet small 16%, bet medium 10%, bet large 10%, bet overbet 16% | – | -2.01 ± 1.08 * (n=204) | – | -0.47 ± 1.09 (n=146) | -0.14 ± 0.63 (n=204) | -0.23 ± 0.59 (n=204) | -0.13 ± 0.70 (n=204) | -54.67 (n=1) | – | – | – |
| flop, facing a bet | 13 | fold 46%, call 31%, raise large 23% | +3.19 ± 9.65 (n=13) | – | +2.22 ± 6.55 (n=13) | – | – | – | – | – | -8.10 ± 6.88 * (n=13) | -4.72 ± 3.79 * (n=12) | -37.54 ± 32.91 * (n=2) |
| turn, checked to | 162 | check 49%, bet small 9%, bet medium 9%, bet large 15%, bet overbet 19% | – | -1.27 ± 2.02 (n=162) | – | -2.27 ± 1.93 * (n=131) | -2.04 ± 1.23 * (n=162) | -1.80 ± 1.10 * (n=161) | -2.62 ± 1.30 * (n=159) | -26.32 ± 32.12 (n=4) | – | – | – |
| turn, facing a bet | 16 | fold 25%, call 50%, raise medium 6%, raise large 6%, raise all-in 13% | +14.04 ± 12.62 * (n=16) | – | -5.99 ± 8.11 (n=16) | – | – | – | – | – | -9.48 ± 10.45 (n=10) | -9.71 ± 13.28 (n=9) | -34.97 ± 35.56 (n=7) |
| river, checked to | 104 | check 51%, bet small 15%, bet medium 11%, bet large 7%, bet overbet 8%, bet all-in 9% | – | -4.53 ± 3.29 * (n=104) | – | -2.80 ± 3.11 (n=84) | -2.12 ± 2.11 * (n=96) | -1.25 ± 1.87 (n=92) | -2.70 ± 2.41 * (n=89) | +9.99 ± 15.98 (n=16) | – | – | – |
| river, facing a bet | 49 | fold 71%, call 20%, raise medium 2%, raise large 2%, raise all-in 4% | -2.57 ± 8.20 (n=49) | – | -6.92 ± 5.56 * (n=49) | – | – | – | – | – | -18.58 ± 4.49 * (n=39) | -27.30 ± 7.17 * (n=37) | -46.72 ± 26.53 * (n=18) |

### hu-trapper: version 2: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 204 | check 37%, bet small 24%, bet medium 20%, bet large 7%, bet overbet 12% | – | -2.40 ± 1.11 * (n=204) | – | -1.11 ± 0.97 * (n=146) | -0.52 ± 0.54 (n=204) | -0.61 ± 0.50 * (n=204) | -0.51 ± 0.69 (n=204) | -54.67 (n=1) | – | – | – |
| flop, facing a bet | 13 | fold 54%, call 23%, raise medium 15%, raise large 8% | +1.23 ± 7.76 (n=13) | – | +0.26 ± 8.53 (n=13) | – | – | – | – | – | -10.06 ± 12.03 (n=13) | -3.87 ± 4.34 (n=12) | -55.38 ± 67.86 (n=2) |
| turn, checked to | 162 | check 46%, bet small 20%, bet medium 8%, bet large 8%, bet overbet 17%, bet all-in 1% | – | -0.43 ± 2.07 (n=162) | – | -1.20 ± 1.86 (n=131) | -1.20 ± 1.19 * (n=162) | -0.95 ± 1.18 (n=161) | -1.99 ± 1.28 * (n=159) | -17.58 ± 33.95 (n=4) | – | – | – |
| turn, facing a bet | 16 | fold 50%, call 25%, raise medium 6%, raise large 6%, raise all-in 13% | +12.45 ± 12.57 (n=16) | – | -7.58 ± 8.51 (n=16) | – | – | – | – | – | -12.03 ± 13.87 (n=10) | -12.54 ± 19.20 (n=9) | -38.87 ± 38.39 * (n=7) |
| river, checked to | 104 | check 65%, bet small 8%, bet medium 6%, bet large 6%, bet overbet 8%, bet all-in 8% | – | -5.30 ± 3.31 * (n=104) | – | -3.73 ± 3.08 * (n=84) | -2.59 ± 2.08 * (n=96) | -2.04 ± 1.89 * (n=92) | -3.53 ± 2.31 * (n=89) | +9.60 ± 15.85 (n=16) | – | – | – |
| river, facing a bet | 49 | fold 73%, call 18%, raise medium 2%, raise large 2%, raise all-in 4% | -2.74 ± 8.19 (n=49) | – | -7.09 ± 5.55 * (n=49) | – | – | – | – | – | -18.79 ± 4.48 * (n=39) | -27.53 ± 7.18 * (n=37) | -46.72 ± 26.53 * (n=18) |

### hu-trapper: version 3's own EV estimate minus the reference value (bb; positive = the engine is optimistic)

| Action | All streets | Flop | Turn | River |
|---|---|---|---|---|
| check | +0.68 ± 1.15 (n=470) | +0.45 ± 1.63 (n=204) | +1.71 ± 2.51 (n=162) | -0.46 ± 1.31 (n=104) |
| call | +9.68 ± 5.89 * (n=78) | +2.22 ± 11.72 (n=13) | +25.99 ± 15.20 * (n=16) | +6.33 ± 6.84 (n=49) |
| bets and raises | +1.48 ± 0.92 * (n=2008) | -0.81 ± 0.88 (n=844) | +4.23 ± 1.93 * (n=674) | +1.65 ± 2.16 (n=490) |

