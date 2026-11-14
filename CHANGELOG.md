# Changelog

All notable changes. Versions match the on-table overlay badge and GitHub releases.

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
- Not measured: the full baseline-versus-current benchmark did not complete (the machine ran low on memory and the run was stopped). Pilot runs of 3,000 hands per table on an earlier parameter setting showed no significant difference in win rate between the two engines in simulation. No improvement in win rate is claimed. See `PROJECT_PROGRESS.md`.

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
