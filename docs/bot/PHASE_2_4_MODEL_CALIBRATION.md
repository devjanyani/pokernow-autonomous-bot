# Phase 2.4: version 3's over-raising, its opponent calibration, and its value bias

Started 2026-11-18 from commit `14fe4ae` (v0.8.0). Version 2 stays the default; version 3 stays an offline
experiment (not offered in the extension). Benchmark tables: [reports/PHASE_2_4_BENCHMARK.md](../../reports/PHASE_2_4_BENCHMARK.md).

**Result in one paragraph.** Version 3 over-raised because its learned opponent knobs compared a player's raw fold
rate after Hero's raises with a fixed population rate. That rate is mostly a product of whom Hero raises and when,
which the model already accounts for, so the knobs counted it twice and drifted toward "this player folds" as hands
accumulated. The knobs are now calibrated on residuals: observed responses against the model's own predictions for
the same opportunities. On the decks that exposed the defect this is worth +73 ± 50 bb/100 over 0.8.0, and raising
when facing a bet falls from 76% to 52%. On two fresh seeds chosen in advance, version 3 and version 2 are equal:
−1.8 ± 10.1 and −0.6 ± 10.9 bb/100 over 14 heads-up tables each, and −0.15 to 0.00 bb per decision in three fresh
per-decision evaluations. The upward bias in v3's values of lines with later choices is real (up to 0.9 bb at 400
deals) but does not measurably change its choices; the unbiased estimator picks worse actions and stays off. The
recorded cash game cannot calibrate any response to a raise (5 observations each). **Version 3 is not ready to be
promoted.** It is no longer worse than version 2, but it is not better either, and its fold-to-raise behaviour for
real opponents rests on hand-set assumptions.

## 1. State at the start

`git status`: clean apart from an untracked `repomix-output.txt` that is not part of this work (left alone). No
simulation was running: the background jobs of the previous session had all finished, and none of their results
was missing.

## 2. Why version 3 raised so often

The held-out run of Phase 2.3 (seed 12300) had version 3 raising 76% of the times it faced a bet against version 2's
own model as the opponent ("range-aware"), and losing to version 2 there by 114 ± 60 bb/100.

### Method

`sim/bot/v3-raise-diag.ts` plays the session again and records every bet and raise version 3 makes after the flop:
- the model's predicted fold / call / raise probabilities for the opponent's **actual** holding (known in the
  simulator) and for the whole modelled range;
- what the opponent then did;
- for the range-aware opponent, the strength it computes for its own holding at that moment, and its own fold
  probability (its policy is the same function family, so this can be read exactly);
- version 3's candidate values (fold, call, each raise) and the split of the chosen raise's value into what comes
  from folds, calls and raises; and the opponent knobs version 3 had learned.

Over many decisions the actual fold rate estimates the true mean fold probability, so predicted and actual can be
compared per situation. Seed 12300 (a development seed since Phase 2.3) was used for all of this.

### What was found (range-aware opponent, 694 bets and raises, 273 of them raises)

| Situation | n | Actual fold | Predicted, actual holding | Opponent's own fold probability | Strength: version 3's / the opponent's own |
|---|---|---|---|---|---|
| flop check-raise | 142 | 67% ± 8 | 69% | 67% | 0.62 / 0.50 |
| turn check-raise | 37 | 59% ± 16 | **78% *** | 57% | 0.63 / 0.57 |
| river check-raise | 19 | 58% ± 22 | **94% *** | 73% | 0.66 / 0.57 |
| river raise | 14 | 57% ± 26 | 78% | 69% | 0.68 / 0.57 |
| flop bet | 158 | 51% ± 8 | 48% | 54% | 0.54 / 0.47 |

The opponent's own fold probability matches its actual fold rate in every row, so the measurement is right. Two
things differ between the model and the opponent:

1. **The response function had been pushed toward folding by the learned knobs (the cause of the over-raising).**
   At the opponent's own strength, version 3's response function predicted 82% folds to the flop check-raises where
   the opponent's function gives 67%. The difference was the learned knobs: by the end of the session version 3 had
   "learned" *extra folding to a check-raise +0.13* (from 127 folds in 197, estimate 64%) and *extra folding when
   raised +0.09* (158 of 272, 58%). These knobs compared the player's **raw** fold rate with a fixed population rate
   of 45%. But the raw rate depends on the hands Hero raises with and the hands the player holds when raised.
   Version 3's check-raises were polar and the opponent's betting range was wide, so a high fold rate was what the
   model already predicted for these spots. Reading it again as "this player folds more" counted the same thing
   twice. The raise multiplier had the same flaw (×0.58 "raises facing a bet" from 39 in 693). The knob grew with
   the number of hands. That is why the 600-hand reference evaluation found 0.8.0's decisions no worse than
   version 2's (+0.20 ± 0.56 bb per decision), while the 2,000-hand benchmark found −114 bb/100.
2. **The holding's strength is computed against Hero's range before Hero's action.** Version 3 measures the
   opponent's strength once per street, against Hero's perceived range at the decision. The range-aware opponent
   measures it against Hero's range after the bet or raise, which is narrower. Its holdings are then weaker
   (0.50 against 0.62), so this error makes version 3 *under*-predict folds. It partly hid error 1 on the flop.
   It is a modelling assumption about how opponents read Hero (it would be right only for opponents who read
   ranges as version 2's model does), not a mathematical inconsistency, so it was recorded and not changed.

Ruled out: the range update (the reach weights) is exact under the model, and fixture 8 below checks that it narrows
as it should. Future-street values are covered in section 4. A cap on raising frequency was not considered.

Representative decisions (bb; "folds / calls / raises" = the chosen raise's value from each response):

| Spot | Predicted fold: holding / range | Opponent's own | Actual | Values | From folds / calls / raises |
|---|---|---|---|---|---|
| turn check-raise of a 92%-pot bet | 34% / 61% | 8% | call | fold 0, call −4.5, raise 1.8, all-in 3.9 | +29.8 / −25.8 / 0 |
| river raise of a small bet | 3% / 51% | 2% | call | fold 0, call −2.5, all-in 29.2 | +59.5 / −30.3 / 0 |
| flop check-raise of a pot bet | 92% / 74% | 66% | call | fold 0, call −1.0, raise 0.3 / 0.9 | +2.8 / −1.7 / −0.2 |
| flop check-raise of a pot bet | 98% / 72% | 98% | fold | fold 0, call 0.8, raise 0.9 / 1.2 | +2.2 / −0.9 / −0.1 |

In the first two the whole value of the raise comes from folds that the range's predicted fold rate (61%, 51%)
promises and the opponent does not deliver.

### The correction: residual calibration

`src/bot/strategy/v3/model.ts` (`CALIB_GRID`, `solveCalib`), `search.ts` (`calibCurve`), `agent.ts`. Each time
version 3 bets or raises, it records the response probability its own model predicts for the whole range at each
point of a grid of the relevant knob: the fold-to-check-raise shift, the fold-when-raised shift, or the raise
multiplier when facing a bet. When the hand is observed, it adds what the player did. The knob is set to the grid
value at which the model's predictions add up to the observed count, after shrinking that count toward the model's
own neutral prediction with 20 pseudo-opportunities. If the player responds as the model predicts, the knob does not
move, however many hands are seen. If the player folds 60% where the model predicts 40%, the knob moves toward the
value that predicts 60%. The raw-frequency use of `raiseVsBet*`, `foldToCheckRaise` and `foldVsRaise` was removed
(the profile still counts them). Tests: `tests/bot/strategy-v3.test.ts` ("residual calibration", "raw frequencies
… do not move the response knobs", and the agent test that records predictions and responses).

On the development decks (seed 12300, the same decks as the stored runs) against the range-aware opponent:

| | 0.8.0 version 3 | corrected version 3 |
|---|---|---|
| Raises when facing a bet | 76% | 52% |
| Flop check-raise: predicted / actual fold | 69% / 67% (with the knob +0.13) | 60% / 64% |
| Versus version 2, bb/100 | −114.0 ± 60.2 | −41.0 ± 40.5 |
| Corrected minus 0.8.0, same decks | | **+73.0 ± 50.4** |
| Per decision versus version 2 (reference evaluation, 600 hands) | +0.20 ± 0.56 | +0.06 ± 0.55 |

At the seven other development tables the correction changed nothing significantly (−8 to +16 bb/100).

Not corrected: `cbetTurn` and `betWhenCheckedToRiver` still move the turn-barrel and river-bet multipliers from
raw frequencies. Those frequencies are confounded too (they depend on Hero's checking range), but less directly,
and nothing measured points at them.

## 3. What the recorded cash game can calibrate

`sim/bot/cash-raise-counts.ts` on the 2026-11-18 cash recording (96 rebuilt hands; the tournament recording was
not used). Responses after the flop, by every player, Beta(1,1) posterior and 90% interval:

| Situation | Heads-up | Multiway |
|---|---|---|
| Facing a bet | 53: fold 23, call 22, raise 8 | 100: fold 66, call 26, raise 8 |
| Facing a check-raise | 5: fold 0, call 5 | 7: fold 7 |
| Own bet raised | 5: fold 1, call 4 | 2: call 2 |
| Facing a third bet or more | 0 | 0 |

Hero's heads-up bets and raises with a recorded response, which is what residual calibration needs: 5 bets (no
raise followed; the model predicted 0.4), **no raises at all**.

- **Fold to a check-raise, fold when raised, re-raise when raised: not estimable.** There are 5 heads-up observations
  of each, and the intervals span most of 0–100% (fold to a heads-up check-raise: 0 of 5, interval 0–35%). No
  population or player value is taken from them.
- Raising facing a bet heads-up (8 of 53, 16%, 8–24%) is consistent with the model's assumptions (12% flop, 10%
  turn, 8% river) and not precise enough to move them.
- So for real opponents version 3's fold-to-raise behaviour rests entirely on the hand-set model. The residual
  calibration would correct it per player, but only after dozens of version 3 raises against that player, and only
  in offline use (it is held in memory and version 3 does not run in the extension).

**Sensitivity instead of calibration.** Version 3 already decides against a mixture: the modelled opponent, one 0.4
stickier, and one more aggressive, with 20% each before evidence. The reference fixtures (section 5) check the
direction of each sensitivity: the same bluff-raise is worth less against a calling station, and an aggressive
opponent turns a set's call or raise into a large gain. The solver spots (section 6) check what happens when the
opponent plays the equilibrium instead of the model.

## 4. Future-street value optimism

Sources examined, with the instrument used:

| Candidate cause | Finding |
|---|---|
| Optimistic action selection in noisy rollouts | **Present, and the largest.** Plain valuation chooses Hero's later actions on the same deals it values them on, so values are biased upward: up to +18 chips (0.9 bb) at 400 deals on lines with many later choices, falling to about 1 chip at 1,200 (`sim/bot/v3-bias.ts`, against a 12,000-deal reference). |
| Double counting of future options | Not found. Each later option is a separate tree node, and the 'realize' leaf discounts only the showdown share. The exact river test and fixture 6 (value equals the closed form) pass. |
| Inconsistent opponent probabilities | The strength-timing assumption of section 2 (it affects how often the opponent folds, not the future values themselves). |
| Incorrect conditional ranges | Reach weights are exact under the model (fixture 8). The **starting** range is the problem: on the river, calls are valued +12.7 ± 8.5 bb too high against the tight-aggressive opponent and +12.4 ± 32 against the range-aware one. A river call has no later street, so this is the bettor's range estimate (inherited from version 2), not search optimism. |
| Terminal approximation | The next-street leaves use version 2's realization factor, a heuristic. Measured only indirectly: turn checks and calls are optimistic by about 1.8 and 4.7 bb (not significant). |
| Search-depth boundary | Two streets. A flop decision ends with a realize leaf after the turn; a turn decision is exact to the river. |

**Corrections tried** (same total deals, 12 repetitions, six spots including two facing a bet and one on the turn):

| Valuation | Bias | Picks the reference's best action | Total regret over the six spots, 400 / 1,200 deals |
|---|---|---|---|
| plain (default) | upward, up to +18 chips | 60 / 72 at 400 deals | **2.9 / 0.0 chips** |
| cross-fitting (Phase 2.3) | small | 60 / 72 | 14.3 / 2.8 |
| holdout, every 2nd deal values | none for its own policy | 62 / 72 | 4.6 / 0.0 |
| holdout, every 3rd deal values | none for its own policy | 53 / 72 | 22.9 / 0.0 |

Holdout valuation (new, `SearchConfig.holdoutEvery`) is the mathematically clean estimator: later choices are made
on some deals, and root values are taken only from the deals that played no part in them. It removes the bias, but
at the deal counts that fit the time budget it picks worse root actions, because the root comparison then rests on
fewer deals. The bias of plain valuation is spread fairly evenly across the candidates, so it inflates the reported
values more than it changes the order. Plain therefore stays the default and holdout is an option.
**What is optimistic, then, is the reported value of a line, not (measurably) the choice.** The explanation's
figures should be read as upper estimates. Remaining fixes would be more deals or a variance-reduced comparison
(common random numbers are already used).

After the correction of section 2, version 3's own estimate for bets and raises against the range-aware opponent is
+0.34 ± 0.74 bb against the reference value (not significant). In 0.8.0 it was +1.08 ± 0.94 bb (significant)
against the tight-aggressive opponent.

## 5. Reference fixtures

`tests/bot/v3-reference-fixtures.test.ts`. Each fixture specifies the opponent's range and type explicitly and
checks what a best response must do.

| # | Fixture | Checked |
|---|---|---|
| 1 | Facing a bet with a weak hand (7-2 on K-9-5) against a value-heavy range | folds; every raise loses |
| 2 | Bluff-raising against a calling station | the raise is worth less than against a neutral opponent, and not chosen |
| 3 | A set facing an aggressive opponent | calls or raises, worth more than half the pot; never folds to a re-raise |
| 4 | Facing a potential re-raise: top pair, weak kicker, raising into a value range | the plan folds to a re-raise |
| 5 | Check-raising with a combination draw (8h 7h on 9h 6c 2h) | after a check, the best answer to every flop bet is a raise labelled semi-bluff, worth more than folding |
| 6 | River bluff-catch against the **closed-form equilibrium** of the polarised game (pot bet, aces against 1:2 bluffs) | calling is worth what folding is (0), within 4% of the pot; raising is worse |
| 7 | River raise with a medium hand (second pair) against a value-heavy range | raising is worse than calling or folding |
| 8 | Multi-street narrowing | the opponent's strong share grows from 50% after Hero's check, to more after its flop bet, to more again after its turn bet |

Limits: fixtures 1–5, 7 and 8 test a best response to a stated model, not equilibrium play. Fixture 6 is the only
exact equilibrium reference; the solver spots of section 6 are the broader one.

## 6. Solver references

Seven river spots with independently specified ranges (`sim/bot/solver-spots.ts`, 40 hands each, every solution
within 0.15% of the pot of equilibrium). Version 3's rows are identical to 0.8.0, because these are single decisions
without history, where residual calibration has nothing to act on. All 280 decisions: v1 0.37 ± 0.09, v2 0.22 ± 0.07,
v3 0.24 ± 0.08 bb per decision lost against the solution. Facing a condensed river bet, version 3 still never folds
where the equilibrium folds 34%. That is the population response function, not a learned knob. Fixture 6 adds an
exact equilibrium check (bluff-catching in the polarised game), which version 3 passes. Limits: one-street river
games with chosen ranges and a discrete abstraction (bets of 33, 75 and 125% of the pot, one raise, all-in); they
say what an equilibrium opponent could take from an action, not what people do.

## 7. Held-out benchmarks

Seeds fixed before the runs: 12700 (set A) and 12900 (final, run once after every decision). 17 tables each: the
four archetypes, nine simple and independent programs, version 2's own model, and three six-handed tables.
Version 2 and version 3 only (version 1 and the PokerBench model were measured in Phase 2.3).

| | Set A (12700) | Final (12900) |
|---|---|---|
| v3 − v2, 14 heads-up tables pooled | −1.8 ± 10.1 | −0.6 ± 10.9 |
| without version 2's model as the opponent (13 tables) | −2.0 ± 10.6 | +0.1 ± 11.4 |
| version 2's model as the opponent | +1.3 ± 31.9 | −9.9 ± 33.5 |
| six-handed (3 tables) | +3.1 ± 17.6 | +0.8 ± 19.6 |
| tables significant at 95% | none | loose-aggressive +56.4 ± 53.2, adaptive punisher −39.8 ± 33.2 |

Per decision, seed 12750, against independent opponents: tight-aggressive −0.05 ± 0.71, trapper −0.15 ± 0.40,
mdf-defender −0.00 ± 0.47 bb (version 3's choice minus version 2's, both continued by version 2).

**Does the correction generalise?** The failure it removes (−114 against version 2's model) does not reappear on
either fresh seed (+1.3, −9.9, both within the intervals). Against the other opponents it changes nothing measurable,
which is what the mechanism predicts: residual calibration moves a knob only where the model's predictions are wrong
for that opponent. What does not generalise is any advantage over version 2. There is none on either fresh set.

## 8. Is version 3 ready for experimental live recommendations?

No, not yet. In its favour: the over-raising failure is gone; per decision it is level with version 2 against every
opponent measured; it explains check-raise plans and where a bet's value comes from; it runs in 20 to 265 ms. Against:
- it is not better than version 2 on either fresh seed, so offering it would add risk without measured gain;
- for real opponents its fold-to-raise and re-raise behaviour rests entirely on hand-set thresholds. The one recorded
  cash session has 5 heads-up responses to raises, and the residual calibration needs dozens of version 3's own
  raises against a player before it moves;
- it never folds to a condensed river bet in the solver spot (the equilibrium folds 34%);
- its value estimates are off by ±1.5 to 4 bb on the turn against some opponents (model mismatch), so the figures in
  its explanation are not reliable;
- the calibration is held in memory only, and version 3 is not wired into the extension's storage.

Version 2 stays the default; Settings still offers versions 1 and 2; nothing in tracking, legal actions, the
interface or storage changed.

## 9. Data still needed

1. **More recorded cash sessions** (recommend mode, as now). Each fold-to-raise statistic needs at least 50 heads-up
   responses to raises before a population value is worth estimating; at the rate of the 2026-11-18 session
   (5 per 100 hands) that is roughly 1,000 hands. Showdowns with cards shown are what allow ranges to be checked.
2. **Hand histories with known hole cards**, from a source whose terms permit this use (for example the user's own
   PokerNow logs, or a licensed dataset). They would let the response functions be fitted as functions of hand
   strength, which counts of actions cannot do.
3. **Solver references beyond the river**: turn spots (two streets) with the in-repository solver or an external
   solver run offline. They would test the next-street leaves and the realization factor, the remaining heuristic in
   version 3's values.
4. **A turn and river check of the bettor's range** (river calls are valued 12.7 ± 8.5 bb too high against the tight-aggressive opponent, and +12.4 ± 32 against the range-aware one, which is not significant):
   this is version 2's range estimate, and showdown data from real sessions is the way to test it.

