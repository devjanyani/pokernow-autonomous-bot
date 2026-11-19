# Changelog

All notable changes. Versions match the on-table overlay badge and GitHub releases.

## v0.9.0 (2026-11-19)
Version 3 becomes selectable in the extension as an experimental, recommendation-only strategy. Version 2 stays the default; nobody is switched. Accounts: `docs/bot/V3_IN_THE_EXTENSION.md`, `reports/V3_EXTENSION_INTEGRATION.md`, final Phase 2.5 benchmark in `reports/PHASE_2_5_STRATEGY_BENCHMARK.md`.
- New: Settings → Strategy engine → "v3 — Experimental (recommendation-only)". `mayAct()` is false whenever it is selected, so nothing is clicked whatever the mode and table authorisation (one gate for every click path; the popup says so).
- New: version 3 in the extension uses the Phase 2.5 population calibration (model D) and the river-range tilt, packaged as small aggregate tables and validated at start-up (pinned source, feature schema, fitted grid, monotone fold shifts). A table that fails is not used; version 3 then uses its hand-set baseline and says so. The tables are not applied at heads-up tables (no such data).
- New: every decision records which engine was requested and which decided, the fallback reason, the opponent model and the fitted tables used. The dashboard names the strategy ("v3 experimental", "v3 → v2 fallback: …"); the panel names it when it is not the default; Diagnostics shows the tables' provenance; the debug bundle records the setting.
- New: a failure inside version 3 falls back to version 2 for that decision (cancellations are passed on, never turned into fallbacks). Version 3 yields to the page before its final evaluation (longest synchronous block measured about 190 ms in Node, `reports/v3-latency.md`).
- New (diagnostic, off by default): shadow comparison. With version 2 selected, version 3's recommendation for the same decision point is computed after version 2's and shown beside it, with each engine's own EV labelled as not comparable. Never executed or stored as a decision.
- Fixed: changing the strategy engine or the opponent-adjustment weight rebuilt the agent with seed 1 instead of the table's seed.
- New tools: `sim/bot/e2e-v3.ts` (Chromium, stand-in table), `sim/bot/v3-latency.ts` rewritten (time to first recommendation, total time, longest block); the stand-in table takes `cents=1` (0.25 / 0.50).

## v0.8.2 (2026-11-18)
Phase 2.5: opponent learning from real cash-game hands. No production behaviour changed (version 2 default; version 3 offline). Accounts: `docs/bot/PHASE_2_5_OPPONENT_LEARNING.md`, `reports/PHASE_2_5_CALIBRATION.md`, `reports/PHASE_2_5_STRATEGY_BENCHMARK.md`.
- Data: 89,170 valid cash hands (237,380 postflop decisions) from a pinned, bounded sample of the MIT-licensed PHH dataset (HandHQ, 2009 online 100NL-200NL), fetched reproducibly with hashes into the git-ignored data folder; provenance record validated. Heads-up tables excluded (blind order inconsistent in the conversion); unknown iPoker stacks flagged.
- Measured: on held-out days and held-out players every fitted model predicts real players' actions better than version 3's hand-set model (logistic -0.030, frequency table -0.028, residual-calibrated version 3 -0.019 nats per decision, all significant). Real players fold less than modelled, above all when raised.
- Measured: version 2's river betting ranges are too strong (8% weak hands predicted, 15.5% revealed); a fitted re-weighting improves the likelihood of revealed hands significantly but closes only part of the gap.
- Found: version 3's failure to fold against a condensed river bet is a bet-size response error at break-even (it predicted 79% folds to its all-in where the equilibrium folds 72-75%), not a range, equity or payoff error.
- New (experimental, offline): agent options `v3Population` and `v3RiverRange` with the fitted tables; explanations say which parts are empirical. Against the simulated opponents (seed 13100) no candidate is better or worse than version 3. The final held-out set was stopped by a low-memory condition and is not run.
- New tools: `npm run bot:phase25` (fetch, extract, predict, calibrate, river estimator, optional benchmark with bounded parallelism); importer for multi-hand PHH files, TOML times and unknown stacks.

## v0.8.1 (2026-11-18)
Phase 2.4: version 3's over-raising. Default engine unchanged (version 2); version 3 still offline. Accounts: `docs/bot/PHASE_2_4_MODEL_CALIBRATION.md`, `reports/PHASE_2_4_BENCHMARK.md`.
- Found: version 3's learned knobs compared a player's raw fold rate after Hero's raises (and raise rate after Hero's bets) with a fixed population rate. That rate depends on Hero's own ranges, so the knobs counted it twice and drifted toward "this player folds" as hands accumulated (against version 2's model: "+0.13 extra folding to a check-raise", raising 76% facing bets, −114 bb/100).
- Fixed: residual calibration. Version 3 records its own predicted response probability at each of its bets and raises, and a knob moves only by the gap between observed responses and those predictions (shrunk). Same decks: +73 ± 50 bb/100 over 0.8.0 against that opponent.
- Measured on fresh seeds fixed in advance (12700, then 12900 once at the end): version 3 minus version 2, heads-up pooled, −1.8 ± 10.1 and −0.6 ± 10.9 bb/100; per decision −0.15 to 0.00 bb against three independent opponents. Equal, not better: not promoted.
- New: holdout valuation option for version 3 (`holdoutEvery`, off by default: unbiased values but worse choices at the time budget); eight reference fixtures, one against a closed-form equilibrium; tools `sim/bot/v3-raise-diag.ts`, `sim/bot/cash-raise-counts.ts`, extended `v3-bias.ts`; diagnostic hook `onV3Search` (offline only).
- Cash recording: 5 heads-up responses to raises; no fold-to-raise parameter can be estimated from it.

## v0.8.0 (2026-11-18)
Phase 2.3, cash-game strategy. Default engine unchanged (version 2). Accounts: `docs/bot/PHASE_2_3_ADVANCED_STRATEGY.md`, `reports/PHASE_2_3_BENCHMARK.md`.
- New (offline, not offered in the extension): version 3 postflop engine, `engine: 'v3'`. A best response over the betting tree of the current and next street, built with the rules engine (check-raises, re-raises, call-then-raise, delayed bets). Opponent responses depend on the betting so far, ranges are updated by exact reach weights, and Hero decides against a mixture of opponent models. Heads-up pots only; everything else falls back to version 2 with the reason stated.
- Measured: version 3 is not better than version 2. Held-out seed 12300, 13 heads-up tables: −10.3 ± 11.9 bb/100; significantly behind at three tables, ahead at none. Solver spots: 0.24 ± 0.08 against 0.22 ± 0.07 bb per decision. Hence not activated.
- Fixed (version 3, found by the benchmark): the opponent model counted the strength of a raising range twice and folded too much to raises (check-raised 78% against a nit).
- Fixed (version 2): bet sizes were whole chips, so at 0.25 / 0.50 the 33 / 66 / 100% sizes collapsed into one. Now in cents below two chips per big blind.
- New profile statistics: fold to a check-raise, fold when raised, re-raise when raised (opportunity-based, shrunk).
- New tools: `sim/bot/phase23-bench.ts` (+ `phase23-report.ts`), `cash-session.ts`, `solver-spots.ts`, `v3-bias.ts`, `v3-latency.ts`; reference evaluation for any engine pair; inner-node analysis in the river solver; a raise-heavy benchmark opponent.
- Cash recording 2026-11-18 analysed (anonymised report). Too few postflop opportunities to calibrate anything; the tournament recording was not used.

## v0.7.0 (2026-11-16)
Interface, tracking audit, first part of Phase 2.2. No strategy behaviour changed. Accounts: `docs/bot/LONG_SESSION_DIAGNOSTIC_AUDIT.md`, `docs/bot/PHASE_2_2_REPORT.md`, `docs/bot/STORAGE.md`.
- New: Tables tab. Search, nickname, last seen, hands, frames, log lines, authorisation. Revoke authorisation and delete history are separate; remove stale authorisations; remove all inactive tables; optional export first. The open table is never included.
- New: deletion of hands, single-hand recordings, recording sessions, log lines and profiles, each in one transaction. Deleting hands never changes opponent profiles; a deleted profile or revoked authorisation does not come back.
- Changed: Opponents, Hand review, Diagnostics and Settings rebuilt (sortable, searchable, paged tables; playing cards; actions by street with recommended against played; results that are not verified are greyed and never summed). The popup shows this table and a count of the others instead of every authorised id.
- Changed: database version 3 (per-table indexes, table and session registries). Existing data is upgraded in place; no stored row is rewritten.
- New: strategy engine selector under Settings, Strategy experiments. Default unchanged (version 2).
- Fixed (tracking, from the 2026-11-16 recording, each with a test on recorded frames): an uncalled bet returned during an all-in run-out marked the hand invalid, silently; a showdown where the loser did not show was stored as "ending not observed"; a call drawn as the caller's whole stack was read as an illegal raise; a check was deduced from a frame with no readable chips; a fold with a free check marked the hand uncertain; the call button of a short all-in call suppressed the recommendation.
- New: every finished hand is compared with the stacks the next hand starts with. A board run twice (the page shows one board) is detected and the table's result is used; an unexplained difference shows the result as unverified.
- New (offline tools, not in the extension): reference evaluation of single decisions under the simulated opponents' true policies; six independent benchmark opponents; river reference from the in-repository solver, validated on a closed-form game; offline adapter for the existing PokerBench model; data schema with provenance, validation and importers; opponent-response calibration framework. `npm run typecheck:tools` now type-checks the `sim/` tools.
- Measured: against independent opponents version 2 is ahead of version 1 at four of eight tables and behind at none; against the tight-aggressive program it is behind per decision (−0.64 ± 0.36 bb), mostly on the river; with nothing bet on the river it checks 62% where a solver reference for its own ranges checks 30%. Neither engine is claimed to be stronger.
- Not done: no dataset downloaded, no model trained, no prior changed; not tested on the live site.

## v0.6.1 (2026-11-16)
Strategy diagnosis. No strategic behaviour changed. Full account: `docs/bot/STRATEGY_V2_DIAGNOSIS.md`.
- Corrected: the 0.6.0 notes said the baseline-versus-current benchmark did not complete. It did; `reports/strategy-bench-2026-11-14.md` is a finished run and was reproduced exactly from the 0.6.0 commit for the row tested. It shows no setting in which the 0.6.0 engine (v2) beats the 0.5.1 engine (v1) and four in which it is significantly behind in simulation.
- Fixed: the standard error of a bet's EV, the error of the gap to the runner-up, the mixing weights and the stop-sampling flag were computed from the modelled-responses scenario even when the EV itself came from the pessimistic scenario. They now come from the same scenario as the EV. The best action is unaffected; mixing between close actions can differ slightly.
- New: every bet or raise reports its value under both response scenarios, and the explanation says when the choice depends on which is right. Sampling error and opponent-model sensitivity are no longer one number.
- New (benchmark tools only): the preflop and postflop engines can be selected separately; `npm run bot:strategy-diag` (factorial, direct match, ablations, benchmark reproduction), `npm run bot:response-calibration` (predicted against actual opponent responses), `npm run bot:lead-sensitivity`.
- Measured: the v2 deficit comes from the postflop engine (heads-up against the tight-aggressive program −32.0 ± 20.2 bb/100; six-handed mixed −29.9 ± 26.2), not from the preflop changes. v2 bets 15 to 37 points less often and folds more to flop bets. Removing the pessimistic scenario or the no-bluff rollout does not recover it.
- Not changed: the out-of-position weak-pair lead. It was traced to an assumption about turn play after a called lead, for which there is no data yet.
- Added: `docs/bot/POKER_DATA_TRAINING_ROADMAP.md`, a plan for solver-derived and real-hand data. Nothing downloaded or trained.

## v0.6.0 (2026-11-14)
Strategy engine. Found by re-running the engine on recorded recommend-mode hands (kept, anonymised, as `tests/bot/fixtures/live-2026-11-13-hands.json`). Full account: `docs/bot/STRATEGY_AUDIT.md`. Tracking, button reading, legal-action checks and the interface are unchanged; autonomous mode remains off by default.
- Fixed: a called bet was valued as a showdown with no further betting, so small bets with weak hands looked profitable (recorded: bottom pair led into the preflop raiser). The next street's betting is now played out.
- Fixed: after a check Hero was made to call a bet by a fixed rule, which could value checking below folding (recorded: check −1.6). Follow-ups are now plans chosen on the average over all deals; a check is never worth less than zero.
- Fixed: the engine ignored who raised before the flop. It now tracks the betting lead, names the bet (continuation bet, lead, probe, delayed continuation bet), and no longer treats a check to the raiser as proof of a weak hand.
- Fixed: hand strength was measured against all possible hands. It is now measured inside the player's own range and against the other players' ranges, including the range the opponents can put Hero on (kept separate from Hero's actual cards).
- Fixed: an unlikely line could collapse an opponent's range to a few leftover combos; an all-in call was discounted as if betting continued; a big blind's raise over limpers was read as a 42% open.
- New: decisions with a hand outside the range of Hero's own line (for example after calling against advice) are labelled out-of-distribution and lower confidence. Bets that rest on the assumed fold rate are labelled model-dependent.
- New: strategy library (`src/bot/strategy/library/`) with versioned packs, sources, assumptions, exact / approximation matching, and importers for JSON, a text range format and CSV (`npm run bot:ranges`). The two existing chart sets are wrapped as packs marked "source not verified". No solver data is shipped; the missing data is listed in `docs/bot/STRATEGY_LIBRARY.md`.
- New: 36 decision scenarios with property checks (`npm run bot:scenarios`), a tool to re-run the engine on recorded hands (`npm run bot:decisions`), and a baseline-versus-current benchmark (`npm run bot:strategy-bench`). The 0.5.1 engine stays in the repository as `engine: 'v1'`.
- (Corrected in 0.6.1: the benchmark did complete; see above.) As written at the time: the full baseline-versus-current benchmark did not complete (the machine ran low on memory and the run was stopped). Pilot runs of 3,000 hands per table on an earlier parameter setting showed no significant difference in win rate between the two engines in simulation. No improvement in win rate is claimed. See `PROJECT_PROGRESS.md`.

## v0.5.1 (2026-11-13)
Found in a second real recording (kept as `tests/bot/fixtures/live-2026-11-13b.json`).
- Fixed: when a check is free PokerNow shows `[Bet 5] [Bet] [Check] [Fold]`, and draws the "Bet 5" shortcut with the same CSS class as the Call button. The adapter picked the call button by class and read its trailing number, so it reported "Call 5" and every free-check decision after the flop was blocked ("call button shows 5, engine computes 0"). Buttons are now classified by their label text (`src/bot/adapter/pokernow/controls.ts`): fold, check, call, bet, raise, all-in, size shortcuts, pre-actions, with visibility and enabled state.
- Fixed (same cause, never triggered because autonomous mode was off): the driver's "call" would have clicked that "Bet 5" button. Clicks now go to the button whose label names the action.
- New: a legal-action mismatch records the buttons as read, the street, Hero's chips in front, the highest bet and the reconstructed amount to call, in the message and in the debug bundle; the Diagnostics tab shows them.
- Tests: 24 new (classification, real-recording regression, DOM, click guard).

## v0.5.0 (2026-11-13)
Fixes found by replaying the first debug bundle from a real PokerNow table (kept as `tests/bot/fixtures/live-2026-11-13.json`), and a redesigned dashboard and overlay. See `docs/bot/TRACKING.md` section 0.
- Fixed: a sitting-out player (drawn by PokerNow with the `fold` class, no cards, no chips) was counted as dealt in and could be given a blind. Hero's own big blind was then read as a call and the betting round closed before Hero's option ("engine expects no further action").
- Fixed: the acting-seat highlight stays on the seat that just acted for up to 0.9 s. 0.4.0 took that as proof the action had passed everyone else, folded them and ended the hand early. A highlight on a seat with nothing to decide is now ignored for 1.5 s, and deductions that would end a hand while someone is shown acting are withdrawn.
- New: dead small blind (only a big blind posted when the small-blind seat sits out). Blinds are chosen from the chips on the table.
- Corrected: the 0.4.0 note that PokerNow's fold marker was probably unrecognised. The recording shows it is recognised.
- New: Live page redesign (cards, board, one recommended action, whose turn, game context, players without horizontal scrolling, recent actions, one status pill). Diagnostics in collapsible sections with nothing removed. Smaller in-page overlay that can be dragged and minimised.
- Tests: 26 new (real-recording regression, dead small blind, presentation).

## v0.4.0 (2026-11-13)
State reconstruction and turn tracking, after reports from recommend-mode play on real tables that the bot sometimes expected another seat while PokerNow showed Hero's turn. Tested on synthetic tables only; see `docs/bot/TRACKING.md`.
- Fixed: a fold was recognised only from one unverified CSS class. A seat that faced a bet, added no chips and was passed by the action is now recorded as folded (marked as deduced, confirmed by its unchanged stack).
- Fixed: a seat with an unknown action was assumed to have called when the next street appeared, which put chips in the pot that were never bet. A call is now accepted only when the stack fell by exactly that amount.
- Fixed: the previous recommendation stayed on screen after Hero's turn ended. A recommendation now belongs to one decision point (hand, street, state version) and is recomputed every time the action returns to Hero.
- Fixed: an offline or away marker removed a dealt-in player from the hand; a player who disappeared was folded at once.
- New: observed actor and predicted actor are tracked separately; disagreements, stack and chip contradictions and button mismatches block the decision and state the reason ("Decision unavailable — state reconciliation required"). Six separate state indicators replace the single confidence number.
- New: per-seat participation model, explicit statuses for Hero folded, Hero all-in, waiting for opponent.
- New: a hand does not start until the blinds are where the button implies.
- New: folding is never returned when a check is free, enforced in one place.
- New: local diagnostic recorder, action timeline, **Export Debug Bundle** on the Diagnostics tab, and `npm run bot:replay` to replay a bundle offline. IndexedDB schema version 2 (adds `frames`, `meta`).
- New: 36 regression tests (`tests/bot/tracking.test.ts`); recommend-only browser check with fold markers hidden (`npm run bot:e2e:recommend`).

## v0.3.0 (2026-11-13)
- New extension build (`src/bot/`, `npm run build`): a fully local No-Limit Hold'em bot for PokerNow tables of 2 to 10 players. Manual, recommend and authorised autonomous modes, emergency stop, dashboard with hand review. See `docs/bot/`.
- Shared rules engine with side pots, short all-in re-open rule, antes and straddle; multiway Monte Carlo EV engine; opponent profiles with opportunity counts and shrinkage; adaptive decision time.
- Offline simulator for 2 to 10 players with benchmark opponents, tournaments, duplicate rotation and a reproducible report (`npm run bot:bench`).
- End-to-end browser check against a local stand-in table (`npm run bot:e2e`). Not yet run on a live PokerNow table.
- The previous overlay now builds with `npm run build:legacy` into `dist-legacy/` (`manifest.legacy.json`, `webpack.legacy.config.js`). It is no longer what `dist/` contains.

## v0.2.4 (2026-10-12)
- Overlay: when the blueprint makes the decision, the top section shows the blueprint's own mix ("BLUEPRINT MIX") instead of the preflop chart advice, which could disagree with the action the bot took.
- The blueprint now plays only at 80 to 125 big blinds effective (was 50 to 200). It was trained at 100 BB, and at 50 BB an all-in was read as the much larger 100 BB abstract shove. Other depths use the regular engine.

## v0.2.3 (2026-10-12)
- The overlay and the extension manifest now show the real version: both come from package.json at build time (the overlay was hard-coded to v0.1.52 through every v0.2.x release).
- Docs refreshed: README, ROADMAP, CONTRIBUTING.

## v0.2.2 (2026-10-09)
- 6-max preflop: a pot that folds down to two players keeps the 6-max charts; short-stack all-ins are detected even when logged as a raise and are called on chip EV against the jammer's range with overcallers modelled; the button no longer uses the heads-up shove table with both blinds to act.
- Simulator: per-seat starting stacks (`--stacks`) so short-stack spots get tested.

## v0.2.1 (2026-10-09)
- The trained heads-up blueprint plays inside the extension (`BLUEPRINT`, on): compact assets, in-browser bucketing that matches the C++ trainer, about 0.14 ms per decision. Against the v0.1.52 engine: +26.7 and +25.8 bb/100 on two pre-registered seeds.
- `blueprint+search` agent for the simulator and play app: real-time river search on top of the blueprint.

## v0.2.0 (2026-10-09)
- Real-time subgame solver on by default for heads-up turns and rivers; its combo cap no longer drops the bluff part of a narrowed range.
- Folded players no longer count as live, so heads-up pots at a 6-max table use the heads-up postflop path.
- Exploit mode keeps the sampled action instead of the argmax, and the 10% bluff raise is sampled instead of always firing.
- Postflop net inputs now match the training encoding.
- New modules behind flags, off until measured: preflop-conditioned range tracking, multiway equity, minimum-defense logic.
- C++ blueprint pipeline: MCCFR trainer, `bp serve`, real-time search, LBR, AIVAT, abstraction tools, cloud scripts. Duplicate match harness for 2 to 6 seats and a local play app.

## v0.1.19 to v0.1.52
- See the [GitHub releases](https://github.com/hellomate2/gto-poker-overlay/releases) for these versions.

## v0.1.18
- Widened heads-up preflop to real GTO width: button opens ~81% (was ~66%), BB defends ~74%. J9o/53s/suited connectors now open; premiums still 3-bet/4-bet to a size (no jams); raise-or-fold deep.

## v0.1.17
- Fixed the bot freezing after one hand: the no-double-act spot signature now includes the hand number, so preflop spots no longer collide across hands.

## v0.1.16
- Real solved heads-up preflop: CFR equilibrium charts for every scenario; deep all-in restricted so premiums 3-bet/4-bet to a size instead of jamming; push/fold stays exact short.

## v0.1.15
- Robust betting-situation reads: infer preflop scenario from bet size (no more opening/3-betting trash like K6o); detect facing-a-bet via the missing Check button; equity-gate the preflop fallback.

## v0.1.14
- Bets round to natural increments (165, not 166), scaled to the stake.

## v0.1.13
- Fixed heads-up position (the button/SB is in position postflop; was backwards). Labeled the overlay as an approximation, not perfect GTO.

## v0.1.12
- Handle facing a bet correctly: never "bet" into a bet; raise to at least the legal minimum.

## v0.1.11
- Stake-aware sizing end to end, including decimal stakes ($0.25/$0.50); never round bet amounts to whole chips on decimal games.

## v0.1.10
- Bulletproof blind reading from the blind element (fixes false short-stack all-in jams).

## v0.1.6 – v0.1.9
- Postflop judged by equity vs villain's range (stops value-betting losing hands); bet/raise capped to stack; pot read fixed; one consolidated overlay panel; build-version badge; never open-shove deep.

## v0.1.1 – v0.1.5
- Auto-play that mixes GTO frequencies; depth-limited postflop CFR (later replaced by the distilled net); hardened clicking; preflop driven by solved ranges.

## v0.1.0
- Initial public toolkit: perfect-hash evaluator, CFR study core (Kuhn/Leduc), preflop charts, HUD overlay.
