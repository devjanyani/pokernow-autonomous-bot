## The existing PokerBench model against version 1 and version 2 (offline, experimental)

### 1. Is the model loaded correctly?

Agreement with the 2000 held-out PokerBench rows in `tests/fixtures/postflop-holdout.json`: 84.5%. Recorded when it was trained: 84.5% on the full test set.

### 2. Are its inputs built correctly?

Simulated postflop decisions of the measured seat: 994 (six-independent, hu-re; 1500 hands each, seed 9300). With more than two players still in: 224 (23%); the model has no such training rows and is not asked.
Heads-up decisions given to the model: 770. Action mask equal to the rules engine's legal actions: 770 of 770. Model action legal: 770 of 770.

### 3. Is it being asked familiar questions?

Decisions inside the training setting (six-handed table, raised pot, about 100 big blinds, nobody all-in): 313 of 770. Reasons the others fall outside (a decision can have several):

- 383 × heads-up table (trained on six-handed games that became heads-up after the flop)
- 202 × limped pot (no raise before the flop)
- 21 × a player is all-in

Model inputs whose distribution differs most between the held-out PokerBench rows and the simulated decisions (difference of means in standard deviations of the held-out rows; share of simulated decisions outside the range the held-out rows cover):

| Input | Held-out mean | Simulated mean | Difference (sd) | Outside the held-out range |
|---|---|---|---|---|
| street: flop | 0.06 | 0.55 | +2.09 | 0% |
| may bet | 0.34 | 0.70 | +0.77 | 0% |
| in position | 0.65 | 0.29 | -0.75 | 0% |
| street: river | 0.54 | 0.16 | -0.74 | 0% |
| may check | 0.36 | 0.70 | +0.72 | 0% |
| facing a bet | 0.64 | 0.30 | -0.72 | 0% |
| may fold | 0.64 | 0.30 | -0.72 | 0% |
| may call | 0.64 | 0.30 | -0.72 | 0% |
| bet faced / pot | 0.31 | 0.14 | -0.70 | 2% |
| bets and raises this street | 0.31 | 0.13 | -0.68 | 1% |
| may raise | 0.58 | 0.27 | -0.62 | 0% |
| board connectedness | 0.28 | 0.15 | -0.58 | 0% |
| low card rank | 0.57 | 0.43 | -0.54 | 0% |
| made hand: high card | 0.19 | 0.39 | +0.54 | 0% |

Not among the inputs at all, so no shift can be measured: stack depth, number of players at the table, sizes of earlier bets, anything about the opponent.

### 4a. Same class of action?

| Decisions | Model = version 2 | Model = version 1 | Version 2 = version 1 | Model bets or raises | Version 2 bets or raises | Version 1 bets or raises |
|---|---|---|---|---|---|---|
| all | 51% ± 4 (n=770) | 47% ± 4 (n=770) | 71% ± 3 (n=770) | 35% ± 3 (n=770) | 47% ± 4 (n=770) | 62% ± 3 (n=770) |
| inside the training setting | 51% ± 6 (n=313) | 46% ± 6 (n=313) | 70% ± 5 (n=313) | 32% ± 5 (n=313) | 48% ± 6 (n=313) | 66% ± 5 (n=313) |
| outside it | 50% ± 5 (n=457) | 48% ± 5 (n=457) | 72% ± 4 (n=457) | 37% ± 4 (n=457) | 47% ± 5 (n=457) | 59% ± 5 (n=457) |
| flop | 49% ± 5 (n=425) | 44% ± 5 (n=425) | 77% ± 4 (n=425) | 32% ± 4 (n=425) | 50% ± 5 (n=425) | 60% ± 5 (n=425) |
| turn | 50% ± 7 (n=218) | 50% ± 7 (n=218) | 66% ± 6 (n=218) | 35% ± 6 (n=218) | 47% ± 7 (n=218) | 66% ± 6 (n=218) |
| river | 56% ± 9 (n=127) | 55% ± 9 (n=127) | 60% ± 9 (n=127) | 43% ± 9 (n=127) | 41% ± 9 (n=127) | 61% ± 8 (n=127) |

### 4b. Value under the simulated opponents' true policies (bb per decision, paired on the same state and cards)

After the action every adviser's line is continued by version 2, so only this one decision differs. * marks an interval that excludes zero.

| Decisions | Model minus version 2 | Model minus version 1 | Version 2 minus version 1 |
|---|---|---|---|
| all | -1.27 ± 1.65 (n=386) | -1.80 ± 1.77 * (n=386) | -0.53 ± 1.66 (n=386) |
| inside the training setting | -3.35 ± 3.07 * (n=158) | -3.42 ± 3.50 (n=158) | -0.08 ± 2.45 (n=158) |
| outside it | +0.17 ± 1.80 (n=228) | -0.68 ± 1.75 (n=228) | -0.85 ± 2.25 (n=228) |
| flop | +0.58 ± 1.27 (n=217) | +0.53 ± 1.39 (n=217) | -0.05 ± 1.11 (n=217) |
| turn | -2.79 ± 3.40 (n=110) | -4.35 ± 4.63 (n=110) | -1.56 ± 3.44 (n=110) |
| river | -5.25 ± 7.33 (n=59) | -5.65 ± 5.58 * (n=59) | -0.40 ± 7.86 (n=59) |

### 4c. River decisions against the solver reference

Heads-up tables hu-re, hu-trapper, hu-tag, hu-mdf; 3000 hands each, seed 9350. Ranges are version 2's own beliefs; the reference is an approximate equilibrium of the one-street river game (see `sim/bot/river-reference.ts`), not a solution of the whole hand. Every one of these spots is outside the model's training setting (heads-up table).

1455 river spots solved (0 dropped: no usable ranges, or the solution could be beaten by more than 1.0% of the pot).
Quality of the solutions used: a best-responder gains a median of 0.16% of the pot, at most 0.30%. Largest difference between the solver's values and the independent recomputation: 2.7e-11 chips.

### River, no bet to face (1279 spots)

| | check | bet small | bet medium | bet large or more | Loss against the solution (bb) | Loss minus version 1's (bb) | Action has at least 5% in the solution |
|---|---|---|---|---|---|---|---|
| Solution, for Hero's hand | 30% ± 2 | 16% ± 2 | 12% ± 1 | 41% ± 2 | 0 by definition | | |
| v1 | 15% ± 2 | 25% ± 2 | 18% ± 2 | 42% ± 3 | 1.30 ± 0.19 (n=1279) |  | 38% ± 3 |
| v2 | 62% ± 3 | 13% ± 2 | 10% ± 2 | 16% ± 2 | 2.45 ± 0.25 (n=1279) | 1.15 ± 0.24 | 42% ± 3 |
| model | 43% ± 3 | 1% ± 0 | 32% ± 3 | 24% ± 2 | 1.83 ± 0.23 (n=1279) | 0.53 ± 0.23 | 36% ± 3 |

### River, facing a bet (176 spots)

| | fold | call | raise | Loss against the solution (bb) | Loss minus version 1's (bb) | Action has at least 5% in the solution |
|---|---|---|---|---|---|---|
| Solution, for Hero's hand | 66% ± 7 | 7% ± 4 | 27% ± 6 | 0 by definition | | |
| v1 | 38% ± 7 | 31% ± 7 | 32% ± 7 | 6.48 ± 1.60 (n=176) |  | 46% ± 7 |
| v2 | 65% ± 7 | 24% ± 6 | 11% ± 5 | 5.58 ± 1.66 (n=176) | -0.89 ± 1.57 | 66% ± 7 |
| model | 49% ± 7 | 18% ± 6 | 34% ± 7 | 7.70 ± 2.21 (n=176) | 1.22 ± 2.32 | 53% ± 7 |

