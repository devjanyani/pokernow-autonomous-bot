# Phase 3.1: independent evaluation harness, baseline results, and the timing-mode change

Branch `autonomous-bot`, version 0.9.2, 2026-11-21. Development seeds only (32000 + cell index). The final v4 seeds
are pre-registered and unrun: [V4_PREREGISTERED_SEEDS.md](V4_PREREGISTERED_SEEDS.md).

Correctness and play strength are kept apart:
- **Correctness** is in the unit tests: positions, classification, legality and the harness mechanics
  ([PHASE_3_1_PREFLOP_COVERAGE.md](PHASE_3_1_PREFLOP_COVERAGE.md) §1–2).
- **Play** is in this report.

## 1. The harness

`sim/bot/v4-bench.ts`, `--suite main | ablation | negative | smoke`.

**Cells (28).**
- Heads-up against each of four independent programs, at 40 / 100 / 200bb: `nit` (tight), `maniac`
  (loose-aggressive), `pot-odds-caller` (loose-passive), `raiser` (aggressive). Each also at 100bb with resized
  opponent raises.
- Six players: `nit, maniac, pot-odds-caller, mdf-defender, raiser`.
- Nine players: those plus `trapper, adaptive-punisher, nit`.
- Six and nine players each at 40 / 100 / 200bb × two sizing profiles.

The independent programs are in `src/bot/sim/independent.ts`; none is built from the bot's own model.

**Sizing profiles.**
- `std`: each program's own sizes.
- `big`: its preflop raises resized to 4bb (+1 per limper) opens and 4.5x re-raises. This covers several opening and
  3-bet sizes.

**Pairing.** Every engine plays every cell on the same seed: same decks, same opponent seeds, Hero in the same seat.
Differences use per-deal paired values (`pairedDiff`) with 95% intervals. Results are pooled per suite.

**Rake.**
- Charged after the fact: 5%, capped at 3bb, no flop no drop, charged to the winners in proportion to their
  winnings.
- The strategy does not model rake. This is the "where supported" level: rake is supported by the evaluation, not by
  the engine.

**Process measures per engine.**
- Hero's preflop action distribution by classified situation, and the first-in raise rate by position.
- The share of preflop decisions decided by each source, and VPIP.
- Illegal actions (rules engine), legality-gate replacements (`safety:` in the explanation).
- Preflop decision latency (median / p95).

**Negative controls (v2 after the flop).**
- `neg-fold`: folds everything preflop.
- `neg-limp-call`: calls everything, never raises.
- `neg-nit`: plays the top ~3% only.
- `neg-random`: a uniformly random legal preflop action.

**Tests** (`tests/bot/v4-bench.test.ts`, 4):
- the 28 cells;
- bit-identical reruns (hash of the per-deal series);
- rake accounting;
- the fold-everything control's mechanics and direction.

Detection power needs 1,000 deals per cell and is measured by the negative suite below, not in a unit test.

## 2. Reproducibility

| Check | Result |
|---|---|
| Harness rerun, same cell / engine / seed | identical per-deal series (unit test; per-cell hashes in the JSONL files) |
| **Existing v2 and v3 benchmarks** (Phase 2.5 final set, seed 13300): `phase23-bench.ts --engines v2,v3pr --hands 2000 --seed 13300 --tables hu-caller,hu-nit`, compared deal by deal with `reports/phase25-bench-13300.jsonl` | **bit-identical** for all four series (v2 +302.5 / +35.1, v3pr +307.4 / +30.4 bb/100, as published) |
| v2 decisions with no correction option vs with an empty option | identical (unit test) |
| v2 vs v2c at heads-up tables | identical per deal in all 16 heads-up cells: the corrections act only at ring tables (as designed) |

## 3. Main suite: v2 vs v2 with all three corrections (v2c)

[phase31-bench-main.md](phase31-bench-main.md), JSONL [phase31-bench-main.jsonl](phase31-bench-main.jsonl).
28 cells × 1,000 deals × 2 engines, 150 postflop samples per decision, 21.9 min.

| Pooled | v2c − v2 (no rake) | v2c − v2 (5% rake, 3bb cap) | Deals |
|---|---|---|---|
| All 28 cells | −6.9 ± 7.9 | −6.7 ± 7.8 | 28,000 |
| Ring tables (6 and 9 players) | −16.1 ± 18.3 | −15.7 ± 18.1 | 12,000 |
| Six players | −15.3 ± 24.9 | −14.7 ± 24.6 | 6,000 |
| Nine players | −16.8 ± 27.0 | −16.8 ± 26.6 | 6,000 |
| Ring, opponents' own sizes | −16.8 ± 27.8 | −16.6 ± 27.5 | 6,000 |
| Ring, resized opponent raises | −15.3 ± 23.9 | −14.8 ± 23.6 | 6,000 |

- One of the 12 ring cells differs significantly: nine-200-big, −97.8 ± 83.7. At 5% per cell about one false
  positive is expected among 28.
- v2's own results against this pool are large and positive (pooled +200.7 ± 27.6 bb/100). The independent programs
  are weak; the harness measures *differences* between engines.

**Ablation** ([phase31-bench-ablation.md](phase31-bench-ablation.md)): each correction alone, six and nine players at
100bb, both sizing profiles (4 cells × 1,000 deals).

| Correction | − v2 (no rake) | − v2 (rake) |
|---|---|---|
| Documented chart precedence | −21.0 ± 24.5 | −20.5 ± 24.1 |
| Consistent opener range (explicit fallback) | +6.4 ± 17.9 | +6.2 ± 17.6 |
| Chart-stated sizes | +0.4 ± 13.8 | +0.2 ± 13.6 |

**Verdict.** None of the corrections is shown to help, and none is shown to hurt. The point estimates of the
combination, and of the precedence change, are negative. They therefore stay **offline options**, and the production
default is unchanged. This is a test result, not a judgement of which chart is right: these opponents are programs,
and Greenline's opponent-conditional 3-bet-or-fold cells may simply suit them.

## 4. Negative controls

[phase31-bench-negative.md](phase31-bench-negative.md): six cells (hu-nit-100, hu-maniac-100, six-40, six-100,
nine-100, nine-200, opponents' own sizes) × 1,000 deals.

| Control | Pooled − v2 | Detected (95% excludes 0) |
|---|---|---|
| Fold everything | −202.7 ± 55.7 | yes (pooled; 5 of 6 cells individually) |
| Random legal preflop action | −528.6 ± 160.9 | yes |
| Top ~3% only | −137.9 ± 50.1 | yes |
| Call everything, never raise | **+1.8 ± 103.5** | **no** |

**Limitation of the opponent pool.** Against these programs, limp-calling every hand preflop (then playing v2
postflop) is not measurably worse than v2. The programs fold and call against a wide range in ways that do not punish
passive entry. So the pool cannot detect a "too loose and passive preflop" defect. A stronger, punishing opponent
(for example a range-aware 3-bettor or the legacy blueprint engine heads-up) must be added before Phase 3.2's
evaluation relies on it. Three of the four controls are detected.

## 5. Process measures (main suite, pooled)

| | v2 | v2c |
|---|---|---|
| Preflop decisions | 24,848 | 24,830 |
| VPIP | 43.4% | 43.0% |
| Source | HU chart 44.4%, chart outside assumptions 25.2%, heuristic 24.2%, exact chart 5.3%, computed 0.8% | HU chart 44.5%, heuristic 26.0%, chart outside assumptions 23.4%, exact chart 5.3%, computed 0.8% |
| Illegal actions | 0 | 0 |
| Legality-gate replacements | 0 | 0 |
| Preflop latency median / p95 | 1.3 / 2.8 ms | 1.3 / 2.7 ms |
| Facing an open: fold / call / raise | 59.4 / 28.7 / 11.6% | 61.3 / 29.1 / 9.3% |
| Facing a squeeze: raise / all-in | 14.0 / 7.5% | 10.0 / 10.9% |
| First-in raise UTG / HJ / CO / BTN / SB | 14.3 / 16.7 / 29.8 / 65.8 / 48.3% | identical |

The first-in raise rates are identical because the precedence change does not touch the open charts, and the sizes
change only the amount.

## 6. Settings / scheduler change: two timing modes (0.9.2)

This is not a strategy change.

**Settings.** Dashboard → Settings → "Authorised autonomous play: timing" has a **Timing mode** select with exactly
two options.
- **Random** (default): the 0.9.1 scheduler; uniform minimum–maximum per decision (default 4–20 s), configurable,
  with deadline handling, cancellation, deduplication and stale-action protection unchanged.
- **Instant**: no intentional waiting. The action is executed when the recommendation is ready and has passed the
  permission gate, reconciliation and the executor's re-read and legality checks.

**Implementation.**
- `Settings.timingMode` replaces `randomDelay`.
- `scheduler.ts`:
  - `drawDelay` is 0 when instant; `place` makes the action due at once with no minimum conflict;
  - new `replan()` keeps each opportunity's start and deadline and redraws its delay under the new policy.
- `controller.updateSettings` cancels a pending action with the reason ("timing mode changed to instant"), replans
  and decides again. The executor's used-decision-point record still allows at most one click.
- The Live tab's schedule card has a "Timing mode" row, and the execution status line says "timing: Instant" /
  "timing: Random 4.0 s–20.0 s".
- Authorisation requirements, the v3 execution permission, the emergency stop and recommendation-only behaviour are
  unchanged: recommend and manual modes never click in either timing mode.

**Migration** (`records.ts` `timingFields`):
- a stored `timingMode` wins;
- 0.9.1 `randomDelay` on → Random with the stored bounds;
- off with a 0 s minimum → Instant;
- off with a positive minimum → Random with maximum = minimum (the same fixed delay);
- everything else → Random.

**Unit tests** (`tests/bot/scheduler.test.ts`, 7 new, 25 in the file):
- migration and round trip;
- scheduler Instant / Random and `replan`;
- v2 Instant: acted under 600 ms after the turn, 0 intentional wait;
- v3 Instant with its permission: acts heads-up after the flop without waiting; never clicks without the permission;
- recommend and manual never click in either mode;
- Random → Instant while pending: cancelled with the reason, one click under 600 ms;
- changed bounds while pending: the new bounds govern; Instant → Random: the delay is drawn from the range again.

**Chromium** (`sim/bot/e2e-exec.ts`, new phase I; stand-in table, real time; [e2e-exec-2026-11-21.md](e2e-exec-2026-11-21.md)):
- the defaults are Random 4 / 20 s with exactly two modes offered;
- Random: 20 turns at 4.2–19.5 s, 0 timeouts;
- Random → Instant chosen in Settings while a fold was pending with 11.2 s left: cancelled ("timing mode changed to
  instant") and clicked 0.4 s after the switch, once;
- Instant: 46 actions after 0.0–0.8 s, 0 timeouts, 0 ms intentional waiting recorded;
- the Live tab shows "Timing mode: Instant" and "timing: Instant" in the execution status;
- Instant and the 5 s minimum persist after reloading.
- **Weak check.** "Recommend mode with Instant: nothing clicked" saw 0 clicks, but the stand-in table started no hand
  in its 20 s window, so it shows little. The unit test (recommend and manual × both modes) is the real evidence.

Not validated on the live PokerNow site.

## 7. Full verification (sequential, one heavy process at a time where it mattered)

| Check | Result |
|---|---|
| Full unit suite, `npx vitest run --maxWorkers=4 --minWorkers=1` | **1,254 / 1,254** in 95 files, 717 s. `--minWorkers=1` is needed now: with `--maxWorkers=4` alone vitest refused to start ("minThreads and maxThreads must not conflict") |
| Type-check, extension and tools | pass |
| Lint | 0 errors, 185 warnings (same count as 0.9.1; console in tools, stubs in tests) |
| Production build | pass, `dist/` at 0.9.2 |
| Chromium, autonomous v2 (`npm run bot:e2e`) | 24 / 24 |
| Chromium, recommendation-only (`npm run bot:e2e:recommend`) | 32 / 32 |
| Chromium, v3 recommendation-only (`sim/bot/e2e-v3.ts`) | 27 / 27 |
| Chromium, dashboard (`npm run bot:e2e:dashboard`) | 40 / 40 |
| Chromium, authorised execution + timing modes (`npm run bot:e2e:exec`) | 28 / 28 |
| Phase 2.5 rows reproduced (v2, v3pr; seed 13300) | bit-identical |

**Memory:** no process was killed. The benchmark suites ran as at most two processes; the Chromium checks ran one
browser at a time.

## 8. Summary

- **Strategy regressions:** none in production; no default changed. The offline corrections show no significant
  difference: ring pooled −16.1 ± 18.3 bb/100 combined, with negative point estimates. They are not adopted.
- **Infrastructure:**
  - a reproducible, paired, multi-table-size harness with rake, process measures and negative controls;
  - three of four controls detected;
  - the limp-call blind spot of the opponent pool is identified.
- **Settings:** two timing modes, tested in unit tests and in Chromium.
