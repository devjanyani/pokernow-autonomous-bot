## hu-mdf (mdf-defender): 800 hands, seed 7100, measured seat plays v2; 487 postflop decisions valued in 260 s

Settings: engine 300 samples, continuation version 2 at 150 samples, flop 12 run-outs, turn 22 rivers, 1 repetition(s). Measured seat's result in the session itself: 51.5 bb/100 (one unpaired run; not a benchmark).

### hu-mdf: value of version 2's choice minus version 1's choice (bb per decision, same state and cards)

| Decisions | All | Share where the two differ | Only where they differ |
|---|---|---|---|
| all postflop | +0.073 ± 0.653 (n=487) | 65% | +0.112 ± 1.001 (n=318) |
| flop | +0.170 ± 0.531 (n=205) | 58% | +0.295 ± 0.923 (n=118) |
| turn | +0.221 ± 1.149 (n=157) | 71% | +0.310 ± 1.612 (n=112) |
| river | -0.271 ± 1.913 (n=125) | 70% | -0.385 ± 2.722 (n=88) |

### hu-mdf: version 2: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 180 | check 32%, bet small 31%, bet medium 10%, bet large 7%, bet overbet 20% | – | -1.69 ± 0.80 * (n=180) | – | -0.52 ± 0.70 (n=164) | -0.27 ± 0.77 (n=180) | -0.14 ± 0.72 (n=180) | -0.96 ± 0.92 * (n=180) | – | – | – | – |
| flop, facing a bet | 25 | fold 60%, call 12%, raise medium 12%, raise large 16% | +5.58 ± 11.47 (n=25) | – | -1.59 ± 4.59 (n=25) | – | – | – | – | – | -15.41 ± 10.69 * (n=24) | -22.29 ± 10.89 * (n=24) | 0.00 (n=1) |
| turn, checked to | 140 | check 56%, bet small 18%, bet medium 9%, bet large 5%, bet overbet 11%, bet all-in 1% | – | -1.58 ± 1.14 * (n=140) | – | -1.34 ± 1.14 * (n=130) | -1.45 ± 1.23 * (n=139) | -1.07 ± 1.27 (n=138) | -1.60 ± 1.40 * (n=138) | -23.94 ± 20.90 * (n=4) | – | – | – |
| turn, facing a bet | 17 | fold 59%, call 18%, raise medium 6%, raise large 6%, raise all-in 12% | -13.29 ± 12.82 * (n=17) | – | -2.68 ± 3.17 (n=17) | – | – | – | – | – | -18.48 ± 13.01 * (n=15) | -22.62 ± 14.85 * (n=13) | -21.03 ± 31.15 (n=7) |
| river, checked to | 114 | check 64%, bet small 13%, bet medium 7%, bet large 4%, bet overbet 11%, bet all-in 1% | – | -2.27 ± 1.59 * (n=114) | – | -1.95 ± 1.55 * (n=107) | -2.13 ± 1.74 * (n=112) | -1.48 ± 1.66 (n=107) | -1.38 ± 2.37 (n=106) | +7.85 ± 31.61 (n=10) | – | – | – |
| river, facing a bet | 11 | fold 91%, call 9% | -2.75 ± 5.39 (n=11) | – | -8.47 ± 4.49 * (n=11) | – | – | – | – | – | -24.96 ± 15.93 * (n=9) | -26.30 ± 7.50 * (n=8) | -65.86 ± 43.18 * (n=4) |

### hu-mdf: version 1: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 180 | check 11%, bet small 23%, bet medium 11%, bet large 16%, bet overbet 41% | – | -1.67 ± 0.94 * (n=180) | – | -0.45 ± 0.87 (n=164) | -0.24 ± 0.81 (n=180) | -0.12 ± 0.66 (n=180) | -0.93 ± 0.73 * (n=180) | – | – | – | – |
| flop, facing a bet | 25 | fold 52%, call 20%, raise medium 4%, raise large 20%, raise all-in 4% | +6.80 ± 11.58 (n=25) | – | -0.38 ± 4.58 (n=25) | – | – | – | – | – | -14.14 ± 10.51 * (n=24) | -21.02 ± 10.67 * (n=24) | 0.00 (n=1) |
| turn, checked to | 140 | check 12%, bet small 16%, bet medium 14%, bet large 16%, bet overbet 41%, bet all-in 1% | – | -1.51 ± 1.59 (n=140) | – | -1.26 ± 1.34 (n=130) | -1.38 ± 1.19 * (n=139) | -0.99 ± 1.01 (n=138) | -1.53 ± 1.11 * (n=138) | -21.04 ± 20.92 * (n=4) | – | – | – |
| turn, facing a bet | 17 | fold 35%, call 24%, raise large 12%, raise all-in 29% | -11.84 ± 14.89 (n=17) | – | -1.23 ± 2.07 (n=17) | – | – | – | – | – | -16.84 ± 11.21 * (n=15) | -21.16 ± 12.13 * (n=13) | -19.80 ± 25.05 (n=7) |
| river, checked to | 114 | check 11%, bet small 22%, bet medium 15%, bet large 11%, bet overbet 38%, bet all-in 4% | – | -2.57 ± 2.78 (n=114) | – | -2.24 ± 2.40 (n=107) | -1.69 ± 2.27 (n=112) | -0.83 ± 1.24 (n=107) | -0.73 ± 1.74 (n=106) | -1.33 ± 21.71 (n=10) | – | – | – |
| river, facing a bet | 11 | fold 91%, call 9% | -2.75 ± 5.39 (n=11) | – | -8.47 ± 4.49 * (n=11) | – | – | – | – | – | -24.96 ± 15.93 * (n=9) | -26.30 ± 7.50 * (n=8) | -65.86 ± 43.18 * (n=4) |

### hu-mdf: version 2's own EV estimate minus the reference value (bb; positive = the engine is optimistic)

| Action | All streets | Flop | Turn | River |
|---|---|---|---|---|
| check | +0.49 ± 0.84 (n=434) | +0.28 ± 0.72 (n=180) | +0.96 ± 2.05 (n=140) | +0.26 ± 1.61 (n=114) |
| call | +4.57 ± 6.46 (n=53) | +9.27 ± 11.70 (n=25) | -1.99 ± 9.88 (n=17) | +4.02 ± 3.44 * (n=11) |
| bets and raises | -0.01 ± 0.69 (n=1833) | +0.42 ± 0.92 (n=769) | +0.25 ± 1.21 (n=594) | -1.04 ± 1.62 (n=470) |

