## hu-tag (tight-aggressive): 600 hands, seed 12500, measured seat plays v3; 423 postflop decisions valued in 622 s

Settings: engine 300 samples, continuation version 2 at 150 samples, flop 12 run-outs, turn 22 rivers, 1 repetition(s). Measured seat's result in the session itself: 62.3 bb/100 (one unpaired run; not a benchmark).

### hu-tag: value of version 3's choice minus version 2's choice (bb per decision, same state and cards)

| Decisions | All | Share where the two differ | Only where they differ |
|---|---|---|---|
| all postflop | +0.074 ± 0.620 (n=423) | 31% | +0.235 ± 1.977 (n=133) |
| flop | +0.004 ± 0.502 (n=219) | 33% | +0.012 ± 1.535 (n=72) |
| turn | +0.264 ± 0.769 (n=133) | 35% | +0.748 ± 2.185 (n=47) |
| river | -0.067 ± 3.048 (n=71) | 20% | -0.339 ± 15.925 (n=14) |

### hu-tag: version 3: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 142 | check 42%, bet small 44%, bet medium 8%, bet overbet 5% | – | -0.35 ± 0.42 (n=142) | – | -0.08 ± 1.11 (n=108) | -0.17 ± 0.90 (n=142) | -0.59 ± 0.89 (n=142) | -0.67 ± 0.80 (n=142) | – | – | – | – |
| flop, facing a bet | 77 | fold 40%, call 23%, raise medium 5%, raise large 30%, raise all-in 1% | -3.22 ± 4.16 (n=77) | – | +0.32 ± 2.77 (n=77) | – | – | – | – | – | -5.29 ± 2.89 * (n=73) | -9.52 ± 3.70 * (n=73) | +3.50 ± 27.35 (n=6) |
| turn, checked to | 84 | check 54%, bet small 23%, bet medium 8%, bet large 7%, bet overbet 8% | – | -0.63 ± 1.19 (n=84) | – | -1.43 ± 1.30 * (n=76) | -0.72 ± 1.09 (n=84) | -1.81 ± 1.42 * (n=84) | -2.41 ± 2.29 * (n=83) | -17.06 ± 24.22 (n=5) | – | – | – |
| turn, facing a bet | 49 | fold 53%, call 37%, raise medium 6%, raise large 2%, raise all-in 2% | -5.50 ± 6.73 (n=49) | – | -2.16 ± 2.32 (n=49) | – | – | – | – | – | -9.61 ± 4.96 * (n=43) | -10.82 ± 6.40 * (n=38) | -28.97 ± 16.14 * (n=13) |
| river, checked to | 50 | check 48%, bet small 20%, bet medium 2%, bet large 2%, bet overbet 14%, bet all-in 14% | – | -6.68 ± 6.03 * (n=50) | – | -2.72 ± 6.55 (n=48) | -1.64 ± 5.98 (n=43) | -5.30 ± 5.25 * (n=39) | -1.51 ± 6.06 (n=38) | -3.50 ± 19.99 (n=14) | – | – | – |
| river, facing a bet | 21 | fold 81%, call 10%, raise all-in 10% | +7.58 ± 9.88 (n=21) | – | -10.16 ± 10.99 (n=21) | – | – | – | – | – | -19.05 ± 11.43 * (n=14) | -24.04 ± 18.47 * (n=13) | -34.23 ± 28.69 * (n=13) |

### hu-tag: version 2: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 142 | check 24%, bet small 54%, bet medium 7%, bet large 3%, bet overbet 13% | – | -0.35 ± 0.65 (n=142) | – | -0.11 ± 0.95 (n=108) | -0.18 ± 0.80 (n=142) | -0.59 ± 0.72 (n=142) | -0.68 ± 0.63 * (n=142) | – | – | – | – |
| flop, facing a bet | 77 | fold 42%, call 23%, raise medium 18%, raise large 14%, raise all-in 3% | -3.21 ± 4.11 (n=77) | – | +0.34 ± 2.51 (n=77) | – | – | – | – | – | -5.27 ± 2.73 * (n=73) | -9.50 ± 3.75 * (n=73) | +3.50 ± 27.35 (n=6) |
| turn, checked to | 84 | check 46%, bet small 27%, bet medium 11%, bet large 6%, bet overbet 8%, bet all-in 1% | – | -0.55 ± 0.95 (n=84) | – | -1.35 ± 1.46 (n=76) | -0.63 ± 1.44 (n=84) | -1.73 ± 1.65 * (n=84) | -2.61 ± 2.31 * (n=83) | -8.74 ± 28.27 (n=5) | – | – | – |
| turn, facing a bet | 49 | fold 65%, call 29%, raise medium 2%, raise all-in 4% | -4.93 ± 6.70 (n=49) | – | -1.58 ± 2.31 (n=49) | – | – | – | – | – | -9.40 ± 5.09 * (n=43) | -10.60 ± 6.52 * (n=38) | -27.45 ± 16.67 * (n=13) |
| river, checked to | 50 | check 54%, bet small 8%, bet medium 8%, bet large 6%, bet overbet 12%, bet all-in 12% | – | -6.96 ± 5.97 * (n=50) | – | -3.00 ± 5.76 (n=48) | -1.28 ± 5.53 (n=43) | -4.91 ± 4.89 * (n=39) | -1.11 ± 6.02 (n=38) | -3.11 ± 21.82 (n=14) | – | – | – |
| river, facing a bet | 21 | fold 71%, call 24%, raise all-in 5% | +8.00 ± 9.44 (n=21) | – | -9.73 ± 9.00 * (n=21) | – | – | – | – | – | -17.86 ± 11.29 * (n=14) | -22.77 ± 19.38 * (n=13) | -33.87 ± 29.15 * (n=13) |

### hu-tag: version 3's own EV estimate minus the reference value (bb; positive = the engine is optimistic)

| Action | All streets | Flop | Turn | River |
|---|---|---|---|---|
| check | +0.54 ± 1.69 (n=276) | +0.41 ± 1.19 (n=142) | -0.58 ± 2.25 (n=84) | +2.77 ± 7.84 (n=50) |
| call | +1.39 ± 3.06 (n=147) | +0.06 ± 3.19 (n=77) | -1.36 ± 6.50 (n=49) | +12.66 ± 8.48 * (n=21) |
| bets and raises | +1.08 ± 0.94 * (n=1377) | +1.21 ± 0.88 * (n=720) | +0.93 ± 1.59 (n=434) | +0.94 ± 4.01 (n=223) |

