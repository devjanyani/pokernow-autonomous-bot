## six-mixed (range-aware, tight-aggressive, range-equity, loose-passive, range-aware): 900 hands, seed 7200, measured seat plays v2; 274 postflop decisions valued in 229 s

Settings: engine 300 samples, continuation version 2 at 150 samples, flop 12 run-outs, turn 22 rivers, 1 repetition(s). Measured seat's result in the session itself: 112.5 bb/100 (one unpaired run; not a benchmark).

### six-mixed: value of version 2's choice minus version 1's choice (bb per decision, same state and cards)

| Decisions | All | Share where the two differ | Only where they differ |
|---|---|---|---|
| all postflop | -0.958 ± 1.148 (n=274) | 46% | -2.068 ± 2.467 (n=127) |
| flop | -0.551 ± 1.095 (n=157) | 44% | -1.253 ± 2.491 (n=69) |
| turn | -1.572 ± 3.052 (n=77) | 49% | -3.186 ± 6.184 (n=38) |
| river | -1.377 ± 3.042 (n=40) | 50% | -2.755 ± 6.100 (n=20) |

### six-mixed: version 2: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 93 | check 53%, bet small 19%, bet medium 4%, bet large 9%, bet overbet 15% | – | -2.79 ± 2.11 * (n=93) | – | -1.49 ± 1.03 * (n=93) | -1.47 ± 1.18 * (n=93) | -1.48 ± 1.56 (n=93) | -1.59 ± 2.23 (n=93) | – | – | – | – |
| flop, facing a bet | 64 | fold 69%, call 9%, raise medium 11%, raise large 9%, raise all-in 2% | -9.71 ± 7.24 * (n=64) | – | -1.39 ± 2.55 (n=64) | – | – | – | – | – | -4.44 ± 4.25 * (n=62) | -5.13 ± 5.07 * (n=60) | -24.11 ± 30.42 (n=10) |
| turn, checked to | 49 | check 47%, bet small 22%, bet medium 6%, bet large 10%, bet overbet 8%, bet all-in 6% | – | -4.53 ± 3.79 * (n=49) | – | -0.76 ± 2.22 (n=47) | -0.10 ± 1.62 (n=46) | +0.28 ± 2.20 (n=45) | -1.74 ± 2.80 (n=41) | -4.22 ± 9.77 (n=10) | – | – | – |
| turn, facing a bet | 28 | fold 54%, call 36%, raise medium 7%, raise all-in 4% | -28.49 ± 17.96 * (n=28) | – | -0.54 ± 5.46 (n=28) | – | – | – | – | – | -11.41 ± 11.75 (n=17) | -16.41 ± 14.07 * (n=13) | -10.90 ± 25.24 (n=17) |
| river, checked to | 31 | check 55%, bet small 10%, bet medium 6%, bet overbet 10%, bet all-in 19% | – | -3.92 ± 5.97 (n=31) | – | -0.11 ± 6.17 (n=28) | -3.40 ± 6.88 (n=25) | -1.87 ± 9.06 (n=22) | +1.96 ± 2.84 (n=21) | -6.27 ± 17.39 (n=12) | – | – | – |
| river, facing a bet | 9 | fold 78%, call 11%, raise all-in 11% | -34.67 ± 45.22 (n=9) | – | -17.39 ± 8.48 * (n=9) | – | – | – | – | – | -12.80 ± 32.21 (n=4) | -9.47 ± 41.91 (n=3) | -37.44 ± 45.15 (n=5) |

### six-mixed: version 1: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 93 | check 38%, bet small 25%, bet medium 3%, bet large 8%, bet overbet 27% | – | -2.58 ± 2.19 * (n=93) | – | -1.28 ± 1.21 * (n=93) | -1.26 ± 1.27 (n=93) | -1.28 ± 1.51 (n=93) | -1.38 ± 2.12 (n=93) | – | – | – | – |
| flop, facing a bet | 64 | fold 50%, call 33%, raise medium 2%, raise large 11%, raise all-in 5% | -11.37 ± 7.27 * (n=64) | – | -3.04 ± 2.81 * (n=64) | – | – | – | – | – | -5.79 ± 3.82 * (n=62) | -6.53 ± 4.30 * (n=60) | -29.24 ± 24.59 * (n=10) |
| turn, checked to | 49 | check 27%, bet small 18%, bet medium 4%, bet large 20%, bet overbet 14%, bet all-in 16% | – | -4.56 ± 3.80 * (n=49) | – | -0.80 ± 2.79 (n=47) | -0.14 ± 2.28 (n=46) | +0.24 ± 2.45 (n=45) | -2.47 ± 1.86 * (n=41) | -1.50 ± 3.82 (n=10) | – | – | – |
| turn, facing a bet | 28 | fold 43%, call 29%, raise medium 4%, raise all-in 25% | -32.76 ± 18.69 * (n=28) | – | -4.81 ± 4.90 (n=28) | – | – | – | – | – | -14.76 ± 11.04 * (n=17) | -17.24 ± 13.32 * (n=13) | -18.91 ± 20.15 (n=17) |
| river, checked to | 31 | check 23%, bet small 19%, bet medium 10%, bet large 3%, bet overbet 16%, bet all-in 29% | – | -6.10 ± 6.92 (n=31) | – | -2.52 ± 5.62 (n=28) | -4.04 ± 5.93 (n=25) | -3.43 ± 8.36 (n=22) | +0.34 ± 4.28 (n=21) | -10.97 ± 12.04 (n=12) | – | – | – |
| river, facing a bet | 9 | fold 67%, call 22%, raise all-in 11% | -33.29 ± 45.80 (n=9) | – | -16.01 ± 9.26 * (n=9) | – | – | – | – | – | -9.69 ± 37.98 (n=4) | -5.32 ± 50.05 (n=3) | -34.95 ± 49.00 (n=5) |

### six-mixed: version 2's own EV estimate minus the reference value (bb; positive = the engine is optimistic)

| Action | All streets | Flop | Turn | River |
|---|---|---|---|---|
| check | -5.47 ± 3.32 * (n=173) | -5.76 ± 3.59 * (n=93) | -3.83 ± 8.12 (n=49) | -7.17 ± 8.11 (n=31) |
| call | -9.64 ± 5.39 * (n=101) | -7.22 ± 5.16 * (n=64) | -15.48 ± 13.04 * (n=28) | -8.64 ± 27.01 (n=9) |
| bets and raises | -8.17 ± 1.77 * (n=860) | -7.30 ± 2.04 * (n=504) | -11.30 ± 3.93 * (n=236) | -5.70 ± 5.21 * (n=120) |

