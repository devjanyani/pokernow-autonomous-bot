## hu-ra (range-aware): 600 hands, seed 12300, measured seat plays v3; 440 postflop decisions valued in 330 s

Settings: engine 300 samples, continuation version 2 at 150 samples, flop 12 run-outs, turn 22 rivers, 1 repetition(s). Measured seat's result in the session itself: 28.9 bb/100 (one unpaired run; not a benchmark).

### hu-ra: value of version 3's choice minus version 2's choice (bb per decision, same state and cards)

| Decisions | All | Share where the two differ | Only where they differ |
|---|---|---|---|
| all postflop | +0.062 ± 0.551 (n=440) | 46% | +0.135 ± 1.201 (n=202) |
| flop | -0.271 ± 0.495 (n=226) | 48% | -0.568 ± 1.035 (n=108) |
| turn | +0.097 ± 0.677 (n=145) | 43% | +0.224 ± 1.565 (n=63) |
| river | +1.079 ± 2.777 (n=69) | 45% | +2.402 ± 6.205 (n=31) |

### hu-ra: version 3: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 169 | check 50%, bet small 35%, bet medium 7%, bet large 2%, bet overbet 6% | – | +0.13 ± 0.54 (n=169) | – | -0.00 ± 0.65 (n=127) | +0.11 ± 0.64 (n=169) | -0.17 ± 0.58 (n=169) | -0.50 ± 0.71 (n=169) | – | – | – | – |
| flop, facing a bet | 57 | fold 39%, call 21%, raise medium 18%, raise large 23% | -4.11 ± 3.93 * (n=57) | – | -1.68 ± 1.56 * (n=57) | – | – | – | – | – | -2.80 ± 2.92 (n=56) | -4.13 ± 3.08 * (n=55) | -27.04 ± 42.68 (n=4) |
| turn, checked to | 107 | check 46%, bet small 23%, bet medium 12%, bet large 9%, bet overbet 9% | – | -0.43 ± 0.61 (n=107) | – | +0.72 ± 0.96 (n=89) | +0.27 ± 1.05 (n=106) | -0.01 ± 1.02 (n=106) | +0.22 ± 1.29 (n=105) | +3.05 ± 19.26 (n=3) | – | – | – |
| turn, facing a bet | 38 | fold 55%, call 32%, raise medium 8%, raise large 3%, raise all-in 3% | -2.11 ± 8.06 (n=38) | – | -2.38 ± 2.95 (n=38) | – | – | – | – | – | -5.94 ± 7.12 (n=34) | -4.92 ± 6.22 (n=31) | -26.04 ± 37.75 (n=7) |
| river, checked to | 61 | check 30%, bet small 13%, bet medium 15%, bet large 8%, bet overbet 25%, bet all-in 10% | – | -1.08 ± 3.80 (n=61) | – | -1.76 ± 3.96 (n=51) | -0.04 ± 2.43 (n=59) | +0.14 ± 1.34 (n=57) | +1.02 ± 1.68 (n=55) | +6.51 ± 12.76 (n=10) | – | – | – |
| river, facing a bet | 8 | fold 38%, call 38%, raise all-in 25% | +11.18 ± 18.78 (n=8) | – | +6.83 ± 14.18 (n=8) | – | – | – | – | – | +5.71 ± 25.37 (n=6) | -6.88 ± 13.49 (n=3) | -4.72 ± 35.93 (n=6) |

### hu-ra: version 2: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 169 | check 15%, bet small 51%, bet medium 17%, bet large 7%, bet overbet 10% | – | -0.16 ± 0.55 (n=169) | – | -0.38 ± 0.66 (n=127) | -0.18 ± 0.54 (n=169) | -0.46 ± 0.70 (n=169) | -0.79 ± 0.76 * (n=169) | – | – | – | – |
| flop, facing a bet | 57 | fold 54%, call 14%, raise medium 9%, raise large 21%, raise all-in 2% | -4.33 ± 4.04 * (n=57) | – | -1.89 ± 1.57 * (n=57) | – | – | – | – | – | -2.74 ± 3.27 (n=56) | -4.08 ± 3.46 * (n=55) | -33.67 ± 43.09 (n=4) |
| turn, checked to | 107 | check 35%, bet small 35%, bet medium 13%, bet large 7%, bet overbet 10%, bet all-in 1% | – | -0.33 ± 0.77 (n=107) | – | +0.85 ± 0.77 * (n=89) | +0.33 ± 0.90 (n=106) | +0.05 ± 0.87 (n=106) | +0.22 ± 1.15 (n=105) | +0.36 ± 2.90 (n=3) | – | – | – |
| turn, facing a bet | 38 | fold 68%, call 26%, raise all-in 5% | -2.03 ± 8.06 (n=38) | – | -2.30 ± 3.25 (n=38) | – | – | – | – | – | -5.69 ± 8.05 (n=34) | -3.88 ± 6.97 (n=31) | -30.22 ± 39.64 (n=7) |
| river, checked to | 61 | check 48%, bet small 16%, bet medium 13%, bet large 7%, bet overbet 10%, bet all-in 7% | – | +0.26 ± 2.58 (n=61) | – | -0.13 ± 1.36 (n=51) | +1.35 ± 2.60 (n=59) | +1.58 ± 3.00 (n=57) | +1.86 ± 3.08 (n=55) | +17.36 ± 14.23 * (n=10) | – | – | – |
| river, facing a bet | 8 | fold 63%, call 25%, raise all-in 13% | +10.22 ± 15.96 (n=8) | – | +5.88 ± 17.80 (n=8) | – | – | – | – | – | +9.73 ± 25.90 (n=6) | +1.17 ± 25.37 (n=3) | -5.99 ± 43.28 (n=6) |

### hu-ra: version 3's own EV estimate minus the reference value (bb; positive = the engine is optimistic)

| Action | All streets | Flop | Turn | River |
|---|---|---|---|---|
| check | +0.46 ± 1.11 (n=337) | +0.26 ± 0.96 (n=169) | +1.77 ± 2.49 (n=107) | -1.25 ± 3.39 (n=61) |
| call | +3.18 ± 3.89 (n=103) | +0.86 ± 3.24 (n=57) | +4.73 ± 6.72 (n=38) | +12.41 ± 32.13 (n=8) |
| bets and raises | +0.34 ± 0.74 (n=1545) | +0.61 ± 0.79 (n=791) | +0.90 ± 1.46 (n=499) | -1.61 ± 2.43 (n=255) |

