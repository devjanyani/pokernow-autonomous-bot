# Phase 2.5: river betting-range estimator on real called river bets

Heads-up pots, river bets or raises that were called: 3987; bettor's cards revealed: 3987 (100.0%). Usable observations: 3987 (train 2696, validation 664, test 627).

Shape and penalty chosen on validation (mean log-likelihood): per cell 0.1: -8.5983, per cell 1: -8.5943, per cell 10: -8.5767, per cell 30: -8.5703, per cell 100: -8.5731, pooled 0.1: -8.6061, pooled 1: -8.6056, pooled 10: -8.6014, pooled 30: -8.5953, pooled 100: -8.5875 → **per cell, 30**.

## Test days: likelihood of the revealed holding

| Range | Mean log-likelihood per observation |
|---|---|
| Version 2's estimate | -8.2879 |
| Estimator (tilted) | -8.2669 |
| Difference (estimator minus version 2) | +0.0210 ± 0.0168 * |

## Test days: strength composition of river betting ranges (made-hand percentile on the river)

| Category | Version 2 predicts | Estimator predicts | Revealed |
|---|---|---|---|
| value | 71.3% | 69.0% | 62.8% |
| thin / medium | 20.6% | 20.7% | 21.7% |
| bluff (weak) | 8.1% | 10.2% | 15.5% |

Value = percentile 0.75 or more; thin / medium = 0.40 to 0.75; bluff (weak) = under 0.40. Categories describe the hypothesised range; only revealed hands are facts.

## Test days: how often a river bettor beats a bluff-catcher of made-hand percentile x

Predicted = the range's share of holdings with a higher percentile than x; observed = how often the revealed holding had one.

| x | n | Version 2 predicts | Estimator predicts | Observed |
|---|---|---|---|---|
| 0.5 | 627 | 87.2% | 84.9% | 79.7% ± 3.1 |
| 0.6 | 627 | 83.5% | 81.0% | 75.8% ± 3.4 |
| 0.7 | 627 | 77.1% | 74.9% | 68.3% ± 3.6 |
| 0.8 | 627 | 63.9% | 62.2% | 57.6% ± 3.9 |

## Fitted tilts (log-weight per percentile bin, fitted on days 1-18)

| Cell | <0.2 | 0.2-0.4 | 0.4-0.6 | 0.6-0.75 | 0.75-0.9 | ≥0.9 | Observations |
|---|---|---|---|---|---|---|---|
| large|barrel | +0.19 | +0.10 | +0.08 | -0.09 | -0.36 | +0.08 | 192 |
| large|no-turn-bet | +0.34 | -0.07 | -0.21 | -0.24 | -0.25 | +0.43 | 319 |
| medium|barrel | +0.50 | +0.21 | +0.15 | -0.15 | -0.39 | -0.33 | 661 |
| medium|no-turn-bet | +0.60 | +0.16 | -0.23 | -0.37 | -0.15 | -0.00 | 826 |
| overbet|barrel | -0.01 | +0.07 | +0.02 | -0.02 | -0.08 | +0.02 | 28 |
| overbet|no-turn-bet | +0.03 | +0.02 | -0.04 | -0.06 | -0.07 | +0.12 | 32 |
| small|barrel | +0.10 | +0.36 | +0.36 | +0.32 | -0.29 | -0.85 | 692 |
| small|no-turn-bet | +0.16 | +0.03 | -0.01 | -0.02 | -0.16 | +0.00 | 610 |
