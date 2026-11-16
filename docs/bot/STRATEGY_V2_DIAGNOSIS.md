# Strategy v2 diagnosis (Phase 2.1)

Dated 2026-11-16. Branch `autonomous-bot`, version 0.6.1.

"v1" is the strategy engine as released in 0.5.1, kept runnable as `engine: 'v1'`. "v2" is the engine released in 0.6.0 (two-street look-ahead, range-aware opponent model, strategy library). All win rates are big blinds per 100 hands with a 95% confidence interval. "Paired" means the same decks, seats, opponents and opponent seeds, with only the measured seat's engine changed, each deck played from every seat.

**Summary.** v2 has not been shown to be better than v1 anywhere, and it is significantly worse in several simulated settings. The deficit comes from the postflop engine, not the preflop changes. v2 bets much less often and folds more to flop bets, and against the simulated opponents that costs chips. Two of v2's own safety assumptions were tested as causes and are not the cause. v2 also depends about twice as heavily as v1 on learned opponent statistics: before it has them, its default assumptions fit unusual opponents worse. One mathematical defect in the uncertainty calculation was confirmed and fixed; it does not explain the deficit. The out-of-position weak-pair lead comes from an optimistic assumption about the turn, not from fold equity and not from a coding error. No strategic behaviour was changed in this phase.

## 1. Verified benchmark results

### 1.1 Provenance of `reports/strategy-bench-2026-11-14.md`

`PROJECT_PROGRESS.md` said this benchmark was stopped before it produced anything. That was wrong. The process kept running and wrote its report at 01:42 local time on 2026-11-14, two minutes after the end-of-session commit.

Checks made:

- The report's start time is 00:32; the 0.6.0 commit (`921447a`) is 00:39. Three source files were saved one to two minutes after the start (an explanation string and two unused names, per the session notes), after the process had loaded its code.
- To test whether that matters, the row "Heads-up vs tight-aggressive" (10,000 hands) was re-run from a clean checkout of the commit with the report's seeds: `npx tsx sim/bot/strategy-diag.ts --exp repro`. Result: v1 +95.681000 (report: +95.681000), v2 +69.783000 (report: +69.783000). Identical to six decimals for both engines.

Conclusion: the report is a genuine, completed run of seed 2027 and corresponds to the committed 0.6.0 source for the row tested. The other rows were not re-run (about an hour); nothing suggests they differ. The report is now committed.

### 1.2 What it says

| Comparison | Hands | Paired difference, v2 − v1 | Verdict |
|---|---|---|---|
| Six-handed, mixed archetypes | 12,000 | −14.4 ± 20.0 | not significant |
| Six-handed, independent only | 12,000 | −31.8 ± 39.9 | not significant |
| Six-handed, range-aware opponents | 9,000 | −0.1 ± 13.9 | not significant |
| Six-handed, everything mixed | 12,000 | −17.4 ± 18.7 | not significant |
| Nine-handed, mixed | 9,000 | +0.5 ± 41.8 | not significant |
| Three-handed, mixed | 9,000 | −6.3 ± 14.8 | not significant |
| Heads-up vs range-equity | 10,000 | −4.2 ± 11.9 | not significant |
| Heads-up vs range-aware | 10,000 | +13.1 ± 15.4 | not significant |
| Heads-up vs tight-aggressive | 10,000 | −25.9 ± 16.5 | **v2 behind** |
| Heads-up vs the original repository engine | 6,000 | +7.0 ± 37.3 | not significant |
| Three v2 seats against three v1 seats | 12,000 | −9.1 ± 7.6 per seat | **v2 behind** |
| Hero forced into loose preflop calls | 12,000 | −29.6 ± 25.0 | **v2 behind** |
| Statistics off, against calling stations, random players, one loose-passive | 9,000 | −82.9 ± 64.8 | **v2 behind** |

Nine of the thirteen point estimates are negative, four significantly. None is significantly positive.

Seed 2027 was the held-out seed. It has now been looked at, so it is no longer held out. The experiments below use development seeds 4100 to 5100. A future held-out run needs a new seed.

## 2. Why v2 underperforms

### 2.1 It is the postflop engine

Section 5 has the full factorial. In short: wherever a significant difference appears, changing only the postflop engine reproduces it, and changing only the preflop engine does not. Heads-up tables never reach the v2 preflop code at all (they use the heads-up chart in both engines), so the whole heads-up deficit is postflop by construction.

### 2.2 What v2 does differently at the table

Counted over the measured seat's decisions in the factorial runs (v1/v1 against v2/v2):

| Decision | Heads-up vs tight-aggressive | Six-handed independent | Six-handed mixed |
|---|---|---|---|
| Flop, checked to or first: bets | v1 88.5%, v2 70.2% | v1 66.3%, v2 41.9% | v1 65.1%, v2 43.8% |
| Turn, checked to or first: bets | v1 65.3%, v2 50.1% | v1 76.9%, v2 54.0% | v1 78.4%, v2 51.8% |
| River, checked to or first: bets | v1 73.6%, v2 36.3% | v1 70.5%, v2 48.2% | v1 71.4%, v2 42.0% |
| Flop, facing a bet: folds | v1 60.2%, v2 70.5% | v1 65.3%, v2 75.8% | v1 53.1%, v2 72.9% |
| Flop, facing a bet: calls | v1 22.5%, v2 14.7% | v1 12.1%, v2 10.1% | v1 27.5%, v2 9.5% |

v2 bets 15 to 37 points less often on every street and folds 10 to 20 points more often to a flop bet. This is the same in all three settings. It is the direct, mechanical reason for the difference in results: the hands in which the measured seat saw a flop account for the whole gap (heads-up: +95.7 bb/100 for v1 against +63.7 for v2 from flop-seen hands, and an identical +15.7 from the rest).

### 2.3 Two suspected causes tested and ruled out

Ablations on the heads-up table against the tight-aggressive program, 6,000 hands, seed 4100, preflop identical throughout:

| Postflop variant | bb/100 | Paired vs v1 postflop | Paired vs v2 postflop |
|---|---|---|---|
| v1 | +111.3 ± 28.1 | | |
| v2 | +79.3 ± 25.4 | −32.0 ± 20.2 | |
| v2 without the pessimistic scenario | +71.1 ± 26.0 | −40.3 ± 21.0 | −8.3 ± 15.9 |
| v2 with Hero's simulated next-street play bluffing like everyone else's | +79.3 ± 26.0 | −32.0 ± 19.7 | 0.0 ± 14.0 |
| v2 with both | +71.2 ± 26.9 | −40.1 ± 21.3 | −8.1 ± 16.5 |
| v2, opponent statistics off | +71.7 ± 25.5 | −39.6 ± 22.8 | −7.6 ± 18.5 |
| v1, opponent statistics off | +98.7 ± 28.9 | −12.6 ± 15.2 | |

Removing the pessimistic scenario or the no-bluff rollout does not recover any of the gap. So the passivity is not produced by those two guard rails. It comes from the core of v2: the range-relative response model, the second street in the look-ahead, or how plans are valued. These have not yet been separated (see section 9, item 1).

The same ablation six-handed against the independent field (three equity-threshold players, a calling station, a random player), 3,600 hands, seed 4200:

| Postflop variant | bb/100 | Paired vs v1 postflop | Paired vs v2 postflop |
|---|---|---|---|
| v1 | +481.3 ± 115.2 | | |
| v2 | +488.1 ± 101.5 | +6.8 ± 67.1 | |
| v2 without the pessimistic scenario | +494.8 ± 102.7 | +13.5 ± 70.7 | +6.7 ± 17.9 |
| v2 with Hero's simulated next-street play bluffing | +479.6 ± 100.6 | −1.7 ± 68.7 | −8.6 ± 17.6 |
| v2 with both | +493.7 ± 102.5 | +12.4 ± 69.7 | +5.6 ± 24.1 |
| v2, opponent statistics off | +327.9 ± 90.6 | −153.4 ± 82.8 | **−160.3 ± 62.4** |
| v1, opponent statistics off | +402.2 ± 108.1 | **−79.1 ± 55.7** | |

Here the two engines are indistinguishable with statistics on, and again neither guard rail matters. What does matter is opponent statistics: switching them off costs v2 about 160 bb/100 and v1 about 80. v2 leans on learned tendencies about twice as hard as v1 at this table, which is the same pattern as the benchmark's "wrong opponent assumptions" row (v2 behind by 82.9 ± 64.8 with statistics off). Until a player has been seen for a few dozen hands, v2's default assumptions about a calling station or a random player are worse than v1's.

### 2.4 How much of this is the simulator

Three kinds of evidence, none conclusive alone:

- **Where the deficit is and is not.** Every significant deficit is at a table containing opponents from v1's own model family (the "archetype" players act by the exact functions v1 uses to predict opponents, and the v1 bot is one of them), or with statistics switched off against opponents neither model fits. Against the range-aware opponent (v2's family) and the equity-threshold opponent (neither family) heads-up, there is no significant difference (+13.1 ± 15.4 and −4.2 ± 11.9). Six-handed against independent opponents there is none either (−31.8 ± 39.9 in the benchmark, −4.2 ± 56.4 here), though those intervals are wide enough to hide a real loss.
- **How well v2 predicts the simulated opponents** (`npm run bot:response-calibration`, 3,000 hands per table, v2 in the measured seat; "predicted / happened"):

| Table | Flop bet: all fold | Flop bet: raised | Flop check: bet behind | Turn check: bet behind |
|---|---|---|---|---|
| Heads-up vs tight-aggressive | 31% / 33% | 11% / 11% | 54% / 62% | 39% / 55% |
| Heads-up vs range-equity | 36% / 58% | 11% / 7% | 53% / 36% | 43% / 19% |
| Heads-up vs range-aware | 47% / 48% | 8% / 9% | 42% / 43% | 33% / 42% |
| Six-handed independent | 17% / 0% | 11% / 10% | 51% / 26% | 39% / 11% |
| Six-handed mixed | 33% / 25% | 12% / 10% | 56% / 53% | 46% / 42% |

  Against the tight-aggressive program v2 predicts folds correctly on average and still bets 18 points less often than v1 and wins less. So its loss there is not a wrong fold estimate. It under-predicts how often that opponent bets when checked to (flop 54% against 62%, turn 39% against 55%), which makes checking look better than it is. Against the independent six-handed field it is badly wrong in both directions: with a calling station in most pots nobody ever folds out the whole field (predicted 17%, happened 0%) and opponents bet behind half as often as predicted.
- **What the simulated opponents cannot do.** None of them punishes over-aggression: the archetypes raise about one bet in ten whatever Hero does, and none adjusts to a player who bets 88% of flops. A strategy that bets too much is not penalised here the way a thinking opponent would penalise it.

Classification:

| Finding | Kind |
|---|---|
| Standard errors taken from the wrong scenario (section 3) | Implementation defect. Fixed. |
| Pessimistic scenario is one-sided while the code comment said two-sided | Documentation defect and a modelling limitation. Comment corrected; behaviour unchanged. |
| The opponent bets the turn 64% after its own flop bet but takes the pot only 24% of the time after calling a lead (section 6) | Modelling assumption with no evidence behind it. Not changed. |
| v2 bets less and folds more than v1 | Strategy difference. Costly against these simulated opponents. Whether it is wrong against real players is unknown: there is no reference and no real-hand measurement. |
| v1 gains from predicting its own model family exactly | Simulator-specific. Real opponents are not drawn from v1's model. |
| With statistics off v2 loses about 160 bb/100 six-handed against stations and random players, v1 about 80 | Modelling weakness of v2's defaults (it expects folds and bets behind that never come: predicted 17% / happened 0%, 51% / 26%). Real, but measured only against extreme simulated opponents. |

What cannot be concluded: that v1 is the better engine against people. v1 still has the nine defects in `STRATEGY_AUDIT.md`, each with a test, and its aggression is unpunished in this simulator. What can be concluded: v2 has no measured advantage, and the claim that fixing those defects makes the bot win more is unsupported.

## 3. Mathematical defects confirmed

### 3.1 Uncertainty computed from a different scenario than the value (fixed)

`PostflopSolver.result()` scored a bet or raise by the lower of two means: the per-deal values under the modelled responses, and the per-deal values against opponents who fold less. The variance and covariance, however, were always taken from the first series. Wherever the pessimistic series was the lower one (most bluffs and thin bets), three things were inconsistent with the reported EV:

- the standard error of that EV,
- the standard error of the gap to the runner-up, which sets the mixing weights between close actions,
- the `separated` flag, which tells the live decision loop it may stop sampling.

Size of the error in the test spot (river, nine high, heads-up, 3,000 deals): reported 1.332 chips, correct 1.292 for one bet; gap error 0.890 reported, 0.928 correct. A few percent, in either direction. It could shift mixing frequencies in close spots and stop sampling slightly early or late. It could not change which action had the highest EV.

Correction: per-deal values are now kept for both scenarios (2 × columns), with sums and cross-products over all of them. Each candidate records which series its value came from, and every variance and covariance is read from that series.

### 3.2 Sampling error and model sensitivity were not distinguished (fixed)

A standard error says how much the number would move with more deals. It says nothing about how much it would move if opponents responded differently, which is the larger uncertainty. Now reported separately:

- each bet or raise carries `evModel` and `evPessimistic` next to `ev`;
- `bestModel` is the action that would be best under the modelled responses alone;
- the explanation gains a line "opponent-model sensitivity: this bet is worth +X chips if opponents respond as modelled and +Y if they fold less often", and, when the two scenarios disagree about the best action, a "model-dependent" line naming the other action.

No sample counts were changed.

### 3.3 Looked at and not a defect

- **Raises in multiway pots.** A recorded five-way hand showed a 33% chance that a small bet is raised. That is four opponents each raising about one time in ten, independently, which is what the model states. In simulation the predicted and observed raise rates agree (11% / 10% six-handed).
- **Common random numbers, plan selection, side pots, checking never below folding:** re-read; consistent.

## 4. Reproduction tests and corrections

| Test file | What it pins down | Before the fix |
|---|---|---|
| `tests/bot/postflop-uncertainty.test.ts` (3 tests) | On the river, a solver whose opponents are the pessimistic opponents produces, deal for deal, the pessimistic series of the ordinary solver. Wherever the ordinary solver reports the pessimistic EV it must report the same standard error, gap, gap error and mixing weights. Both scenario values are exposed and match solvers run with each scenario alone. | All 3 failed (1.3322 against 1.2920; 0.8904 against 0.9277; fields missing) |
| `tests/bot/engine-selection.test.ts` (4 tests) | The benchmark-only per-street engine selection gives exactly v1's decision on v1 streets and v2's on v2 streets, and the defaults are unchanged. | New capability |

Source changes: `src/bot/strategy/postflop.ts` (both scenarios accumulated; `evModel`, `evPessimistic`, `bestModel`; corrected comments), `src/bot/strategy/types.ts` (two optional fields on a candidate), `src/bot/agent.ts` (two explanation lines; `preflopEngine` / `postflopEngine` options used only by the benchmark tools). Nothing in tracking, button reading, legal-action checks, the dashboard, diagnostics, permissions or safety checks was touched. v1 is untouched.

Effect on play: EVs and the best action are unchanged by construction. Mixing frequencies in close spots can differ slightly.

Measured effect of the fix on results: the benchmark row "Heads-up vs tight-aggressive" (10,000 hands, same seeds) re-run on the fixed source gives v1 +95.681 (unchanged, v1 is untouched) and v2 +66.009 against +69.783 before. A change of −3.8 bb/100 against an interval of about ±21 on that figure: the fix neither helps nor hurts measurably, as expected for a correction to error estimates.

## 5. Factorial preflop / postflop results

Tool: `npm run bot:strategy-diag -- --exp factorial --table <name> --hands N --seed S [--deviating]`. Four runs per table, labelled preflop/postflop. Main effect of a factor: the average of its two paired differences. Interaction: (v2/v2 − v2/v1) − (v1/v2 − v1/v1). An asterisk marks an interval that excludes zero.

| Table | Hands, seed | v1/v1 | v1/v2 | v2/v1 | v2/v2 |
|---|---|---|---|---|---|
| Heads-up vs tight-aggressive | 6,000, 4100 | +111.3 ± 28.1 | +79.3 ± 25.4 | +111.3 ± 28.1 | +79.3 ± 25.4 |
| Six-handed independent (three equity-threshold, a calling station, a random player) | 4,800, 4200 | +443.5 ± 98.4 | +449.2 ± 87.4 | +441.8 ± 98.8 | +439.4 ± 86.2 |
| Six-handed mixed (two range-aware, tight-aggressive, equity-threshold, loose-passive) | 4,800, 4400 | +129.0 ± 38.5 | +99.1 ± 34.3 | +115.5 ± 37.8 | +100.5 ± 34.4 |
| Six-handed mixed, Hero makes loose preflop calls | 4,800, 4500 | +138.2 ± 59.4 | +131.9 ± 51.5 | +144.7 ± 57.7 | +131.8 ± 50.0 |

| Table | v2/v2 − v1/v1 | Postflop alone | Preflop alone | Postflop main effect | Preflop main effect | Interaction |
|---|---|---|---|---|---|---|
| Heads-up vs tight-aggressive | −32.0 ± 20.2 * | −32.0 ± 20.2 * | 0.0 (same code) | −32.0 ± 20.2 * | 0.0 | 0.0 |
| Six-handed independent | −4.2 ± 56.4 | +5.7 ± 54.5 | −1.7 ± 22.7 | +1.6 ± 53.8 | −5.8 ± 18.9 | −8.1 ± 16.0 |
| Six-handed mixed | −28.5 ± 27.2 * | −29.9 ± 26.2 * | −13.5 ± 13.8 | −22.5 ± 25.4 | −6.0 ± 9.3 | +14.9 ± 16.7 |
| Six-handed mixed, loose calls | −6.4 ± 43.4 | −6.3 ± 40.8 | +6.5 ± 14.9 | −9.6 ± 40.2 | +3.2 ± 13.7 | −6.5 ± 19.8 |

Direct match, three seats of a variant against three v1/v1 seats, 4,800 hands, seed 4300 (`--exp direct`):

| Variant in three seats | bb/100 per seat against v1/v1 |
|---|---|
| v1 preflop, v2 postflop | −2.2 ± 12.9 |
| v2 preflop, v1 postflop | −1.6 ± 8.3 |
| v2 preflop, v2 postflop | −1.0 ± 12.2 |

Reading:

- **Postflop explains the significant differences.** In both tables with a significant total, the postflop change alone is significant and about the same size as the total.
- **Preflop: no significant effect anywhere.** The point estimates are small and of mixed sign (−13.5 ± 13.8 at the mixed table is the closest to significance). The preflop change is mostly labelling and chart-based opponent ranges; Hero's preflop action frequencies are nearly identical (for example 79.0% against 79.1% folds facing action six-handed), except that the big blind raises over limpers more often with the chart (about 21% against 14%).
- **No significant interaction.**
- **Not reproduced at this sample size:** the direct match (benchmark: −9.1 ± 7.6 over 12,000 hands; here −1.0 ± 12.2 over 4,800, an interval that contains both zero and −9.1), and the off-strategy deficit (benchmark: −29.6 ± 25.0; here −6.4 ± 43.4). These runs neither confirm nor contradict the benchmark; they are too small to. They do show that neither effect is large enough to stand out at 4,800 hands.
- **Six-handed against independent opponents:** no difference detectable, with intervals of about ±55. Win rates there are dominated by a calling station and a random player, so variance is very high.

## 6. The weak out-of-position lead

Scenario `oop-caller-bottom-pair-dry`: big blind calls a button open, flop K-9-5 rainbow, Hero holds 5-4 and is first to act; pot 5.5bb. Tool: `npm run bot:lead-sensitivity` (6,000 deals per valuation; it only reads the engine).

### 6.1 What the model has the button do

| Hero's action | Button folds | calls | raises |
|---|---|---|---|
| Leads 33% of the pot | 28% | 60% | 12% |
| Leads 66% | 36% | 51% | 12% |
| Leads the pot | 44% | 44% | 12% |
| Checks | bets half the pot 60%, checks back 40% | | |

Hero's raw showdown equity: 49% against the whole range, 36% against the hands that bet when checked to, 68% against those that check back, 44% against those that call a small lead, 23% against those that raise it.

### 6.2 Value of each line (big blinds, relative to folding)

| Line | Value |
|---|---|
| Check, fold to a bet | +1.37 |
| Check, call a bet | +0.94 (+1.01 if Hero gives up to any turn bet) |
| Lead 33%, modelled responses | +2.28 |
| Lead 33%, opponent folds less (the figure used) | +2.07 |
| Lead 66% / pot / 1.5 × pot (figure used) | +1.73 / +1.33 / +0.63 |

The lead is 28% × the pot (+1.53) − 12% × the bet (−0.22) + 60% × the value of being called (+1.60 each).

### 6.3 It is not fold equity

Holding the other two terms fixed, the lead beats the check as long as the button folds more than **4%** of the time. Across the whole range of opponent tendencies the engine can represent (fold frequency 10% to 53%, bet-when-checked-to 49% to 73%), the engine leads in all fifteen combinations tried. Doubling the strength of the pessimistic scenario does not change the choice either.

The lead wins because being called is itself valued at +1.6bb, more than the entire check line.

### 6.4 Why being called is worth more than checking

The simulated turn after each flop line (share of deals, and the average value of the line in those deals):

| Flop line | Pot on the turn | Value | Opponent bets the turn, Hero folds | Hero bets, opponent folds | A turn bet is called | Checked through |
|---|---|---|---|---|---|---|
| Flop checked through | 5.5bb | +3.43 | 7% | 10% | 21% | 62% |
| Hero check-calls a half-pot bet | 11.0bb | −0.89 | 16% at −2.75 | 1% | 48% at −3.15 | 35% at +2.84 |
| Hero leads small and is called | 9.1bb | +1.69 | 24% at −1.80 | 8% | 12% | 57% at +2.30 |

With no further betting, calling the half-pot bet would be worth +1.18bb and a called lead +2.16bb. The simulated turn then costs the check-call line about 2.1bb and the lead line about 0.4bb. The reason is in the columns: after betting the flop itself, the modelled opponent bets the turn in about **64%** of deals; after merely calling Hero's lead, it bets the turn and takes the pot in **24%**.

Two modelling choices produce that asymmetry:

1. **Strength is re-read inside the range that continued.** A hand that called the lead is re-expressed relative to the calling range, which pushes most of it below the value-bet threshold. A hand that bet the flop is not re-expressed at all, so every strong hand in the betting range bets again.
2. **The betting lead moves with the last bet.** After Hero's lead, Hero holds the lead on the turn and the opponent is modelled as a player without it.

Together they say: a one-third-pot lead from the big blind makes the button passive for the rest of the hand. The lead stops beating a check once the opponent takes the pot on the turn in more than about **59%** of the deals in which it called, which is roughly what the same model has it do after its own flop bet.

There is a second contributor on the other side: the check line is poor because the only bet size opponents have is half the pot, Hero cannot check-raise, and the call is valued against a 64% turn barrel.

### 6.5 Realistic, optimistic, or a bug

- **Implementation defect: no.** The code does what its design says; the arithmetic of each line was reconstructed from its parts and matches.
- **Realistic continuation ranges: partly.** The calling range itself (44% equity for bottom pair against it) is unremarkable.
- **Optimistic assumption about later streets: yes.** That a button who called a small lead then bets the turn less than half as often as one who bet the flop is an assumption with no data behind it, and the whole preference for the lead rests on it. This is a milder form of defect D1 in the original audit (a bet as a cheap ticket to showdown).

No correction was made. Changing the turn behaviour would be a strategic change, and there is no evidence yet for the right number. A solver solution of this spot would not give it either (it would give the equilibrium answer for the lead, not how often real opponents bet the turn). The measurement that settles it is a frequency in real hands: how often the in-position player bets the turn after calling a lead and being checked to, against how often it bets the turn after its own continuation bet is called. See the data roadmap.

Solver reference: none was available. The repository's adapter for the open-source `postflop-solver` has no compiled solver on this machine (no Rust toolchain), and no licensed solver output has been supplied. The exact spot to solve, when one is available: BB calling range against BTN opening range at 100bb, flop Kh 9d 5s, pot 5.5bb, effective stack 97.5bb, bet sizes 33%, 66% and 100% for both players with raises.

## 7. Parameters of the opponent model, classified

"Observed" would mean measured on real hands; "solver-derived" taken from solver output. **Nothing in the opponent model is either.** The priors were chosen as round figures; the tests check that the model reproduces those figures, which is consistency, not calibration against players.

| Parameter (file) | Value | Class |
|---|---|---|
| Fold threshold by bet size: 0.22 + 0.32√(bet/pot); +0.06 on the river; +0.10 facing a raise; +0.03 per extra opponent (`range-model.ts`) | third pot 0.40, half 0.45, pot 0.54 | heuristic |
| Value-bet share of a range, without / with the lead, by street | 0.28 / 0.34 flop, 0.27 / 0.30 turn and river | heuristic |
| Bluff share of the rest, without / with the lead | 0.17 / 0.32 flop, 0.15 / 0.21 turn, 0.11 / 0.14 river | heuristic |
| Check-back by the preflop raiser on the flop | 1 − bet frequency, about 40 to 45% between equal ranges | follows from the two rows above |
| Share of bets actually led into the previous aggressor | 0.30 | heuristic |
| Value raise: top 10% of strength, 70% of the time; bluff raise 4% (2% on the river) | about 10 to 12% of a range | heuristic |
| Extra opponents: bluff share ÷ (1 + 0.6 per extra), thresholds +0.03 to +0.04 each | | heuristic |
| Strength weights: 35% own range, 35% opponents' ranges, 30% absolute | | heuristic |
| Slow-play floor when narrowing on a check; action floor | 0.20; 0.02 | heuristic |
| Re-reading a caller's strength inside the continuing range | on for callers, off for bettors and raisers | heuristic (see 6.4) |
| Hero's simulated next-street play: bets for value, bluff rate × 0.2 | | heuristic; ablated in 2.3, no measurable effect |
| Opponent bet size in the simulation | half the pot, one size | heuristic |
| A raise behind a call | not modelled; when Hero is raised, other callers are assumed to give up and their chips stay in | heuristic simplification, slightly favourable to continuing |
| Pessimistic scenario | opponents fold about 10 points less; one-sided | heuristic; ablated in 2.3, not the cause of the deficit |
| Realization factor for the river when deciding on the flop | 0.85 to 0.98 | heuristic |
| Population priors (continuation bet 55% / 45%, fold to a bet 45%, ...) | `opponents/profile.ts` | heuristic round figures |
| Per-opponent adjustment | four knobs from measured vpip, pfr, aggression frequency and fold-to-bet, shrunk by n / (n + 20) | observed for that opponent, applied through heuristic formulas |
| Equity, pot odds, side pots, EV arithmetic | | calculated |

Effect of opponent profiles on play: in simulation, switching statistics off costs v1 12.6 ± 15.2 and v2 7.6 ± 18.5 bb/100 heads-up against the tight-aggressive program (neither significant at 6,000 hands), and 79.1 ± 55.7 for v1 and 160.3 ± 62.4 for v2 six-handed against the independent field (both significant, paired). They matter most against extreme opponents, and more for v2 than for v1. In the recorded live hands no decision carried a learned adjustment: sessions were too short for the shrinkage to let any through, and bundles do not store profiles.

## 8. Existing solver and learning assets in the repository

| Asset | What it is | Provenance and validation on record | Use for the bot |
|---|---|---|---|
| `blueprint/` (C++), `blueprint/web/policy.gpobp.gz`, `src/core/blueprint/` | Heads-up no-limit blueprint by external-sampling MCCFR, 12.7 billion iterations, 100bb, small tree (bets of half pot and pot, all-in), 169/200/200/200 buckets | Trained by the original author, 2026-10-09. Kuhn and Leduc gates pass. Pre-registered matches: blueprint plus search beat the original engine by +22.0 ± 13.6 bb/100 heads-up; local best response found it exploitable by 14 to 34 mbb/hand at 100M iterations and 50 buckets (the shipped policy is larger; no figure on record for it). | **Worth using, for heads-up only**: as a strong, independent benchmark opponent in place of the archetypes, and as a rough reference for heads-up decisions. Not a multiway reference. Its abstraction (two bet sizes, 200 buckets) limits it as ground truth. |
| `src/core/solver/postflop-cfr.ts`, `subgame.ts` | Range-against-range discounted CFR for the current street, heads-up, with measured exploitability | In-repository TypeScript; documented in `docs/POSTFLOP_CFR.md`. Exact showdown leaves on the river; the turn enumerates rivers; on the flop it assumes the hand checks down. | **Worth using on the river (and turn)**: an exact equilibrium for given ranges, pot and sizes. It can give river reference frequencies and regrets for the scenario suite at no cost. Not a flop reference: its flop leaf has the same flaw as v1. |
| `src/core/solver/postflop-solver.ts`, `vendor/postflop-solver/` | Adapter for the open-source `postflop-solver` (AGPL) compiled to WebAssembly | The adapter exists; the compiled solver does not (placeholder folder; Rust is not installed). | **Worth building**: it would give real heads-up flop solutions, including the spot in section 6. Needs the Rust toolchain and your decision on the AGPL terms (local use only is unproblematic). |
| `solver/solve.mjs` | Wrapper for the TexasSolver console program | Needs a downloaded binary; none present. | Alternative to the row above. |
| `src/core/ml/` and `ml/` | Small network trained on PokerBench postflop rows: five action classes and a size bucket | 84.5% agreement on PokerBench's test rows. Used by the original `DecisionEngine`, not by `BotAgent`. | **Not as a decision maker.** Heads-up postflop only; inputs carry no ranges, stacks or opponent count; trained on filtered, class-balanced rows. Possible second opinion after validation; see the data roadmap, section 2. |
| `src/solver/preflop/`, `src/core/ranges/headsup-solved.ts` | CFR+ heads-up preflop solve with all-in-equity leaves | The repository itself records that a third of its cells never converged and replaced it with hand-written ranges. | Not usable as a reference. Exact only for push/fold. |
| `src/core/ranges/greenline-gto.ts`, `pekarstas-gto.ts` | Six-max chart transcriptions | Origin and licence unverified; one chart carries a "testing" comment. | In use, labelled "source not verified". Need checking against their sources. |
| `sim/` (original harness), `sim/results/2026-10-09/` | Match runner, pre-registration and results for the blueprint work | Careful and reproducible. | The pre-registration format is worth copying for Phase 2.2. |

## 9. Strategy data still required

1. A reference for postflop decisions. Heads-up: buildable locally (rows 2 and 3 above) or PokerBench. Multiway: nothing available; needs a multiway-capable solver you are licensed for.
2. Measured opponent frequencies from real hands, above all your own PokerNow logs: fold, call and raise by street and size; bet when checked to with and without the lead; turn bets after a called lead against after a called continuation bet.
3. Preflop ranges for 7 to 10 handed tables, limped pots, squeezes and cold calls, and for stack depths other than 100bb. Two thirds of the recorded preflop decisions used percentile rules.
4. Verification of the two chart sets against their sources.

See [POKER_DATA_TRAINING_ROADMAP.md](POKER_DATA_TRAINING_ROADMAP.md) for sources and a plan.

## 10. The next five changes, ranked by measurable expected value

Ranked by how much each reduces the uncertainty that currently blocks every strategy decision, then by measured chips at stake. None is a claim that the change will raise the win rate.

1. **An exact evaluator for the simulator.** The simulated opponents' policies are known, so the true EV of each candidate action at a decision point can be computed by rolling the real policies forward. That turns "v2 bets less and wins less" into "at these decision types v2's chosen action loses X against the truth", separates the range model from the look-ahead and the plan logic, and makes every later change testable in minutes instead of hours. At stake: the 25 to 32 bb/100 heads-up deficit and the 28 bb/100 at the mixed table.
2. **Independent opponents for the benchmark.** Add the heads-up blueprint as an opponent, and a best-responding opponent that punishes over-betting. Until then v1's aggression is rewarded by construction and no result here transfers. At stake: the validity of every number above.
3. **River reference from the in-repository solver.** For the heads-up river scenarios, compare each engine's action frequencies and regret with the exact equilibrium for the same ranges. The river is where v2 differs most from v1 (bets 36 to 48% against 70 to 77%) and where an exact answer is free.
4. **Measured turn behaviour and response frequencies from real hands**, then a candidate parameter set gated by held-out fit and paired simulation (data roadmap, steps 4 to 6). This is what decides the weak-lead question and the two frequencies in 6.4, and it replaces the default assumptions that cost v2 most when it has no statistics on an opponent (160 bb/100 six-handed in section 2.3).
5. **A decision margin for model error.** When the gap between the two best actions is smaller than the difference between the two response scenarios, present the decision as close and prefer the action whose value depends less on the model. The quantities now exist (`evModel`, `evPessimistic`, `bestModel`); the rule itself is a strategic change and waits for items 1 to 3 to measure it.

Until item 1 or 2 changes the picture, the honest position is: v1 and v2 are both available, v2 is the default in the extension and is the more conservative of the two, and neither has evidence of being better against real players. Whether to switch the default back to v1 is your call; the benchmark favours v1 against programs, the audit's defects favour v2 on principle.

## 11. How to reproduce

```
npx tsx sim/bot/strategy-diag.ts --exp repro                                        # section 1.1 (about 6 minutes)
npm run bot:strategy-diag -- --exp factorial --table hu-tag    --hands 6000 --seed 4100
npm run bot:strategy-diag -- --exp ablate    --table hu-tag    --hands 6000 --seed 4100
npm run bot:strategy-diag -- --exp factorial --table six-indep --hands 4800 --seed 4200
npm run bot:strategy-diag -- --exp direct                      --hands 4800 --seed 4300
npm run bot:strategy-diag -- --exp factorial --table six-mixed --hands 4800 --seed 4400
npm run bot:strategy-diag -- --exp factorial --table six-mixed --hands 4800 --seed 4500 --deviating
npm run bot:strategy-diag -- --exp ablate    --table six-indep --hands 3600 --seed 4200
npm run bot:response-calibration -- --hands 3000 --seed 5100
npm run bot:lead-sensitivity
```

Run one at a time. All experiments in sections 2, 5 and 6 were run on the source with the section 3 fix applied; the repro in 1.1 was run on a clean checkout of commit `921447a`. The raw output of the `strategy-diag` and `lead-sensitivity` runs is in `reports/strategy-diag-2026-11-16.txt`. The calibration tables in 2.4 were copied from the tool's output and not saved separately; the command above regenerates them.
