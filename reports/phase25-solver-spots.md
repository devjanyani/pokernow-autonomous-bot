## River decisions against the solver, independently specified ranges

Engines at 800 samples, version 3 with its model-uncertainty mixture switched on (its default). Ranges thinned to at most 150 hands per player. 40 Hero hands per spot, spread over Hero's range by made-hand strength. Loss = value of the best action minus value of the adviser's action, both playing on as well as possible against the solution's other player; big blinds per decision.

### oop-first-dry: bet versus check, out of position, first to act

Board Kh 9d 5s 2c 7h; Hero out of position, top 45% preflop range; other player top 30%. Pot 19.5 bb, 90.5 bb behind.
Solver: 200 iterations; a best-responder gains 0.15% of the pot (independent recomputation: 0.15%; largest value difference 5.7e-13 chips). 40 Hero hands.

| | all-in | bet large | bet medium | bet small | check | Loss (bb per decision) | Action in the solution's support |
|---|---|---|---|---|---|---|---|
| Solution (average over the 40 hands) | 0% | 0% | 5% | 42% | 53% | 0 | 100% |
| v2 | 0% | 13% | 5% | 45% | 38% | 0.11 ± 0.07 (n=40) | 83% ± 12 |
| v3 | 0% | 0% | 0% | 55% | 45% | 0.08 ± 0.05 (n=40) | 88% ± 10 |
| v3p | 0% | 0% | 13% | 40% | 48% | 0.04 ± 0.02 (n=40) | 90% ± 9 |

### ip-checked-to-dry: value betting and size choice in position

Board Kh 9d 5s 2c 7h; Hero in position, top 30% preflop range; other player top 45%. Pot 19.5 bb, 90.5 bb behind.
Solver: 100 iterations; a best-responder gains 0.15% of the pot (independent recomputation: 0.15%; largest value difference 9.1e-13 chips). 40 Hero hands.

| | all-in | bet large | bet medium | bet small | check | Loss (bb per decision) | Action in the solution's support |
|---|---|---|---|---|---|---|---|
| Solution (average over the 40 hands) | 1% | 8% | 19% | 6% | 66% | 0 | 100% |
| v2 | 0% | 13% | 13% | 13% | 63% | 0.09 ± 0.06 (n=40) | 90% ± 9 |
| v3 | 0% | 13% | 13% | 13% | 63% | 0.04 ± 0.02 (n=40) | 98% ± 5 |
| v3p | 0% | 15% | 5% | 8% | 73% | 0.05 ± 0.03 (n=40) | 98% ± 5 |

### ip-checked-to-wet: value betting and bluffing on a coordinated board

Board Jh Th 6s 9c 2h; Hero in position, top 30% preflop range; other player top 45%. Pot 19.5 bb, 90.5 bb behind.
Solver: 100 iterations; a best-responder gains 0.12% of the pot (independent recomputation: 0.12%; largest value difference 6.8e-13 chips). 40 Hero hands.

| | all-in | bet large | bet medium | bet small | check | Loss (bb per decision) | Action in the solution's support |
|---|---|---|---|---|---|---|---|
| Solution (average over the 40 hands) | 1% | 7% | 10% | 2% | 80% | 0 | 100% |
| v2 | 0% | 10% | 8% | 20% | 63% | 0.20 ± 0.13 (n=40) | 78% ± 13 |
| v3 | 0% | 13% | 5% | 18% | 65% | 0.12 ± 0.08 (n=40) | 78% ± 13 |
| v3p | 0% | 5% | 8% | 10% | 78% | 0.13 ± 0.11 (n=40) | 83% ± 12 |

### ip-facing-polar-lead: bluff-catching and value raising against a polar bet

Board Qs 8d 4c 3h Ks; Hero in position, top 30% preflop range; other player top 45%, betting range polar. Pot 19.5 bb, 90.5 bb behind.
Solver: 100 iterations; a best-responder gains 0.10% of the pot (independent recomputation: 0.10%; largest value difference 9.1e-13 chips). 40 Hero hands.

| | all-in | call | fold | raise large | Loss (bb per decision) | Action in the solution's support |
|---|---|---|---|---|---|---|
| Solution (average over the 40 hands) | 4% | 91% | 0% | 4% | 0 | 100% |
| v2 | 8% | 90% | 3% | 0% | 0.08 ± 0.11 (n=40) | 95% ± 7 |
| v3 | 8% | 90% | 3% | 0% | 0.08 ± 0.11 (n=40) | 95% ± 7 |
| v3p | 8% | 90% | 3% | 0% | 0.08 ± 0.11 (n=40) | 95% ± 7 |

### ip-facing-condensed-lead: raising for value and bluff-raising against a condensed bet

Board Qs 8d 4c 3h Ks; Hero in position, top 30% preflop range; other player top 45%, betting range condensed. Pot 19.5 bb, 90.5 bb behind.
Solver: 100 iterations; a best-responder gains 0.12% of the pot (independent recomputation: 0.12%; largest value difference 1.4e-12 chips). 40 Hero hands.

| | all-in | call | fold | raise large | Loss (bb per decision) | Action in the solution's support |
|---|---|---|---|---|---|---|
| Solution (average over the 40 hands) | 43% | 22% | 34% | 1% | 0 | 100% |
| v2 | 0% | 20% | 48% | 33% | 0.80 ± 0.36 (n=40) | 70% ± 14 |
| v3 | 55% | 13% | 0% | 33% | 1.06 ± 0.41 (n=40) | 50% ± 16 |
| v3p | 0% | 15% | 48% | 38% | 1.01 ± 0.42 (n=40) | 65% ± 15 |

### oop-check-raise-dry: check-raise, check-call, check-fold after checking first

Board Kh 9d 5s 2c 7h; Hero out of position, top 45% preflop range; other player top 30%. Pot 19.5 bb, 90.5 bb behind. Decision after Hero checks and the other player bets 14.6 bb; ranges at that node from the equilibrium.
Solver: 200 iterations; a best-responder gains 0.13% of the pot (independent recomputation: 0.13%; largest value difference 9.1e-13 chips). 40 Hero hands.

| | all-in | call | fold | raise large | Loss (bb per decision) | Action in the solution's support |
|---|---|---|---|---|---|---|
| Solution (average over the 40 hands) | 10% | 38% | 46% | 6% | 0 | 100% |
| v2 | 5% | 40% | 48% | 8% | 0.10 ± 0.08 (n=40) | 88% ± 10 |
| v3 | 8% | 40% | 48% | 5% | 0.15 ± 0.11 (n=40) | 88% ± 10 |
| v3p | 5% | 40% | 48% | 8% | 0.10 ± 0.08 (n=40) | 88% ± 10 |

### oop-check-raise-wet: check-raise on a coordinated board

Board Jh Th 6s 9c 2h; Hero out of position, top 45% preflop range; other player top 30%. Pot 19.5 bb, 90.5 bb behind. Decision after Hero checks and the other player bets 14.6 bb; ranges at that node from the equilibrium.
Solver: 200 iterations; a best-responder gains 0.13% of the pot (independent recomputation: 0.13%; largest value difference 6.8e-13 chips). 40 Hero hands.

| | all-in | call | fold | raise large | Loss (bb per decision) | Action in the solution's support |
|---|---|---|---|---|---|---|
| Solution (average over the 40 hands) | 11% | 41% | 44% | 3% | 0 | 100% |
| v2 | 5% | 38% | 48% | 10% | 0.17 ± 0.14 (n=40) | 88% ± 10 |
| v3 | 5% | 38% | 48% | 10% | 0.17 ± 0.14 (n=40) | 88% ± 10 |
| v3p | 5% | 38% | 48% | 10% | 0.17 ± 0.14 (n=40) | 88% ± 10 |

### All spots together

| Adviser | Loss (bb per decision) | Action in the solution's support |
|---|---|---|
| v2 | 0.22 ± 0.07 (n=280) | 84% ± 4 |
| v3 | 0.24 ± 0.08 (n=280) | 83% ± 4 |
| v3p | 0.22 ± 0.08 (n=280) | 86% ± 4 |


## Version 3 raises against a lead: predicted fold against the equilibrium fold

| Spot | Engine | Hero hand percentile | Action | Predicted fold of the range | Equilibrium fold at that node | Loss (bb) |
|---|---|---|---|---|---|---|
| ip-facing-polar-lead | v3 | 0.98 | allin 91 bb | 62% | 84% | 2.00 |
| ip-facing-polar-lead | v3p | 0.98 | allin 91 bb | 57% | 84% | 2.00 |
| ip-facing-polar-lead | v3 | 0.99 | allin 91 bb | 57% | 78% | 0.17 |
| ip-facing-polar-lead | v3p | 0.99 | allin 91 bb | 52% | 78% | 0.17 |
| ip-facing-polar-lead | v3 | 1.00 | allin 91 bb | 61% | 83% | 0.00 |
| ip-facing-polar-lead | v3p | 1.00 | allin 91 bb | 56% | 83% | 0.00 |
| ip-facing-condensed-lead | v3 | 0.21 | allin 91 bb | 78% | 74% | 0.00 |
| ip-facing-condensed-lead | v3 | 0.32 | allin 91 bb | 79% | 72% | 0.76 |
| ip-facing-condensed-lead | v3 | 0.32 | allin 91 bb | 79% | 72% | 1.18 |
| ip-facing-condensed-lead | v3 | 0.33 | allin 91 bb | 78% | 73% | 0.00 |
| ip-facing-condensed-lead | v3 | 0.33 | allin 91 bb | 79% | 73% | 0.00 |
| ip-facing-condensed-lead | v3 | 0.35 | allin 91 bb | 80% | 73% | 0.08 |
| ip-facing-condensed-lead | v3 | 0.35 | allin 91 bb | 79% | 73% | 0.00 |
| ip-facing-condensed-lead | v3 | 0.36 | allin 91 bb | 79% | 73% | 0.36 |
| ip-facing-condensed-lead | v3 | 0.36 | allin 91 bb | 80% | 72% | 1.06 |
| ip-facing-condensed-lead | v3 | 0.38 | allin 91 bb | 79% | 73% | 0.27 |
| ip-facing-condensed-lead | v3 | 0.38 | allin 91 bb | 80% | 72% | 0.62 |
| ip-facing-condensed-lead | v3 | 0.39 | allin 91 bb | 79% | 73% | 0.17 |
| ip-facing-condensed-lead | v3 | 0.39 | allin 91 bb | 79% | 72% | 0.90 |
| ip-facing-condensed-lead | v3 | 0.41 | allin 91 bb | 79% | 72% | 1.00 |
| ip-facing-condensed-lead | v3 | 0.41 | allin 91 bb | 79% | 73% | 0.00 |
| ip-facing-condensed-lead | v3 | 0.42 | allin 91 bb | 79% | 75% | 0.00 |
| ip-facing-condensed-lead | v3 | 0.50 | allin 91 bb | 80% | 72% | 1.18 |
| ip-facing-condensed-lead | v3 | 0.59 | allin 91 bb | 80% | 72% | 0.95 |
| ip-facing-condensed-lead | v3 | 0.59 | allin 91 bb | 81% | 72% | 1.70 |
| ip-facing-condensed-lead | v3 | 0.61 | allin 91 bb | 79% | 76% | 0.00 |
| ip-facing-condensed-lead | v3 | 0.61 | allin 91 bb | 79% | 75% | 0.65 |
| ip-facing-condensed-lead | v3 | 0.70 | allin 91 bb | 79% | 71% | 5.98 |
| ip-facing-condensed-lead | v3p | 0.78 | raise 50 bb | 37% | 63% | 4.84 |
| ip-facing-condensed-lead | v3p | 0.79 | raise 50 bb | 38% | 63% | 3.36 |
| ip-facing-condensed-lead | v3 | 0.79 | raise 50 bb | 53% | 63% | 3.43 |
| ip-facing-condensed-lead | v3p | 0.79 | raise 50 bb | 36% | 63% | 3.43 |
| ip-facing-condensed-lead | v3 | 0.80 | raise 50 bb | 54% | 62% | 0.51 |
| ip-facing-condensed-lead | v3p | 0.80 | raise 50 bb | 36% | 62% | 0.51 |
| ip-facing-condensed-lead | v3 | 0.84 | raise 50 bb | 67% | 64% | 0.54 |
| ip-facing-condensed-lead | v3p | 0.84 | raise 50 bb | 52% | 64% | 0.54 |
| ip-facing-condensed-lead | v3 | 0.86 | raise 50 bb | 67% | 64% | 1.61 |
| ip-facing-condensed-lead | v3p | 0.86 | raise 50 bb | 52% | 64% | 1.61 |
| ip-facing-condensed-lead | v3 | 0.87 | raise 50 bb | 66% | 63% | 1.62 |
| ip-facing-condensed-lead | v3p | 0.87 | raise 50 bb | 49% | 63% | 1.62 |
| ip-facing-condensed-lead | v3 | 0.87 | raise 50 bb | 67% | 63% | 1.27 |
| ip-facing-condensed-lead | v3p | 0.87 | raise 50 bb | 52% | 63% | 1.27 |
| ip-facing-condensed-lead | v3 | 0.88 | raise 50 bb | 64% | 63% | 1.67 |
| ip-facing-condensed-lead | v3p | 0.88 | raise 50 bb | 47% | 63% | 1.67 |
| ip-facing-condensed-lead | v3 | 0.89 | raise 50 bb | 64% | 61% | 2.41 |
| ip-facing-condensed-lead | v3p | 0.89 | raise 50 bb | 48% | 61% | 2.41 |
| ip-facing-condensed-lead | v3 | 0.89 | raise 50 bb | 67% | 62% | 2.30 |
| ip-facing-condensed-lead | v3p | 0.89 | raise 50 bb | 50% | 62% | 2.30 |
| ip-facing-condensed-lead | v3 | 0.90 | raise 50 bb | 63% | 56% | 4.18 |
| ip-facing-condensed-lead | v3p | 0.90 | raise 50 bb | 46% | 56% | 4.18 |
| ip-facing-condensed-lead | v3 | 0.98 | raise 50 bb | 67% | 67% | 0.27 |
| ip-facing-condensed-lead | v3p | 0.98 | raise 50 bb | 51% | 67% | 0.27 |
| ip-facing-condensed-lead | v3 | 0.99 | raise 50 bb | 68% | 59% | 2.96 |
| ip-facing-condensed-lead | v3p | 0.99 | raise 50 bb | 51% | 59% | 2.96 |
| ip-facing-condensed-lead | v3 | 1.00 | raise 50 bb | 69% | 68% | 2.87 |
| ip-facing-condensed-lead | v3p | 1.00 | raise 50 bb | 53% | 68% | 2.87 |

