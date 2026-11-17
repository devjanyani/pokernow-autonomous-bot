## hu-tag (tight-aggressive): 800 hands, seed 7100, measured seat plays v2; 539 postflop decisions valued in 434 s

Settings: engine 300 samples, continuation version 2 at 150 samples, flop 12 run-outs, turn 22 rivers, 1 repetition(s). Measured seat's result in the session itself: 7.7 bb/100 (one unpaired run; not a benchmark).

### hu-tag: value of version 2's choice minus version 1's choice (bb per decision, same state and cards)

| Decisions | All | Share where the two differ | Only where they differ |
|---|---|---|---|
| all postflop | -0.643 ± 0.363 * (n=539) | 39% | -1.635 ± 0.908 * (n=212) |
| flop | -0.214 ± 0.403 (n=291) | 34% | -0.636 ± 1.196 (n=98) |
| turn | -0.494 ± 0.455 * (n=161) | 42% | -1.187 ± 1.077 * (n=67) |
| river | -2.354 ± 1.550 * (n=87) | 54% | -4.357 ± 2.753 * (n=47) |

### hu-tag: version 2: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 206 | check 24%, bet small 47%, bet medium 15%, bet large 4%, bet overbet 11% | – | +0.06 ± 0.55 (n=206) | – | -0.05 ± 0.78 (n=155) | -0.24 ± 0.57 (n=206) | -0.30 ± 0.51 (n=206) | -0.85 ± 0.54 * (n=206) | – | – | – | – |
| flop, facing a bet | 85 | fold 71%, call 8%, raise medium 12%, raise large 9% | -3.01 ± 3.75 (n=85) | – | -0.76 ± 1.77 (n=85) | – | – | – | – | – | -3.57 ± 2.68 * (n=85) | -5.51 ± 3.37 * (n=83) | -10.80 ± 18.06 (n=6) |
| turn, checked to | 118 | check 45%, bet small 29%, bet medium 5%, bet large 8%, bet overbet 13% | – | -0.56 ± 0.75 (n=118) | – | -0.51 ± 1.43 (n=103) | -0.98 ± 1.24 (n=118) | -1.30 ± 1.30 * (n=118) | -1.08 ± 0.98 * (n=117) | 2.36 (n=1) | – | – | – |
| turn, facing a bet | 43 | fold 60%, call 19%, raise medium 9%, raise large 2%, raise all-in 9% | +0.34 ± 9.32 (n=43) | – | -0.77 ± 2.68 (n=43) | – | – | – | – | – | -7.74 ± 4.52 * (n=38) | -13.88 ± 6.49 * (n=34) | -12.29 ± 11.85 * (n=15) |
| river, checked to | 64 | check 59%, bet small 19%, bet medium 11%, bet large 3%, bet overbet 5%, bet all-in 3% | – | -2.12 ± 3.10 (n=64) | – | -1.01 ± 2.30 (n=55) | -0.43 ± 1.91 (n=62) | -0.77 ± 2.29 (n=59) | -0.43 ± 3.41 (n=58) | -7.11 ± 25.29 (n=7) | – | – | – |
| river, facing a bet | 23 | fold 65%, call 22%, raise large 4%, raise all-in 9% | -3.98 ± 9.31 (n=23) | – | -4.12 ± 4.88 (n=23) | – | – | – | – | – | -6.75 ± 9.57 (n=17) | -13.36 ± 13.35 * (n=16) | -32.84 ± 28.10 * (n=12) |

### hu-tag: version 1: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 206 | check 9%, bet small 49%, bet medium 20%, bet large 10%, bet overbet 13% | – | -0.08 ± 0.59 (n=206) | – | -0.21 ± 0.75 (n=155) | -0.38 ± 0.50 (n=206) | -0.44 ± 0.39 * (n=206) | -1.00 ± 0.48 * (n=206) | – | – | – | – |
| flop, facing a bet | 85 | fold 56%, call 28%, raise medium 6%, raise large 8%, raise all-in 1% | -3.40 ± 3.90 (n=85) | – | -1.15 ± 1.62 (n=85) | – | – | – | – | – | -3.96 ± 2.51 * (n=85) | -5.91 ± 3.19 * (n=83) | -15.33 ± 11.91 * (n=6) |
| turn, checked to | 118 | check 20%, bet small 38%, bet medium 14%, bet large 5%, bet overbet 22% | – | -1.11 ± 0.87 * (n=118) | – | -1.11 ± 1.42 (n=103) | -1.53 ± 1.21 * (n=118) | -1.86 ± 1.28 * (n=118) | -1.64 ± 0.88 * (n=117) | 2.36 (n=1) | – | – | – |
| turn, facing a bet | 43 | fold 63%, call 14%, raise medium 2%, raise large 5%, raise all-in 16% | -0.00 ± 9.42 (n=43) | – | -1.11 ± 2.92 (n=43) | – | – | – | – | – | -7.94 ± 4.54 * (n=38) | -13.92 ± 6.64 * (n=34) | -13.65 ± 13.20 * (n=15) |
| river, checked to | 64 | check 17%, bet small 31%, bet medium 14%, bet large 5%, bet overbet 28%, bet all-in 5% | – | -4.62 ± 3.72 * (n=64) | – | -3.72 ± 2.94 * (n=55) | -3.02 ± 2.01 * (n=62) | -2.97 ± 2.02 * (n=59) | -2.67 ± 2.79 (n=58) | -11.45 ± 22.44 (n=7) | – | – | – |
| river, facing a bet | 23 | fold 57%, call 22%, raise large 9%, raise all-in 13% | -5.91 ± 8.25 (n=23) | – | -6.06 ± 6.04 * (n=23) | – | – | – | – | – | -6.59 ± 8.95 (n=17) | -13.19 ± 12.52 * (n=16) | -35.71 ± 27.59 * (n=12) |

### hu-tag: version 2's own EV estimate minus the reference value (bb; positive = the engine is optimistic)

| Action | All streets | Flop | Turn | River |
|---|---|---|---|---|
| check | -0.97 ± 1.07 (n=388) | -1.05 ± 1.10 (n=206) | -0.36 ± 2.57 (n=118) | -1.87 ± 2.71 (n=64) |
| call | +1.14 ± 3.73 (n=151) | -2.55 ± 3.09 (n=85) | +5.69 ± 10.02 (n=43) | +6.29 ± 10.42 (n=23) |
| bets and raises | -0.87 ± 0.71 * (n=1852) | -0.98 ± 0.70 * (n=998) | +0.64 ± 1.65 (n=559) | -3.32 ± 2.09 * (n=295) |

