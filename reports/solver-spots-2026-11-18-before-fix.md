## River decisions against the solver, independently specified ranges

Engines at 800 samples, version 3 with its model-uncertainty mixture switched on (its default). Ranges thinned to at most 150 hands per player. 40 Hero hands per spot, spread over Hero's range by made-hand strength. Loss = value of the best action minus value of the adviser's action, both playing on as well as possible against the solution's other player; big blinds per decision.

### oop-first-dry: bet versus check, out of position, first to act

Board Kh 9d 5s 2c 7h; Hero out of position, top 45% preflop range; other player top 30%. Pot 19.5 bb, 90.5 bb behind.
Solver: 200 iterations; a best-responder gains 0.15% of the pot (independent recomputation: 0.15%; largest value difference 5.7e-13 chips). 40 Hero hands.

| | all-in | bet large | bet medium | bet small | check | Loss (bb per decision) | Action in the solution's support |
|---|---|---|---|---|---|---|---|
| Solution (average over the 40 hands) | 0% | 0% | 5% | 42% | 53% | 0 | 100% |
| v1 | 0% | 13% | 0% | 60% | 28% | 0.13 ± 0.07 (n=40) | 80% ± 13 |
| v2 | 0% | 13% | 5% | 45% | 38% | 0.11 ± 0.07 (n=40) | 83% ± 12 |
| v3 | 0% | 10% | 5% | 55% | 30% | 0.11 ± 0.06 (n=40) | 80% ± 13 |
| ml | 0% | 0% | 15% | 0% | 85% | 0.08 ± 0.04 (n=40) | 75% ± 14 |

### ip-checked-to-dry: value betting and size choice in position

Board Kh 9d 5s 2c 7h; Hero in position, top 30% preflop range; other player top 45%. Pot 19.5 bb, 90.5 bb behind.
Solver: 100 iterations; a best-responder gains 0.15% of the pot (independent recomputation: 0.15%; largest value difference 9.1e-13 chips). 40 Hero hands.

| | all-in | bet large | bet medium | bet small | check | Loss (bb per decision) | Action in the solution's support |
|---|---|---|---|---|---|---|---|
| Solution (average over the 40 hands) | 1% | 8% | 19% | 6% | 66% | 0 | 100% |
| v1 | 0% | 20% | 5% | 30% | 45% | 0.23 ± 0.12 (n=40) | 75% ± 14 |
| v2 | 0% | 13% | 13% | 13% | 63% | 0.09 ± 0.06 (n=40) | 90% ± 9 |
| v3 | 0% | 13% | 13% | 13% | 63% | 0.04 ± 0.02 (n=40) | 98% ± 5 |
| ml | 0% | 0% | 70% | 0% | 30% | 0.46 ± 0.22 (n=40) | 60% ± 15 |

### ip-checked-to-wet: value betting and bluffing on a coordinated board

Board Jh Th 6s 9c 2h; Hero in position, top 30% preflop range; other player top 45%. Pot 19.5 bb, 90.5 bb behind.
Solver: 100 iterations; a best-responder gains 0.12% of the pot (independent recomputation: 0.12%; largest value difference 6.8e-13 chips). 40 Hero hands.

| | all-in | bet large | bet medium | bet small | check | Loss (bb per decision) | Action in the solution's support |
|---|---|---|---|---|---|---|---|
| Solution (average over the 40 hands) | 1% | 7% | 10% | 2% | 80% | 0 | 100% |
| v1 | 0% | 13% | 0% | 43% | 45% | 0.68 ± 0.29 (n=40) | 55% ± 16 |
| v2 | 0% | 10% | 8% | 20% | 63% | 0.20 ± 0.13 (n=40) | 78% ± 13 |
| v3 | 0% | 13% | 5% | 18% | 65% | 0.12 ± 0.08 (n=40) | 78% ± 13 |
| ml | 0% | 0% | 43% | 0% | 58% | 0.62 ± 0.36 (n=40) | 63% ± 15 |

### ip-facing-polar-lead: bluff-catching and value raising against a polar bet

Board Qs 8d 4c 3h Ks; Hero in position, top 30% preflop range; other player top 45%, betting range polar. Pot 19.5 bb, 90.5 bb behind.
Solver: 100 iterations; a best-responder gains 0.10% of the pot (independent recomputation: 0.10%; largest value difference 9.1e-13 chips). 40 Hero hands.

| | all-in | call | fold | raise large | Loss (bb per decision) | Action in the solution's support |
|---|---|---|---|---|---|---|
| Solution (average over the 40 hands) | 4% | 91% | 0% | 4% | 0 | 100% |
| v1 | 8% | 90% | 3% | 0% | 0.08 ± 0.11 (n=40) | 95% ± 7 |
| v2 | 8% | 90% | 3% | 0% | 0.08 ± 0.11 (n=40) | 95% ± 7 |
| v3 | 8% | 90% | 3% | 0% | 0.08 ± 0.11 (n=40) | 95% ± 7 |
| ml | 63% | 18% | 20% | 0% | 3.94 ± 1.00 (n=40) | 33% ± 15 |

### ip-facing-condensed-lead: raising for value and bluff-raising against a condensed bet

Board Qs 8d 4c 3h Ks; Hero in position, top 30% preflop range; other player top 45%, betting range condensed. Pot 19.5 bb, 90.5 bb behind.
Solver: 100 iterations; a best-responder gains 0.12% of the pot (independent recomputation: 0.12%; largest value difference 1.4e-12 chips). 40 Hero hands.

| | all-in | call | fold | raise large | Loss (bb per decision) | Action in the solution's support |
|---|---|---|---|---|---|---|
| Solution (average over the 40 hands) | 43% | 22% | 34% | 1% | 0 | 100% |
| v1 | 0% | 15% | 48% | 38% | 1.01 ± 0.42 (n=40) | 65% ± 15 |
| v2 | 0% | 20% | 48% | 33% | 0.80 ± 0.36 (n=40) | 70% ± 14 |
| v3 | 63% | 8% | 0% | 30% | 1.59 ± 0.73 (n=40) | 45% ± 16 |
| ml | 63% | 18% | 20% | 0% | 2.04 ± 0.99 (n=40) | 63% ± 15 |

### oop-check-raise-dry: check-raise, check-call, check-fold after checking first

Board Kh 9d 5s 2c 7h; Hero out of position, top 45% preflop range; other player top 30%. Pot 19.5 bb, 90.5 bb behind. Decision after Hero checks and the other player bets 14.6 bb; ranges at that node from the equilibrium.
Solver: 200 iterations; a best-responder gains 0.13% of the pot (independent recomputation: 0.13%; largest value difference 9.1e-13 chips). 40 Hero hands.

| | all-in | call | fold | raise large | Loss (bb per decision) | Action in the solution's support |
|---|---|---|---|---|---|---|
| Solution (average over the 40 hands) | 10% | 38% | 46% | 6% | 0 | 100% |
| v1 | 13% | 40% | 48% | 0% | 0.18 ± 0.13 (n=40) | 88% ± 10 |
| v2 | 5% | 40% | 48% | 8% | 0.10 ± 0.08 (n=40) | 88% ± 10 |
| v3 | 0% | 40% | 48% | 13% | 0.10 ± 0.08 (n=40) | 88% ± 10 |
| ml | 20% | 33% | 48% | 0% | 0.38 ± 0.27 (n=40) | 85% ± 11 |

### oop-check-raise-wet: check-raise on a coordinated board

Board Jh Th 6s 9c 2h; Hero out of position, top 45% preflop range; other player top 30%. Pot 19.5 bb, 90.5 bb behind. Decision after Hero checks and the other player bets 14.6 bb; ranges at that node from the equilibrium.
Solver: 200 iterations; a best-responder gains 0.13% of the pot (independent recomputation: 0.13%; largest value difference 6.8e-13 chips). 40 Hero hands.

| | all-in | call | fold | raise large | Loss (bb per decision) | Action in the solution's support |
|---|---|---|---|---|---|---|
| Solution (average over the 40 hands) | 11% | 41% | 44% | 3% | 0 | 100% |
| v1 | 15% | 38% | 48% | 0% | 0.27 ± 0.23 (n=40) | 85% ± 11 |
| v2 | 5% | 38% | 48% | 10% | 0.17 ± 0.14 (n=40) | 88% ± 10 |
| v3 | 5% | 38% | 48% | 10% | 0.17 ± 0.14 (n=40) | 88% ± 10 |
| ml | 50% | 28% | 23% | 0% | 1.65 ± 0.80 (n=40) | 57% ± 16 |

### All spots together

| Adviser | Loss (bb per decision) | Action in the solution's support |
|---|---|---|
| v1 | 0.37 ± 0.09 (n=280) | 78% ± 5 |
| v2 | 0.22 ± 0.07 (n=280) | 84% ± 4 |
| v3 | 0.31 ± 0.12 (n=280) | 81% ± 5 |
| ml | 1.31 ± 0.28 (n=280) | 62% ± 6 |

