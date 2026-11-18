## hu-tag (tight-aggressive): 600 hands, seed 12500, measured seat plays v3; 422 postflop decisions valued in 644 s

Settings: engine 300 samples, continuation version 2 at 150 samples, flop 12 run-outs, turn 22 rivers, 1 repetition(s). Measured seat's result in the session itself: 52.2 bb/100 (one unpaired run; not a benchmark).

### hu-tag: value of version 3's choice minus version 2's choice (bb per decision, same state and cards)

| Decisions | All | Share where the two differ | Only where they differ |
|---|---|---|---|
| all postflop | -0.417 ± 0.811 (n=422) | 34% | -1.229 ± 2.392 (n=143) |
| flop | -0.748 ± 0.964 (n=222) | 36% | -2.101 ± 2.694 (n=79) |
| turn | +0.901 ± 1.119 (n=129) | 38% | +2.373 ± 2.918 (n=49) |
| river | -1.775 ± 3.140 (n=71) | 21% | -8.403 ± 14.766 (n=15) |

### hu-tag: version 3: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 142 | check 44%, bet small 42%, bet medium 8%, bet large 1%, bet overbet 5% | – | -0.28 ± 0.44 (n=142) | – | -0.19 ± 0.72 (n=108) | -0.30 ± 0.56 (n=142) | -0.08 ± 0.65 (n=142) | -0.78 ± 0.66 * (n=142) | – | – | – | – |
| flop, facing a bet | 80 | fold 38%, call 21%, raise medium 11%, raise large 26%, raise all-in 4% | -2.43 ± 4.34 (n=80) | – | +1.44 ± 2.51 (n=80) | – | – | – | – | – | -3.48 ± 2.33 * (n=75) | -7.30 ± 3.35 * (n=75) | +13.60 ± 23.61 (n=7) |
| turn, checked to | 84 | check 54%, bet small 24%, bet medium 6%, bet large 8%, bet overbet 8% | – | -0.05 ± 0.72 (n=84) | – | -2.71 ± 1.95 * (n=76) | -3.02 ± 1.97 * (n=84) | -2.89 ± 2.05 * (n=84) | -3.08 ± 2.30 * (n=83) | -21.86 ± 21.55 * (n=4) | – | – | – |
| turn, facing a bet | 45 | fold 51%, call 38%, raise medium 4%, raise large 7% | -7.05 ± 8.00 (n=45) | – | -3.58 ± 2.70 * (n=45) | – | – | – | – | – | -12.89 ± 4.96 * (n=41) | -12.91 ± 6.57 * (n=36) | -33.67 ± 14.13 * (n=12) |
| river, checked to | 55 | check 44%, bet small 24%, bet medium 2%, bet large 5%, bet overbet 9%, bet all-in 16% | – | -4.62 ± 6.65 (n=55) | – | -4.23 ± 5.25 (n=53) | -5.16 ± 4.59 * (n=47) | -6.55 ± 4.88 * (n=45) | -5.83 ± 6.11 (n=43) | -0.57 ± 12.92 (n=16) | – | – | – |
| river, facing a bet | 16 | fold 69%, call 13%, raise all-in 19% | +15.29 ± 15.12 * (n=16) | – | -3.07 ± 16.81 (n=16) | – | – | – | – | – | -22.37 ± 15.98 * (n=9) | -11.37 ± 24.34 (n=8) | -30.50 ± 25.96 * (n=14) |

### hu-tag: version 2: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 142 | check 23%, bet small 54%, bet medium 8%, bet large 3%, bet overbet 12% | – | -0.25 ± 0.67 (n=142) | – | -0.18 ± 0.74 (n=108) | -0.27 ± 0.52 (n=142) | -0.05 ± 0.64 (n=142) | -0.75 ± 0.67 * (n=142) | – | – | – | – |
| flop, facing a bet | 80 | fold 41%, call 24%, raise medium 16%, raise large 15%, raise all-in 4% | -4.56 ± 4.22 * (n=80) | – | -0.69 ± 3.13 (n=80) | – | – | – | – | – | -4.24 ± 2.13 * (n=75) | -8.06 ± 3.37 * (n=75) | -0.21 ± 11.83 (n=7) |
| turn, checked to | 84 | check 44%, bet small 32%, bet medium 10%, bet large 5%, bet overbet 8%, bet all-in 1% | – | +0.41 ± 0.95 (n=84) | – | -2.22 ± 1.69 * (n=76) | -2.57 ± 1.92 * (n=84) | -2.44 ± 2.03 * (n=84) | -2.92 ± 2.21 * (n=83) | -19.23 ± 21.36 (n=4) | – | – | – |
| turn, facing a bet | 45 | fold 60%, call 29%, raise medium 2%, raise large 4%, raise all-in 4% | -5.31 ± 8.54 (n=45) | – | -1.84 ± 3.84 (n=45) | – | – | – | – | – | -11.05 ± 5.46 * (n=41) | -10.92 ± 6.93 * (n=36) | -28.83 ± 16.73 * (n=12) |
| river, checked to | 55 | check 53%, bet small 11%, bet medium 4%, bet large 7%, bet overbet 11%, bet all-in 15% | – | -4.49 ± 6.44 (n=55) | – | -4.09 ± 5.13 (n=53) | -4.38 ± 4.91 (n=47) | -5.74 ± 5.20 * (n=45) | -4.98 ± 6.39 (n=43) | -0.23 ± 14.99 (n=16) | – | – | – |
| river, facing a bet | 16 | fold 75%, call 19%, raise all-in 6% | +6.96 ± 10.37 (n=16) | – | -11.40 ± 13.71 (n=16) | – | – | – | – | – | -21.00 ± 15.77 * (n=9) | -9.82 ± 25.76 (n=8) | -40.02 ± 26.78 * (n=14) |

### hu-tag: version 3's own EV estimate minus the reference value (bb; positive = the engine is optimistic)

| Action | All streets | Flop | Turn | River |
|---|---|---|---|---|
| check | -0.50 ± 1.72 (n=281) | -0.56 ± 1.13 (n=142) | -1.57 ± 2.39 (n=84) | +1.31 ± 7.48 (n=55) |
| call | +0.66 ± 3.40 (n=141) | -0.70 ± 3.89 (n=80) | -1.33 ± 6.74 (n=45) | +13.10 ± 11.56 * (n=16) |
| bets and raises | +1.60 ± 0.97 * (n=1389) | +0.03 ± 0.87 (n=725) | +2.64 ± 1.59 * (n=428) | +4.50 ± 4.09 * (n=236) |

