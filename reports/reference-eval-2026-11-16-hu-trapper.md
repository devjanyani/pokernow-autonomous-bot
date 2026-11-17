## hu-trapper (trapper): 800 hands, seed 7100, measured seat plays v2; 699 postflop decisions valued in 398 s

Settings: engine 300 samples, continuation version 2 at 150 samples, flop 12 run-outs, turn 22 rivers, 1 repetition(s). Measured seat's result in the session itself: 62.6 bb/100 (one unpaired run; not a benchmark).

### hu-trapper: value of version 2's choice minus version 1's choice (bb per decision, same state and cards)

| Decisions | All | Share where the two differ | Only where they differ |
|---|---|---|---|
| all postflop | +0.814 ± 0.700 * (n=699) | 63% | +1.284 ± 1.103 * (n=443) |
| flop | +0.238 ± 0.702 (n=300) | 55% | +0.430 ± 1.269 (n=166) |
| turn | +1.642 ± 1.175 * (n=217) | 73% | +2.241 ± 1.595 * (n=159) |
| river | +0.774 ± 1.983 (n=182) | 65% | +1.194 ± 3.060 (n=118) |

### hu-trapper: version 2: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 276 | check 41%, bet small 24%, bet medium 11%, bet large 8%, bet overbet 17% | – | -0.76 ± 0.74 * (n=276) | – | +1.00 ± 1.10 (n=210) | +0.63 ± 0.52 * (n=276) | +0.24 ± 0.48 (n=276) | -0.32 ± 0.52 (n=276) | – | – | – | – |
| flop, facing a bet | 24 | fold 63%, call 21%, raise medium 8%, raise large 4%, raise all-in 4% | -1.80 ± 10.86 (n=24) | – | -3.38 ± 5.48 (n=24) | – | – | – | – | – | -8.65 ± 8.77 (n=24) | -13.63 ± 9.87 * (n=23) | -44.86 ± 46.19 (n=4) |
| turn, checked to | 195 | check 51%, bet small 21%, bet medium 8%, bet large 6%, bet overbet 15% | – | -0.29 ± 1.31 (n=195) | – | -1.14 ± 1.19 (n=149) | -0.97 ± 0.88 * (n=195) | -1.16 ± 0.81 * (n=195) | -2.02 ± 0.87 * (n=194) | 0.00 (n=1) | – | – | – |
| turn, facing a bet | 22 | fold 55%, call 27%, raise medium 14%, raise large 5% | +3.85 ± 11.10 (n=22) | – | -4.33 ± 7.03 (n=22) | – | – | – | – | – | -6.85 ± 5.37 * (n=16) | -9.31 ± 8.71 * (n=16) | -23.44 ± 30.21 (n=8) |
| river, checked to | 137 | check 64%, bet small 12%, bet medium 9%, bet large 4%, bet overbet 7%, bet all-in 4% | – | -2.10 ± 1.76 * (n=137) | – | -1.27 ± 1.74 (n=100) | -0.96 ± 1.29 (n=131) | -1.67 ± 1.78 (n=128) | -2.83 ± 2.00 * (n=122) | +7.98 ± 18.20 (n=18) | – | – | – |
| river, facing a bet | 45 | fold 78%, call 20%, raise all-in 2% | -6.97 ± 10.17 (n=45) | – | -7.01 ± 2.95 * (n=45) | – | – | – | – | – | -22.16 ± 7.43 * (n=36) | -27.79 ± 7.57 * (n=34) | -51.39 ± 27.47 * (n=15) |

### hu-trapper: version 1: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 276 | check 17%, bet small 17%, bet medium 17%, bet large 13%, bet overbet 35% | – | -0.89 ± 0.78 * (n=276) | – | +0.84 ± 1.07 (n=210) | +0.50 ± 0.48 * (n=276) | +0.11 ± 0.43 (n=276) | -0.45 ± 0.49 (n=276) | – | – | – | – |
| flop, facing a bet | 24 | fold 46%, call 29%, raise medium 17%, raise large 8% | +2.69 ± 13.28 (n=24) | – | +1.11 ± 6.35 (n=24) | – | – | – | – | – | -4.16 ± 6.00 (n=24) | -8.95 ± 6.90 * (n=23) | -22.38 ± 35.22 (n=4) |
| turn, checked to | 195 | check 9%, bet small 11%, bet medium 18%, bet large 15%, bet overbet 47% | – | +0.87 ± 1.45 (n=195) | – | +0.43 ± 1.32 (n=149) | +0.19 ± 0.88 (n=195) | +0.00 ± 0.60 (n=195) | -0.84 ± 0.54 * (n=194) | 0.00 (n=1) | – | – | – |
| turn, facing a bet | 22 | fold 27%, call 18%, raise medium 14%, raise large 27%, raise all-in 14% | +9.72 ± 13.64 (n=22) | – | +1.53 ± 7.07 (n=22) | – | – | – | – | – | -3.32 ± 5.99 (n=16) | -5.77 ± 5.55 * (n=16) | -5.16 ± 19.41 (n=8) |
| river, checked to | 137 | check 12%, bet small 18%, bet medium 18%, bet large 9%, bet overbet 35%, bet all-in 8% | – | -2.70 ± 2.51 * (n=137) | – | -2.12 ± 2.47 (n=100) | -1.84 ± 1.40 * (n=131) | -1.98 ± 1.47 * (n=128) | -2.90 ± 1.58 * (n=122) | +1.25 ± 14.74 (n=18) | – | – | – |
| river, facing a bet | 45 | fold 64%, call 16%, raise medium 7%, raise large 7%, raise all-in 7% | -2.02 ± 10.17 (n=45) | – | -2.06 ± 7.20 (n=45) | – | – | – | – | – | -17.46 ± 6.89 * (n=36) | -22.81 ± 7.18 * (n=34) | -38.58 ± 35.25 * (n=15) |

### hu-trapper: version 2's own EV estimate minus the reference value (bb; positive = the engine is optimistic)

| Action | All streets | Flop | Turn | River |
|---|---|---|---|---|
| check | +0.44 ± 0.85 (n=608) | +0.07 ± 1.20 (n=276) | +0.56 ± 1.72 (n=195) | +1.05 ± 1.59 (n=137) |
| call | +5.98 ± 7.14 (n=91) | +2.12 ± 10.32 (n=24) | +16.19 ± 17.83 (n=22) | +3.04 ± 10.05 (n=45) |
| bets and raises | +0.52 ± 0.70 (n=2596) | -0.67 ± 0.76 (n=1155) | +1.59 ± 1.37 * (n=820) | +1.33 ± 1.83 (n=621) |

