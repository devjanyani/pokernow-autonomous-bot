## six-independent (pot-odds-caller, mdf-defender, trapper, maniac, nit): 900 hands, seed 7200, measured seat plays v2; 313 postflop decisions valued in 330 s

Settings: engine 300 samples, continuation version 2 at 150 samples, flop 12 run-outs, turn 22 rivers, 1 repetition(s). Measured seat's result in the session itself: 171.9 bb/100 (one unpaired run; not a benchmark).

### six-independent: value of version 2's choice minus version 1's choice (bb per decision, same state and cards)

| Decisions | All | Share where the two differ | Only where they differ |
|---|---|---|---|
| all postflop | -1.056 ± 1.796 (n=313) | 40% | -2.644 ± 4.493 (n=125) |
| flop | -1.083 ± 1.806 (n=203) | 37% | -2.931 ± 4.881 (n=75) |
| turn | -0.051 ± 3.419 (n=74) | 45% | -0.115 ± 7.732 (n=33) |
| river | -2.968 ± 9.644 (n=36) | 47% | -6.285 ± 20.636 (n=17) |

### six-independent: version 2: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 113 | check 56%, bet small 15%, bet medium 5%, bet large 7%, bet overbet 17% | – | -1.02 ± 1.87 (n=113) | – | -0.90 ± 1.67 (n=113) | -0.75 ± 1.63 (n=113) | -2.46 ± 1.74 * (n=113) | -4.08 ± 2.21 * (n=113) | – | – | – | – |
| flop, facing a bet | 90 | fold 78%, call 12%, raise medium 3%, raise large 3%, raise all-in 3% | -11.70 ± 7.32 * (n=90) | – | -1.60 ± 4.41 (n=90) | – | – | – | – | – | -10.14 ± 6.28 * (n=79) | -15.46 ± 7.44 * (n=76) | -21.64 ± 18.28 * (n=33) |
| turn, checked to | 49 | check 41%, bet small 22%, bet medium 12%, bet large 6%, bet overbet 8%, bet all-in 10% | – | -1.58 ± 2.96 (n=49) | – | -1.77 ± 2.08 (n=49) | -2.18 ± 3.19 (n=48) | -3.46 ± 3.30 * (n=44) | -7.47 ± 3.92 * (n=40) | +3.56 ± 16.48 (n=10) | – | – | – |
| turn, facing a bet | 25 | fold 52%, call 40%, raise all-in 8% | -33.05 ± 21.81 * (n=25) | – | -1.20 ± 5.44 (n=25) | – | – | – | – | – | -7.39 ± 10.58 (n=12) | -12.64 ± 14.05 (n=12) | +1.82 ± 34.40 (n=12) |
| river, checked to | 27 | check 59%, bet small 7%, bet medium 15%, bet large 4%, bet overbet 4%, bet all-in 11% | – | -4.14 ± 4.52 (n=27) | – | -3.75 ± 4.27 (n=25) | -4.50 ± 4.46 * (n=23) | -4.31 ± 4.83 (n=22) | -3.55 ± 4.87 (n=20) | -29.64 ± 28.40 * (n=7) | – | – | – |
| river, facing a bet | 9 | fold 78%, call 11%, raise all-in 11% | -35.43 ± 46.70 (n=9) | – | -11.14 ± 45.59 (n=9) | – | – | – | – | – | -30.20 (n=1) | -45.80 (n=1) | -11.85 ± 105.09 (n=5) |

### six-independent: version 1: value of each alternative minus value of the action chosen (bb per decision)

Positive and marked * : that alternative would have earned more than what the engine chose, on average over these spots.

| Spot | n | Chose (share) | fold | check | call | bet small | bet medium | bet large | bet overbet | bet all-in | raise medium | raise large | raise all-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| flop, checked to | 113 | check 40%, bet small 24%, bet medium 4%, bet large 5%, bet overbet 27% | – | -2.19 ± 1.89 * (n=113) | – | -2.08 ± 2.08 (n=113) | -1.92 ± 1.80 * (n=113) | -3.63 ± 1.89 * (n=113) | -5.25 ± 1.97 * (n=113) | – | – | – | – |
| flop, facing a bet | 90 | fold 63%, call 18%, raise medium 3%, raise large 8%, raise all-in 8% | -12.67 ± 8.11 * (n=90) | – | -2.57 ± 4.53 (n=90) | – | – | – | – | – | -12.11 ± 4.67 * (n=79) | -17.81 ± 5.62 * (n=76) | -23.05 ± 14.83 * (n=33) |
| turn, checked to | 49 | check 20%, bet small 20%, bet medium 14%, bet large 18%, bet overbet 12%, bet all-in 14% | – | -0.42 ± 4.23 (n=49) | – | -0.61 ± 2.76 (n=49) | -0.99 ± 1.66 (n=48) | -2.56 ± 2.20 * (n=44) | -5.02 ± 3.82 * (n=40) | +2.55 ± 4.02 (n=10) | – | – | – |
| turn, facing a bet | 25 | fold 56%, call 24%, raise all-in 20% | -35.48 ± 22.78 * (n=25) | – | -3.64 ± 8.81 (n=25) | – | – | – | – | – | -5.90 ± 10.68 (n=12) | -11.14 ± 14.10 (n=12) | -3.68 ± 31.82 (n=12) |
| river, checked to | 27 | check 26%, bet small 33%, bet medium 7%, bet large 15%, bet overbet 7%, bet all-in 11% | – | -3.66 ± 4.92 (n=27) | – | -3.23 ± 4.03 (n=25) | -3.93 ± 3.24 * (n=23) | -4.60 ± 4.55 * (n=22) | -3.88 ± 4.31 (n=20) | -26.84 ± 26.15 * (n=7) | – | – | – |
| river, facing a bet | 9 | fold 56%, call 33%, raise all-in 11% | -48.74 ± 57.04 (n=9) | – | -24.46 ± 15.48 * (n=9) | – | – | – | – | – | -30.20 (n=1) | -45.80 (n=1) | -35.82 ± 45.72 (n=5) |

### six-independent: version 2's own EV estimate minus the reference value (bb; positive = the engine is optimistic)

| Action | All streets | Flop | Turn | River |
|---|---|---|---|---|
| check | -6.78 ± 3.01 * (n=189) | -7.01 ± 4.25 * (n=113) | -9.01 ± 5.68 * (n=49) | -1.79 ± 4.54 (n=27) |
| call | -11.50 ± 5.85 * (n=124) | -9.29 ± 5.66 * (n=90) | -16.47 ± 13.20 * (n=25) | -19.86 ± 46.28 (n=9) |
| bets and raises | -7.21 ± 1.82 * (n=971) | -7.55 ± 2.26 * (n=640) | -7.91 ± 3.53 * (n=227) | -3.54 ± 5.88 (n=104) |

