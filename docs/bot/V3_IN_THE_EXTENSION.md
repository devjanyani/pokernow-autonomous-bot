# Version 3 in the extension (0.9.0, execution permission 0.9.1): experimental, recommendation-only by default

Version 3 is the postflop search over betting sequences of Phase 2.3 ([STRATEGY.md](STRATEGY.md) section 9), with the
residual calibration of Phase 2.4 and the population tables of Phase 2.5. Since 0.9.0 it can be selected in the
extension for play-money recommendation testing. **It has not been shown to play better than version 2**
([reports/PHASE_2_5_STRATEGY_BENCHMARK.md](../../reports/PHASE_2_5_STRATEGY_BENCHMARK.md)); version 2 stays the default.
The measurements behind this page are in [reports/V3_EXTENSION_INTEGRATION.md](../../reports/V3_EXTENSION_INTEGRATION.md).

## 1. Selecting it

Dashboard → Settings → Strategy experiments → **Strategy engine: "v3 — Experimental (recommendation-only by default)"**. It takes
effect at the next decision. Version 2 is the default; a stored setting written by an earlier version, or any value
other than `v1`, `v2` or `v3`, reads as version 2, so nobody is switched to version 3 without choosing it.

## 2. Recommendation-only unless separately permitted, enforced in one place

Since 0.9.1 version 3 can act on tables authorised for autonomous play, but only with a separate, experimental
permission (Settings → "Allow version 3 to act on authorised tables (experimental)", off by default, behind a
confirmation dialog, cleared when the organiser confirmation is withdrawn). See
[AUTHORISED_EXECUTION.md](AUTHORISED_EXECUTION.md) for the gate, the timing and the fallbacks during execution.
Without that permission:

`mayAct()` (`src/bot/ext/records.ts`) is false whenever `strategyEngine` is `v3`, whatever the mode, the confirmation
and the table authorisation. Every path to a click goes through it: the executor is armed from it on every tick, the
decision loop asks it before executing, and the clock-out safe check / fold asks it too. The popup says "Autonomous
selected, but strategy v3 (experimental) is recommendation-only: nothing is clicked", and the dashboard's strategy tag
says "Recommendation-only". Tested by a whole authorised autonomous session with zero clicks (unit test) and in
Chromium against the stand-in table.

## 3. Wiring

- `agentFor()` in `src/bot/ext/controller.ts` builds the agent for the selected engine. Versions 1 and 2 are built
  exactly as before. Version 3 gets `engine: 'v3'`, the packaged tables that passed validation, `v3SpotChecks: true`
  and the tables' load status.
- Switching engines (Settings) replaces only the agent: opponent profiles and version 3's per-player residual
  calibration are carried over; the tracker, the recorder and the stored data are untouched. The decision in flight is
  dropped, and the next tick decides again with the new engine.
- Each decision carries `strategy: { requested, used, fallback, opponentModel, calibration }`. The dashboard shows
  "Strategy: v3 experimental" or "Strategy: v3 → v2 fallback" with the reason; the in-page panel names the strategy
  when it is not the default; the Diagnostics tab has a "Strategy engine and opponent model" section with the tables'
  provenance; the debug bundle records the setting and the tables' status.

## 4. Which spots version 3 decides, and the fallbacks

| Spot | Who decides | Shown as |
|---|---|---|
| Heads-up pot after the flop (one opponent left, all-in or not) | version 3 | v3 experimental |
| Heads-up **table** after the flop | version 3, uncalibrated baseline (no data for heads-up tables) | v3 experimental; population calibration "not applicable" with the reason |
| Preflop | version 2's preflop charts and ranges (version 3 has no preflop engine) | v3 → v2 fallback: "preflop: …" |
| Two or more opponents | version 2 | v3 → v2 fallback: "2 opponents in the pot: version 3 searches heads-up pots only" |
| Version 3 cannot build its tree or fails while searching | version 2 for that decision | v3 → v2 fallback: "version 3 failed (…)" / "search not built (…)" |
| State not confirmed (blockers, turn disagreement, buttons contradict the reconstruction, low confidence) | nobody: the existing suppression applies before any engine runs | "Decision unavailable — …" |

A cancellation (the hand, street or actor changed) is never turned into a fallback: the computation is dropped.

## 5. The opponent-response model version 3 uses

Version 3 needs response probabilities that depend on the strength of the opponent's holding. Of the Phase 2.5 models
only **model D** has that form: version 3's own hand-set response functions with per-situation corrections fitted to
real cash-game hands against version 3's own predictions (`population-calibration.json`, 55 cells, fitted on days 1-18
of the 89,170-hand HandHQ sample). The frequency table (model B) and the logistic regression (model C) predict better
on held-out hands but give range-average probabilities only, so they cannot be used by the search.

When Hero faces a river bet from the river aggressor, the bettor's range is version 2's estimate re-weighted by the
fitted river tilt (`river-range-calibration.json`, 8 cells).

Each table is validated when the content script starts (`src/bot/strategy/v3/artifacts.ts`): the source must be the
pinned PHH dataset commit; every cell must be in the feature schema version 3 uses (street × facing × size class, or
street × open × role; size class × turn action for the river); every value must lie inside the grid it was fitted on;
fold shifts must be non-decreasing in the bet size (as the fit guaranteed). A table that fails is not used at all, and
version 3 uses its baseline (the hand-set response model; version 2's river range), saying so in the explanation and in
the strategy note. Nothing is filled in or repaired. The tables are small aggregate files; no hand, player or table
identifier is in them or in the extension.

The tables are applied only where their data covers the spot: heads-up pots at tables of three or more players
(heads-up tables were excluded from the data because of the conversion fault described in
[PHASE_2_5_OPPONENT_LEARNING.md](PHASE_2_5_OPPONENT_LEARNING.md)).

## 6. Legality, sizes and chip units

Version 3's tree is built with the rules engine, so its actions respect the observed legal actions, minimum raises,
the re-open rule, all-ins and effective stacks. Sizes are whole chips at two or more chips per big blind and cents
below (PokerNow's 0.25 / 0.50 tables), capped at the stack. The agent's final legality gate checks the chosen action
against the rules engine before it leaves the agent; the dashboard and panel display the amount exactly as computed.

## 7. Time and responsiveness

Version 3 runs in the content script under the same clock budget and stopping rule as version 2, adding deals in
batches and yielding to the page between batches and before its final evaluation; it stops at 2,400 deals at most.
A changed decision point cancels it at the next yield. Measured: [reports/v3-latency.md](../../reports/v3-latency.md).

## 8. Shadow comparison (off by default)

Settings → "Shadow comparison with version 3" (shown only while version 2 is selected). After version 2's
recommendation is out (and after any click), the extension also computes version 3's recommendation for the same
decision point and shows both on the Live tab: the two actions, whether they agree, whether the sizes differ, each
engine's **own** EV estimate (labelled as not comparable: they come from different opponent models), and version 3's
fallback reason when it fell back. It is cancelled when the decision point changes, never executed, never stored as a
decision (one info line per comparison goes to the local log).

## 9. Known limitations

- Version 3 is not shown to be stronger than version 2 (held-out benchmarks), and the fitted tables come from 2009
  online 100NL–200NL play, not from PokerNow players.
- The response functions of hand strength are hand-set; only their per-situation residuals are fitted.
- Two streets of look-ahead, discrete sizes, heads-up pots only.
- The browser checks use the local stand-in table, not the live site.
