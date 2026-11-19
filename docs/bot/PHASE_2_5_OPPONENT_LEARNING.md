# Phase 2.5: opponent learning from real cash-game hands

Started 2026-11-18 from commit `c39befe` (v0.8.1). Production (version 2) is unchanged; version 3 stays an offline
experiment; the extension's default engine is unchanged. Reports: [PHASE_2_5_CALIBRATION.md](../../reports/PHASE_2_5_CALIBRATION.md)
(models), [phase25-river-range.md](../../reports/phase25-river-range.md) (river ranges), [phase25-solver-spots.md](../../reports/phase25-solver-spots.md)
(solver references), [PHASE_2_5_STRATEGY_BENCHMARK.md](../../reports/PHASE_2_5_STRATEGY_BENCHMARK.md) (play).

**Result in one paragraph.** 89,170 real, valid cash-game hands were downloaded under the MIT licence, parsed and
replayed: a bounded sample of the HandHQ part of the PHH dataset, 2009 online 100NL–200NL. They contain 237,380
decisions after the flop, 165,751 of them in heads-up pots, and 3,987 called river bets with the bettor's cards
shown.

On them, version 3's hand-set opponent model is clearly beaten at predicting what players do. On held-out days a
logistic regression improves log loss by 0.030 nats per decision and a smoothed frequency table by 0.028. The
residual-calibrated version of version 3's own model, the only form the engine can use, improves it by 0.019, with
the same ordering on held-out players. Real players fold less than the model says, above all when raised, and raise
more.

Version 2's river betting ranges hold about half as many weak hands as real river bettors (8% against 15.5%). A
fitted re-weighting is a significant improvement in likelihood but corrects only part of the gap.

Version 3's failure to fold against a condensed river bet was traced to a bet-size response error at break-even, not
to equity, payoff or range errors. The calibrated model removes the all-in bluffs behind it.

Against the simulated opponents, on evaluation set A (seed 13100), none of the candidates plays measurably better or
worse than version 3: +2.6 ± 8.5, −2.5 ± 4.0 and +0.1 ± 8.7 bb/100. The final untouched set (seed 13300) was stopped
by a low-memory condition before any table finished and has not been run. **Better probability prediction is
established; stronger play is not.** Version 2 stays the default and version 3 stays offline.

## 1. The data: what was obtained, under what terms, and what was kept

**Source.** The PHH dataset of the University of Toronto Computer Poker Research Group
(`github.com/uoftcprg/phh-dataset`), **MIT licence** (LICENSE file read before downloading), pinned to commit
`e47fbd5` (release v3, 2025-09-18). Its `data/handhq` folder holds 21.6 million no-limit hold'em hands from
**anonymised** hand-history logs of online **cash games**, July 1–23 2009, 25NL to 1000NL, uploaded by HandHQ.
Player names are replaced by hashes. The repository does not say what rights the original sites or players kept in
the underlying logs. That is recorded in the source record
(`sim/bot/data/sources/handhq-2009-sample-v1.json`, validated by the Phase 2.2 validator). The data is used offline
for aggregate statistics only, and no hand, player hash or raw file is committed or sent anywhere. The dataset's WSOP
(tournament) and Pluribus (bot) folders were not fetched.

**Sample.** `sim/bot/data/fetch-handhq.ts`: 30 files from each of four folders (PokerStars 200NL, iPoker 100NL and
200NL, Absolute 100NL), evenly spaced over each folder's file numbers. The files are in time order, so the sample
covers every day. That is 120 files, 83.4 MB and 116,253 hands, downloaded sequentially into the git-ignored `data/`
folder with SHA-256 hashes, about 0.5% of the dataset. A first file was inspected before the rest were fetched.

| | Hands |
|---|---|
| Hand sections read / parsed | 116,253 / 115,944 |
| Excluded: heads-up tables | 26,195 |
| Rejected: chips not conserved | 576 |
| Rejected: straddle or dead blind | 309 |
| Rejected: illegal action / action after the end | 1 / 1 |
| Duplicates (same site and hand number) | 1 |
| **Valid cash hands kept** | **89,170** (PokerStars 20,756, iPoker 100NL 23,095, iPoker 200NL 23,212, Absolute 22,107) |
| Stacks not recorded (iPoker, written `inf`) | 46,307 |
| Distinct anonymised players | 11,187 |

**Problems found in the data, and what was done about each:**
- **Heads-up tables**: every heads-up hand lists p1 as the small blind but has p2 act first before the flop, which
  the rules do not allow, so either the blinds or the order are wrong. All heads-up-table hands are excluded rather
  than repaired by guesswork. Heads-up *pots* at 6-max and full-ring tables are kept.
- **iPoker stacks unknown**: such hands are replayed with 1,000 big blinds each and flagged. The stack-to-pot ratio is
  recorded as missing and is not used for them.
- **Hole cards**: known only when shown, which is a selected sample (see section 4). A card that was not shown is
  never used.

**Normalisation** (`sim/bot/phase25/extract.ts`). Every hand is replayed through the bot's own rules engine
(`validate.ts replayHand`), so legal actions, minimum raises, all-ins and opportunity denominators follow the same
rules the bot plays by. Every decision after the flop becomes one record:
- the street, the number of players in the hand, and what the player faced: free to bet, a bet, a raise of its own
  bet, a check-raise, or two bets cold;
- the bet to call as a fraction of the pot, position (last to act or not), and whether the player made the previous
  street's last bet;
- the stack-to-pot ratio, whether raising was legal, and the action taken (with the size of a bet).

Every called river bet becomes one record: the bettor's cards if shown, the caller's if shown, the board, the size and
the bettor's line. Totals: **237,380 decisions after the flop** and **165,751 of them in heads-up pots**.

| Street | may bet | facing a bet | own bet raised | bet check-raised | facing two bets cold |
|---|---|---|---|---|---|
| flop | 83,842 | 41,049 | 3,249 | 1,770 | 1,351 |
| turn | 46,358 | 19,264 | 1,334 | 670 | 269 |
| river | 26,531 | 10,665 | 766 | 160 | 102 |

**Splits.** Chronological: days 1–14 train (111,098 heads-up decisions), 15–18 validation (28,091), 19 and later test
(26,562). Hyperparameters were chosen on validation, models refitted on training plus validation, and the test set
scored once. A second protocol holds out a fifth of the players entirely. Intervals are clustered by hand.

## 2. Opponent-response models

`sim/bot/phase25/predict.ts`, `models.ts`, `calibrate.ts`. For each heads-up-pot decision, version 3's own model is
evaluated exactly as the engine uses it. The acting player's range is estimated from the public view, with no hidden
card removed. Each holding's strength is computed as version 3 does, and version 3's response functions are averaged
over the range. That gives the model's predicted probability of every action **conditional on the reconstructed state
and the whole history**.

| Model | What it is | Test log loss | vs A (95%) | Held-out players vs A |
|---|---|---|---|---|
| A | version 3 as it is (hand-set) | 0.7287 | – | – |
| B | frequency table per situation, Dirichlet-smoothed to the street | 0.7005 | −0.0282 ± 0.0041 | −0.0324 ± 0.0037 |
| C | multinomial logistic regression on public features (L2) | **0.6989** | **−0.0299 ± 0.0041** | **−0.0356 ± 0.0038** |
| D | version 3 with **residual calibration**: per situation, a fold-threshold shift and a raise or bet multiplier fitted by penalised likelihood on version 3's own range-conditional predictions; folding constrained to be monotone in bet size | 0.7101 | −0.0186 ± 0.0026 | −0.0223 ± 0.0024 |

Brier scores agree in every row. Facing a bet the gains are largest: −0.060 nats for C and −0.040 for D. On the river
facing a bet: −0.072 for C and −0.041 for D.

**Choice of architecture.** The simple frequency table (B) gets 94% of the best model's gain; the logistic regression
(C) is slightly better. D is the only one usable **inside** version 3, because the engine needs probabilities as a
function of the holding's strength, which B and C do not give. D captures about 60% of C's gain. The rest is
structure that one shift and one multiplier per situation cannot express (11 cells end on the grid's edges).

**What the hand-set model got wrong** (test days, version 3 predicted against observed):

| Situation | Predicted (A) | Observed | D |
|---|---|---|---|
| river, facing a bet | fold 65%, raise 5% | fold 53%, raise 8% | fold 57%, raise 8% |
| flop, own bet raised | fold 55% | fold 35% | fold 41% |
| river, own bet raised | fold 63% | fold 40% | fold 48% |
| flop, facing a bet | raise 7% | raise 12% | raise 11% |
| turn, may bet | bet 40% | bet 33% | bet 36% |

Real players fold **less** than the model says, especially when raised, and raise more often. That is the same
direction as Phase 2.4's over-raising cause, now measured on 89,170 real hands rather than one simulated opponent.

**The Phase 2.4 defect cannot recur.** D corrects the model's predictions for the actual states. A high fold rate that
the model already explains, because the range reaching the spot is weak or the bet is large, does not move it.
Tests in `tests/bot/phase25-learning.test.ts` check four properties:
- with synthetic data folding exactly as the model predicts (80%), the fitted correction stays at none for 100 and
  for 5,000 decisions, so it never becomes more aggressive just from seeing more folds;
- players folding more than predicted move the shift up;
- with 6 decisions the penalty keeps the model;
- folding stays monotone in bet size, and every probability is valid.

**What the models are not.** They describe 2009 online players. They say nothing about any individual, and the
anonymised identities are used only to split the data.

## 3. River decisions where version 3 was wrong

**Representative decisions.** The Phase 2.4 river weakness: facing a condensed river lead, version 3 never folded
where the equilibrium folds 34%. `sim/bot/solver-spots.ts` now records, for every version 3 raise against a lead,
the model's predicted fold rate of the bettor's range and the equilibrium's actual fold frequency at that node
(`villainActionProbs` in `river-reference.ts`). The candidate causes, separated:

| Candidate cause | Finding |
|---|---|
| Incorrect hand-range inference | **Excluded here**: the solver spots give every engine the spot's true range. |
| Wrong bluff / value composition | Same: the composition is specified. |
| Blockers and card removal | Handled in both the engine and the reference (Hero's cards removed). |
| Equity calculation | Exact on the river (tested since Phase 2.3). |
| Payoff or pot odds | Exact (tests: closed-form bluff-catch fixture, river arithmetic). |
| Prior-street history | Not involved (ranges specified). |
| **Bet-size-dependent response** | **The cause.** Version 3 shoved all-in with weak hands (percentiles 0.21–0.70, 55% of the spots), predicting that the condensed range folds **79%** to an all-in where the equilibrium folds **72–75%**. Risking 91 bb to win 33.5 bb needs 73%. A 6-point overestimate of folding exactly at break-even turned a zero-EV shove into an apparent profit. |

With the population calibration (D) version 3 predicts less folding after raises, stops the all-in bluffs (0%), and
folds 48% of these hands, as version 2 does. Its remaining loss on this spot (1.01 ± 0.42 bb against v2's 0.80 ±
0.36) comes from raises to 50 bb with strong hands. The equilibrium folds 56–64% to those raises; the calibrated model
predicts 36–53%, which is what real players do, not what the equilibrium does.

**The other half of the problem: inferred ranges.** In real play the bettor's range is not given; it is inferred.
Section 4 tests that inference on real hands.

## 4. River betting-range estimator

`sim/bot/phase25/river-range.ts`, `river-eval.ts`. The base is version 2's range estimate of the bettor after the bet.
It covers the preflop range, every earlier action, board texture through hand strength, bet sizing through the
behaviour model and position, and removes the caller's cards when they were shown (blockers). The estimator tilts
it by a log-weight per made-hand-percentile bin (6 bins), per bet-size class and per whether the bettor bet the turn.
The tilt is fitted by penalised maximum likelihood to the **revealed** holdings of called river bets; shape and
penalty were chosen on validation (per cell, λ = 30).

**Selection.** Only called bets are revealed. The caller decides without seeing the bettor's cards, so given the public
state the revealed holdings are a sample of the betting range. The exceptions are card removal by the caller's own
cards (removed when known) and the 8 of 4,246 called bettors (0.2%) who did not show. Uncalled bets are not in the
sample. Value, thin value and bluff are strength categories of the hypothesised range; only shown hands are facts.

Heads-up called river bets with the bettor's cards shown: 3,987 (train 2,696, validation 664, test 627).

| Test days | Version 2 | Estimator | Revealed |
|---|---|---|---|
| Log-likelihood of the revealed holding | −8.288 | −8.267 (+0.021 ± 0.017, significant) | |
| Value (percentile ≥ 0.75) | 71.3% | 69.0% | 62.8% |
| Thin / medium (0.40–0.75) | 20.6% | 20.7% | 21.7% |
| Weak / bluff (< 0.40) | 8.1% | 10.2% | 15.5% |
| Bettor holds a better made hand than a 0.5-percentile bluff-catcher | 87.2% | 84.9% | 79.7% ± 3.1 |
| … than a 0.7-percentile catcher | 77.1% | 74.9% | 68.3% ± 3.6 |

**Version 2's river betting ranges are too strong against real players.** They hold about half as many weak hands as
real bettors do. The estimator is a significant improvement in likelihood and moves every share the right way, but it
corrects only about a third of the gap, because the penalty that validation chose holds it close to version 2.
For a medium-strength bluff-catcher this matters directly: the bettor is ahead about 80% of the time, not 87%.

This is the opposite direction from Phase 2.4's simulated tight-aggressive opponent, against which river calls were
over-valued. The simulated opponents are not people, and an estimator fitted to people should not be expected to help
against them. Section 6 measures exactly that.

## 5. The candidates inside version 3

`src/bot/strategy/v3/empirical.ts`, with agent options `v3Population` and `v3RiverRange`. They are offline only: the
extension never sets them, and version 2 ignores them (tested). The fitted tables are small aggregate files next to
the engine (`population-calibration.json`, `river-range-calibration.json`); no hand data is in them.
- **Population calibration**: model D's per-situation fold-threshold shift and raise multiplier, interpolated over
  the bet size so that folding stays monotone (tested over 4,956 cases). Also a multiplier on betting for a player
  who may bet first. The per-player residual calibration of Phase 2.4 then works on top of the calibrated model, so
  the two do not count the same evidence twice.
- **River range**: when Hero faces a river bet, the bettor's range is re-weighted by the fitted tilt for its bet size
  and turn action.
- **Explanation**: each recommendation that used them says so, and says which part is an empirical estimate and which
  is hand-set: "empirical (source): …; the response functions themselves are hand-set" and "… value / bluff
  composition is a model hypothesis".
- **Uncertainty**: cells with little data stay at no correction (penalty). Version 3's model mixture (stickier and
  more aggressive opponents) still applies on top.

## 6. Play: held-out benchmarks

[reports/PHASE_2_5_STRATEGY_BENCHMARK.md](../../reports/PHASE_2_5_STRATEGY_BENCHMARK.md). Fourteen heads-up programs,
matched decks, seeds fixed in advance (13100 evaluation set A; 13300 final set; 13150 reference evaluation).

| Set A (seed 13100), 14 tables pooled | bb/100 |
|---|---|
| v3 − v2 | −1.7 ± 10.4 |
| v3p − v3 (population calibration) | +2.6 ± 8.5 |
| v3r − v3 (river range) | −2.5 ± 4.0 |
| v3pr − v3 (both) | +0.1 ± 8.7 |
| v3pr − v2 | −1.6 ± 10.4 |

One table out of 56 comparisons is significant: v3p against the calling station, +44.8 ± 33.6. Solver references:
v3p 0.22 ± 0.08 bb per decision lost against v3's 0.24 ± 0.08 and v2's 0.22 ± 0.07.

**The final set (seed 13300) was not completed.** Claude Code stopped the run because the machine ran low on memory,
before any table had finished, and the leftover processes were then stopped. The seed remains untouched. To run it:
`npm run bot:phase25 -- --bench --seed 13300 --jobs 1`, one process at a time. The per-decision reference evaluation
(seed 13150) was stopped with it.

**Why no gain is expected here.** The opponents are programs written in this repository, and the corrections were
fitted to people. A model that predicts people better is not more accurate about these programs. The test that would
matter, play against people, is the live recommend-mode sessions, and it needs many more of them.

## 7. What was established, item by item (the brief's checklist)

| Requirement | Status |
|---|---|
| 1. Genuine hand histories imported legally and parsed correctly | **Yes.** MIT-licensed source with its caveats recorded; 89,170 hands replayed by the rules engine; problems found and handled (heads-up tables excluded, unknown stacks flagged); parser and extraction tested on synthetic fixtures. |
| 2. Probability estimates improve against a held-out baseline | **Yes.** All three fitted models beat the hand-set model on held-out days and held-out players, by log loss and Brier score, with intervals clustered by hand. |
| 3. No train / test leakage | Chronological split by day (fit 1–14, choose 15–18, test 19+ once), plus a player-grouped split. Players do appear on several days in the chronological split; the player-grouped results agree. |
| 4. River range inference improves on reference cases | **Partly.** Significant likelihood gain on held-out real bettors, but only about a third of the composition gap is corrected. On the solver spots the true range is given, so there was nothing to infer. |
| 5. Candidate strategic improvements generalise across opponents | **Not shown.** No significant gain on set A; the final set was not run. |
| 6. EV gains have credible intervals | Every figure is reported with its 95% interval; none of the strategy gains excludes zero. |
| 7. No regression of extension functionality | Production code paths unchanged (version 2 ignores the options, tested); full test suite and build in section 9. |

## 8. Remaining data gaps

1. **Present-day and PokerNow players.** The sample is 2009 online play at 100NL–200NL. Whether it describes
   today's PokerNow tables is unknown; only the user's own recordings can tell.
2. **Hole cards outside showdown.** Responses can be fitted only as range averages, and version 3's response
   *functions* of hand strength remain hand-set. Fitting those needs hands whose cards are known whatever happened,
   such as one's own logged hands or a licensed dataset with full cards.
3. **Uncalled river bets.** The river estimator sees only called bets. Bluffs that always get folds are invisible.
4. **Heads-up tables.** Excluded because of the conversion's blind order. A correct source would add 26,000 hands.
5. **Raise cells are thin.** River check-raises: 160 decisions in all pots; heads-up and check-raised on the river: 20
   to 68 per size class.
6. **Larger sample.** Only 0.5% of HandHQ was used. More of it would mainly sharpen the rare cells; the fetch script
   takes `--per-folder`.

## 9. Reproduction, tests and build

`npm run bot:phase25 -- [--per-folder 30] [--bench --seed S --jobs 1]` runs the whole experiment. It fetches the
pinned dataset (hashes checked), then extracts, predicts, calibrates and evaluates the river estimator, and benchmarks
with at most `--jobs` processes. It writes `data/phh-handhq/derived/experiment.json` with the configuration, seeds,
dataset version and file hashes. Everything downloaded or derived stays under the git-ignored `data/` folder; only
code, the two small fitted tables, the source record and the reports are committed.

