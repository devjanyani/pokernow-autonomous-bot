## hu-tag (tight-aggressive): 600 hands, seed 12750, measured seat plays v3; 445 postflop decisions valued in 599 s

Settings: engine 300 samples, continuation version 2 at 150 samples, flop 12 run-outs, turn 22 rivers, 1 repetition(s). Measured seat's result in the session itself: 140.5 bb/100 (one unpaired run; not a benchmark).

### hu-tag: value of version 3's choice minus version 2's choice (bb per decision, same state and cards)

| Decisions | All | Share where the two differ | Only where they differ |
|---|---|---|---|
| all postflop | -0.048 ± 0.710 (n=445) | 34% | -0.141 ± 2.085 (n=152) |
| flop | -0.474 ± 0.741 (n=240) | 39% | -1.224 ± 1.909 (n=93) |
| turn | -0.137 ± 0.528 (n=127) | 35% | -0.395 ± 1.532 (n=44) |
| river | +1.406 ± 3.238 (n=78) | 19% | +7.313 ± 16.971 (n=15) |

### hu-tag: version 3: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 151 | check 47%, bet small 38%, bet medium 8%, bet large 3%, bet overbet 5% | – | -0.09 ± 0.48 (n=151) | – | -0.66 ± 1.27 (n=114) | -0.59 ± 0.92 (n=151) | -0.49 ± 0.92 (n=151) | -0.17 ± 0.94 (n=151) | – | – | – | – |
| flop, facing a bet | 89 | fold 40%, call 16%, raise medium 10%, raise large 33%, raise all-in 1% | -6.54 ± 5.22 * (n=89) | – | -0.81 ± 2.41 (n=89) | – | – | – | – | – | -4.06 ± 2.37 * (n=87) | -5.98 ± 3.49 * (n=86) | -27.95 ± 28.13 (n=6) |
| turn, checked to | 87 | check 53%, bet small 16%, bet medium 7%, bet large 13%, bet overbet 11% | – | -0.83 ± 1.28 (n=87) | – | -1.42 ± 1.99 (n=78) | -0.85 ± 1.53 (n=86) | -1.05 ± 1.42 (n=86) | -2.16 ± 1.58 * (n=82) | -3.04 ± 11.87 (n=11) | – | – | – |
| turn, facing a bet | 40 | fold 55%, call 38%, raise medium 5%, raise large 3% | -3.98 ± 8.50 (n=40) | – | +0.14 ± 6.95 (n=40) | – | – | – | – | – | -8.74 ± 5.04 * (n=32) | -11.01 ± 6.75 * (n=31) | -12.94 ± 17.48 (n=11) |
| river, checked to | 61 | check 38%, bet small 21%, bet medium 11%, bet large 7%, bet overbet 5%, bet all-in 18% | – | -7.45 ± 6.06 * (n=61) | – | -5.40 ± 4.37 * (n=51) | -2.17 ± 2.88 (n=50) | +0.10 ± 3.51 (n=46) | -2.02 ± 4.50 (n=45) | -1.26 ± 14.22 (n=19) | – | – | – |
| river, facing a bet | 17 | fold 65%, call 29%, raise all-in 6% | -3.76 ± 18.64 (n=17) | – | +5.46 ± 28.50 (n=17) | – | – | – | – | – | -22.73 ± 16.53 * (n=9) | -9.22 ± 19.17 (n=6) | -29.43 ± 32.12 (n=11) |

### hu-tag: version 2: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 151 | check 33%, bet small 40%, bet medium 9%, bet large 3%, bet overbet 15% | – | -0.59 ± 0.89 (n=151) | – | -1.37 ± 1.05 * (n=114) | -1.08 ± 0.77 * (n=151) | -0.99 ± 0.90 * (n=151) | -0.67 ± 0.95 (n=151) | – | – | – | – |
| flop, facing a bet | 89 | fold 53%, call 16%, raise medium 8%, raise large 22%, raise all-in 1% | -6.98 ± 4.75 * (n=89) | – | -1.25 ± 2.21 (n=89) | – | – | – | – | – | -4.51 ± 2.81 * (n=87) | -6.31 ± 3.80 * (n=86) | -29.70 ± 28.82 * (n=6) |
| turn, checked to | 87 | check 51%, bet small 22%, bet medium 8%, bet large 8%, bet overbet 9%, bet all-in 2% | – | -0.76 ± 1.32 (n=87) | – | -1.35 ± 1.90 (n=78) | -0.78 ± 1.51 (n=86) | -0.98 ± 1.46 (n=86) | -1.97 ± 1.53 * (n=82) | -4.53 ± 12.71 (n=11) | – | – | – |
| turn, facing a bet | 40 | fold 60%, call 30%, raise medium 3%, raise large 5%, raise all-in 3% | -4.56 ± 8.56 (n=40) | – | -0.44 ± 6.97 (n=40) | – | – | – | – | – | -9.51 ± 5.01 * (n=32) | -11.81 ± 6.79 * (n=31) | -13.72 ± 17.57 (n=11) |
| river, checked to | 61 | check 49%, bet small 18%, bet medium 5%, bet large 7%, bet overbet 5%, bet all-in 16% | – | -5.65 ± 4.57 * (n=61) | – | -5.79 ± 4.35 * (n=51) | -2.53 ± 2.93 (n=50) | -0.30 ± 3.61 (n=46) | -2.43 ± 4.62 (n=45) | +5.47 ± 19.48 (n=19) | – | – | – |
| river, facing a bet | 17 | fold 65%, call 24%, raise medium 6%, raise all-in 6% | -3.76 ± 18.64 (n=17) | – | +5.46 ± 28.50 (n=17) | – | – | – | – | – | -22.73 ± 16.53 * (n=9) | -9.22 ± 19.17 (n=6) | -29.43 ± 32.12 (n=11) |

### hu-tag: version 3's own EV estimate minus the reference value (bb; positive = the engine is optimistic)

| Action | All streets | Flop | Turn | River |
|---|---|---|---|---|
| check | -2.46 ± 1.78 * (n=299) | +0.19 ± 1.53 (n=151) | -4.64 ± 3.44 * (n=87) | -5.88 ± 6.04 (n=61) |
| call | -3.02 ± 5.31 (n=146) | -2.79 ± 3.54 (n=89) | +0.47 ± 10.58 (n=40) | -12.46 ± 34.06 (n=17) |
| bets and raises | -1.32 ± 0.96 * (n=1452) | +0.33 ± 1.04 (n=783) | -2.43 ± 1.89 * (n=426) | -4.70 ± 3.22 * (n=243) |

