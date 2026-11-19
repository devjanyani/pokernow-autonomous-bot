# Version 3 in the extension: integration report (0.9.0, 2026-11-19)

Version 3 (the postflop search over betting sequences, with the Phase 2.5 fitted tables) can now be selected in the
extension as **"v3 — Experimental (recommendation-only)"**. Version 2 remains the default. Version 3 is **not** shown to
play better than version 2: on the untouched final set (seed 13300) the configuration the extension runs, v3pr, measured
+1.1 ± 11.4 bb/100 against v2 over 14 heads-up tables, which is level
([PHASE_2_5_STRATEGY_BENCHMARK.md](PHASE_2_5_STRATEGY_BENCHMARK.md)). User guide:
[docs/bot/V3_IN_THE_EXTENSION.md](../docs/bot/V3_IN_THE_EXTENSION.md).

## 1. Wiring

| Piece | Where | What it does |
|---|---|---|
| Setting | `src/bot/ext/records.ts` | `strategyEngine: 'v1' \| 'v2' \| 'v3'`; anything else stored reads as `v2`. `shadowV3` (default false). |
| Click gate | `mayAct()` in `records.ts` | false whenever `strategyEngine === 'v3'`. The executor is armed from it on every tick; the decision loop and the clock-out safe check / fold also ask it. |
| Agent | `agentFor()` in `src/bot/ext/controller.ts` | v1 and v2 built exactly as before. v3: `engine: 'v3'`, the validated tables, `v3SpotChecks: true`, the tables' status. |
| Switching | `LiveController.updateSettings` | replaces only the agent; profiles and v3's per-player residual calibration carried over; tracker, recorder and storage untouched. The decision in flight is dropped. Also fixed: the rebuilt agent used seed 1 instead of the table's seed. |
| Per-decision note | `Decision.strategy` (`src/bot/strategy/types.ts`) | `{ requested, used, fallback, opponentModel, calibration: { population, river, notes } }` |
| Display | `view.ts`, `dashboard.ts`, `content.ts`, `popup.ts`, `tabs/settings.ts`, `tabs/diag.ts` | "Strategy: v3 experimental" / "Strategy: v3 → v2 fallback" with the reason; popup states recommendation-only; Diagnostics section "Strategy engine and opponent model"; debug bundle records the setting and the tables' status. |

## 2. Opponent-response model and the fitted tables

| Phase 2.5 model | Usable by version 3? | Why |
|---|---|---|
| A: version 3's hand-set model (baseline) | yes | its native model |
| B: frequency table | no | range-average probabilities; the search needs responses as a function of the opponent's holding |
| C: logistic regression | no | same |
| **D: residual population calibration** | **yes, used** | per-situation corrections to version 3's own response functions |
| River range tilt | yes, used | re-weights version 2's river-bettor range |

Packaged files: `src/bot/strategy/v3/population-calibration.json` (55 cells) and `river-range-calibration.json`
(8 cells), fitted on days 1-18 of the 89,170-hand HandHQ sample (`phh-dataset@e47fbd5`). Aggregate values only: no hand,
player, table or site identifier. Re-derived by the seed-13300 run and byte-identical.

Validation at start-up (`src/bot/strategy/v3/artifacts.ts`, all or nothing per table): pinned source; every key in the
feature schema; shifts in [−0.3, 0.15] and multipliers in [0.5, 4] (the fitted grid); no shift on "open" cells; fold
shifts non-decreasing in bet size; river bins increasing in (0, 1), θ length bins+1, |θ| ≤ 3. A table that fails or is
missing is not used; version 3 falls back to its baseline and the note says "population calibration unavailable (…)".
Nothing is repaired or filled in. Both packaged tables pass.

Spot support: applied in heads-up pots at tables of three or more players. At a heads-up table the tables are "not
applicable" (heads-up tables were excluded from the data) and version 3 uses the baseline.

## 3. Fallbacks

| Spot | Decided by | Stated reason |
|---|---|---|
| preflop | v2 | "preflop: version 3 has no preflop engine, so version 2's preflop charts and ranges decided" |
| two or more opponents | v2 | "N opponents in the pot: version 3 searches heads-up pots only" |
| version 3 throws or cannot build its tree | v2 | "version 3 failed (…)" |
| decision point changes during the search | nobody (dropped) | a cancellation, never converted into a fallback |
| state not confirmed (blockers, turn disagreement, contradictory buttons, low confidence) | nobody | existing suppression, before any engine runs |

## 4. Check-raises, re-raises, planning, sizes

Version 3 builds its two-street tree with the rules engine, so its candidates are legal by construction (minimum raise,
re-open rule, all-ins, effective stacks), and the agent's final legality gate re-checks the chosen action. Check-raises
and re-raises are nodes of that tree; "call now, raise or bet later" is valued through the next street. Sizes are whole
chips at ≥ 2 chips per big blind and cents below. In Chromium every one of 48 whole-chip sizes and 12 cents sizes was
legal; all 5 version 3 spots facing a bet had a raise option evaluated, and 3 raised.

## 5. Latency ([v3-latency.md](v3-latency.md), Node, i7-12700H)

Version 3 total 79-347 ms per decision against version 2's 27-181 ms; time to version 3's first recommendation 8-88 ms;
longest synchronous block about 190 ms (v2 about 60-96 ms) after
adding a yield before the final evaluation (before: 336 ms). Capped at 2,400 deals; same clock budget as version 2.
Browser timings differ by a machine-dependent factor.

## 6. Shadow comparison (off by default)

With version 2 selected, version 3's recommendation is computed after version 2's is published (and after any click),
by a separate agent with copied profiles, cancelled when the decision key changes, shown only while its key matches the
current decision. It lists both actions, agreement, size difference, each engine's own EV ("not comparable"), and
version 3's fallback. Never executed, never stored as a decision.

## 7. Tests and checks

- `tests/bot/v3-extension.test.ts`: 19 tests covering check-raise, facing a raise, check-call, delayed bet, first in,
  thin river value, bluff-catch, short stack / all-in, multiway fallback, preflop fallback, heads-up table, missing
  and invalid tables, failure fallback, no clicks under v3 (authorised autonomous session), legality of every action,
  strategy note and explanation belonging to the current hand, dashboard labels, shadow.
- Full suite 1,193 / 1,193 (91 files); type-check (extension and tools) passes; build passes; lint 0 errors
  (181 warnings, 178 before; the 3 new ones are empty stubs in the test, the existing pattern).
- Chromium against the local stand-in table: [e2e-v3-2026-11-19.md](e2e-v3-2026-11-19.md) 27 / 27;
  recommend-only [e2e-extension-recommend-only-2026-11-19.md](e2e-extension-recommend-only-2026-11-19.md) 32 / 32;
  autonomous version 2 [e2e-extension-2026-11-19.md](e2e-extension-2026-11-19.md) 24 / 24.

## 8. Browser validation status

Validated only against the local stand-in table (PokerNow-shaped markup, simulated seats). **Not run on the live
PokerNow site.** The live site's markup, timing and multi-table behaviour are not covered by these checks.

## 9. Limitations

- Not stronger than version 2 on held-out benchmarks; the river tilt alone measured significantly worse than v3 on the
  final set (−5.6 ± 3.7) against programs, though not in combination.
- Fitted to 2009 online 100NL-200NL players, not PokerNow players; the response functions of hand strength remain
  hand-set, only their residuals are fitted.
- Heads-up pots only, two streets of look-ahead, discrete sizes; no preflop engine.
- Longer page blocks than version 2 (about 190 ms in Node).
