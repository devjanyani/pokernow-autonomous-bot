# v4 baseline and gaps (Phase 3.0)

Commit audited: `bf8bf21` (v0.9.1). Date: 2026-11-21. Audit only: no strategy, model, setting or default changed.
Labels: **[F]** repository fact, **[M]** measured here, **[R]** earlier committed report, **[H]** hypothesis,
**[P]** proposal, **[E]** missing evidence.

Design documents: [docs/bot/V4_PREFLOP_ARCHITECTURE_AUDIT.md](../docs/bot/V4_PREFLOP_ARCHITECTURE_AUDIT.md),
[docs/bot/V4_HERO_IMAGE_AND_EXPLOITATION.md](../docs/bot/V4_HERO_IMAGE_AND_EXPLOITATION.md),
[docs/bot/V4_IMPLEMENTATION_ROADMAP.md](../docs/bot/V4_IMPLEMENTATION_ROADMAP.md).

## 1. Measurements made in this phase

All three are produced by `sim/bot/v4-baseline.ts`. It is a new measurement script that imports the engine and
changes nothing; `src/` never imports it. Each run was a single process, one at a time.

| Run | Command | Wall time | Output |
|---|---|---|---|
| Preflop coverage, 2–10 players × 6 depths × 8 scenario families | `npx tsx sim/bot/v4-baseline.ts coverage` | 8 s | [v4-preflop-coverage-2026-11-21.md](v4-preflop-coverage-2026-11-21.md) |
| Range widths, all 169 classes per spot | `npx tsx sim/bot/v4-baseline.ts widths` | 35 s | [v4-preflop-widths-2026-11-21.md](v4-preflop-widths-2026-11-21.md) |
| Hero image, v2, 6 / 9 / 2 players, 3,000 hands each, seeds 31000–31002 | `npx tsx sim/bot/v4-baseline.ts hero --hands 3000` | 3 min | [v4-hero-baseline-2026-11-21.md](v4-hero-baseline-2026-11-21.md) |
| Hero image, v3, heads-up, 3,000 hands, seed 31002 | `npx tsx sim/bot/v4-baseline.ts hero --v3 --hu-only --hands 3000` | 2.5 min | same file |

Seeds 31000–31002 are audit seeds. They must not be used as held-out seeds for v4. The session bb/100 figures printed
by the hero runs are single unpaired sessions against fixed programs, **not strength measurements**.

No expensive retraining or large benchmark was run. Existing benchmark evidence is quoted, not repeated.

## 2. Baseline evidence already on record [R]

| Comparison | Result | Source |
|---|---|---|
| v2 vs v1 | v2 never shown better and significantly worse in several simulated settings. The deficit is postflop: **v2 bets much less often and folds more to flop bets** (independent earlier evidence for weaknesses 6 and 7 below) | `docs/bot/STRATEGY_V2_DIAGNOSIS.md` |
| v3 − v2, heads-up pooled, fresh seeds 12700 / 12900 | −1.8 ± 10.1, −0.6 ± 10.9 bb/100 | `reports/PHASE_2_4_BENCHMARK.md` |
| v3pr (population-calibrated) − v2, final held-out seed 13300 | +1.1 ± 11.4 bb/100 (level) | `reports/PHASE_2_5_STRATEGY_BENCHMARK.md` |
| v3 with the river tilt alone − v2, seed 13300 | −5.6 ± 3.7 bb/100 (worse) | same |
| bot vs the original engine (with the trained heads-up blueprint), heads-up | −10.6 ± 27.6 bb/100 (not significant) | `reports/bench-2026-11-13.md` |
| v2's river bettor ranges vs real bettors (HandHQ, 627 test hands) | bettor ahead of a 0.5-percentile catcher 87.2% (v2) vs 79.7% ± 3.1 (real) | `docs/bot/PHASE_2_5_OPPONENT_LEARNING.md` §4 |

**No engine in this repository has been shown to be stronger than v2.** v2 remains the baseline, and v3 the second
baseline.

## 3. Preflop coverage [M]

| Players dealt in | 100bb spots: exact chart / chart outside its assumptions / heuristic / computed | Heuristic share at 100bb |
|---|---|---|
| 2 | 4 / 0 / 1 / 1 | 17% |
| 6 | 43 / 0 / 10 / 5 | 17% |
| 8 | 0 / 53 / 36 / 7 | 38% |
| 9 | 0 / 58 / 52 / 8 | **44%** |
| 10 | 0 / 63 / 70 / 9 | **49%** |

- **Widths at 25bb are identical to 100bb** at every seat (first-in table in the widths report). Stack depth changes
  only the branch at ≤12bb (push/fold), at ≤16bb facing a raise, or for a call of ≥40% of the stack.
- **Nine-handed early seats** open from the heuristic table (UTG 11%, UTG+1 13%, MP 15%). Facing their opens, every
  later seat uses the 6-max UTG chart, while the opponent model gives the opener the heuristic 11% range.
- **Chart precedence.** Greenline (registered first) gives BTN vs CO 26.2% 3-bet / 0% call and SB vs BTN 29.4% 3-bet.
  Greenline's own comments call some of these cells exploitative. Pekarstas, which loses, gives BTN vs CO 14.8% with
  flats.
- **No data at all** for squeezes, cold 4-bets, facing a squeeze, limping, multiway, CO vs an MP open, or 4-bets after
  3-betting MP. Those spots are all heuristic.

## 4. Hero image [M]

| | 6 players | 9 players | heads-up (v2) | heads-up (v3) |
|---|---|---|---|---|
| VPIP / PFR / 3-bet | 27 / 24 / 15 | 17 / 14 / 12 | 66 / 46 / 10 | same preflop |
| Style label | TAG 100% | TAG 100% | LAG 100% | LAG 100% |
| River bluff share of bets and raises | 15% (13/85) | 5% (3/59) | 23% (20/86) | 41% (60/148) |
| Weak river hand, checked to / first: bets | 11% | 7% | 22% | 56% |
| Marginal river hand facing a bet: folds | 90% (9/10) | 83% (15/18) | 72% | 76% |
| Fold vs a flop bet | 71% | 71% | 66% | 48% |
| Check-raise | 3% | 3% | 4% | 24% |

**Answer: Hero is classified TAG; it is not demonstrably too tight.**

- Preflop is chart-driven and, at 6-max, aggressive (15% 3-bet). The TAG label comes from `classify()`'s fixed
  thresholds (VPIP > 30% = loose), which do not depend on table size.
- What the numbers do show is a v2 postflop that rarely bluffs the river and folds marginal hands to river bets. Three
  code-level causes in v2 are identified (pessimistic scoring of all bets, Hero's future bluffs ×0.2, bettor ranges
  too strong). Whether correcting them wins chips is **not measured**.
- v3 shows the opposite tendencies (24% check-raise, 41% river bluffs), consistent with its documented fold-probability
  calibration problems.

## 5. The ten most consequential weaknesses (ranked)

Ranked by how many decisions they touch × how directly they bias EV. Evidence labels in brackets.

1. **Seven-to-ten-handed preflop has no data for early seats, and the two halves of the model disagree** [F, M].
   44–49% of 9–10-handed spots are heuristic. Hero defends against early opens with the 6-max UTG chart (15.5%) while
   modelling the opener at 11%.
2. **No stack-depth adaptation between 13bb and 60bb, nor above 150bb** [F, M]. Identical widths at 25bb and 100bb.
   PokerNow cash tables are often 50–200bb deep with variable buy-ins [H].
3. **The raise size faced is ignored, and Hero's sizes are fixed** [F]. `SpotQuery` has no size, `PreflopSpot.sizing`
   is never read, opens are 2.5bb while Greenline's UTG chart assumes 3bb.
4. **Unverified, partly exploitative chart data wins by registration order** [F, M]. Greenline's 3-bet-or-fold cells
   override Pekarstas. Neither licence nor solver origin is verified. Squeeze, cold-4-bet, limp and multiway packs do
   not exist.
5. **Preflop computes no EV except for all-in calls** [F]. No fold equity, realization, SPR, rake or response model.
   One preflop exploit (`overfold-3bet`).
6. **v2 postflop is structurally biased against fold-equity bets** [F, M]. Pessimistic min-scoring of every bet
   (`ROBUST_STICKINESS`), Hero rollout bluffs ×0.2, check-raise impossible as a plan. River bluff share 5–15%.
7. **v2 over-folds to bets because modelled bettor ranges are too strong** [R, M]. 87% vs 80% real ahead-rate on the
   river; marginal hands fold 83–90% to river bets in simulation. The selection-biased raw `foldVsBet*` stickiness
   may add to this [H].
8. **v3's aggression rests on hand-set fold-to-raise behaviour** [R, M]. 24% check-raise and 41% river bluffs here;
   known all-in-bluff and condensed-river defects. It is level with v2, not better.
9. **The opponent model uses 4 tendencies out of 41 counters, with no position or size conditioning** [F]. Double
   shrinkage; exploit notes at d ≥ 10–20 with no multiple-comparison control. Postflop response statistics need
   1,000–6,600 hands for ±10 points, beyond a typical session [M].
10. **Multiway postflop is v2's one-street simulation with fixed rollout sizes; v3 is heads-up only** [F]. Mixing is
    limited to near-ties, so play is close to deterministic per hand and state.

Lower priority, listed for completeness:

- no rake model (PokerNow play money is usually unraked [H]);
- no limp or complete strategy;
- 7-8-handed label names differ from common usage (cosmetic);
- missed-blind posting unverified [E];
- the equity-only hand ordering used by every heuristic band [H].

## 6. What v2 and v3 already do well [F, R]

- **Correct table mechanics everywhere:**
  - positions for 2–10 players, dead blinds, straddles;
  - side pots;
  - a legality gate on every action;
  - a free-check rule;
  - reproducible seeded sampling.
- **Honest explanations:**
  - every preflop decision names its source and any departure from the data's assumptions;
  - postflop shows sampling error separately from model sensitivity.
- **Ranges conditioned on the whole betting line**, judged inside the player's own range against the others' (v2
  `strengthTable`), with poor-fit detection.
- **v3 values multi-action lines** v2 cannot (check-raise, call-then-raise). Its residual calibration removed the
  Phase 2.4 over-raising feedback loop, and it falls back to v2 with stated reasons.
- **Conservative learning:**
  - shrinkage and minimum samples throughout;
  - the only acting exploit is evidence-gated;
  - population corrections come from real cash data with recorded provenance (Phase 2.5).
- **Mature evaluation tooling:**
  - paired seeded benchmarks;
  - independent opponent programs;
  - per-decision reference evaluation;
  - DCFR river solver references;
  - real-data held-out tests.

## 7. Missing evidence that blocks claims [E]

1. A validated preflop data source for 7–10 players and for 20–60bb and 150bb+ (solver output with a usable licence,
   or a solve the project runs itself).
2. A realization-factor table measured by postflop simulation (by position, SPR, player count, hand class).
3. Per-size, per-position response functions fitted on real hands (the HandHQ pipeline can do this offline).
4. A nine-handed benchmark set with independent opponents. Most existing benchmarks are heads-up or 6-handed.
5. Solver references for turn spots (two streets) to test next-street leaves.
6. Live PokerNow recordings of: missed-blind posts, straddles, and 9-handed early-position play.

## 8. Reproduction

```
npx tsx sim/bot/v4-baseline.ts coverage   > reports/v4-preflop-coverage-2026-11-21.md
npx tsx sim/bot/v4-baseline.ts widths     > reports/v4-preflop-widths-2026-11-21.md
npx tsx sim/bot/v4-baseline.ts hero --hands 3000                    (v2: 6, 9 and 2 players)
npx tsx sim/bot/v4-baseline.ts hero --v3 --hu-only --hands 3000     (v3, heads-up)
```

The hero output is deterministic for a fixed seed on the same commit. Its `bb/100` line is not a strength
measurement.
