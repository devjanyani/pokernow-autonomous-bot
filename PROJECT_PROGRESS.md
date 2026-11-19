# Project progress

Last updated: 2026-11-19. Branch `autonomous-bot`. Version 0.9.1.

Detailed documents: [docs/bot/README.md](docs/bot/README.md) (install and use), [TRACKING](docs/bot/TRACKING.md) (state reconstruction, what the real recording showed, debug bundle, next live test), [ARCHITECTURE](docs/bot/ARCHITECTURE.md), [STRATEGY](docs/bot/STRATEGY.md), [STORAGE](docs/bot/STORAGE.md), [LIMITATIONS](docs/bot/LIMITATIONS.md), [STRATEGY_V2_DIAGNOSIS](docs/bot/STRATEGY_V2_DIAGNOSIS.md) (why v2 does not beat v1), [POKER_DATA_TRAINING_ROADMAP](docs/bot/POKER_DATA_TRAINING_ROADMAP.md) (plan for Phase 2.2), [LONG_SESSION_DIAGNOSTIC_AUDIT](docs/bot/LONG_SESSION_DIAGNOSTIC_AUDIT.md) (the 2026-11-16 recording), [PHASE_2_2_REPORT](docs/bot/PHASE_2_2_REPORT.md) (reference evaluation, independent opponents, river solver reference). Session log: [DEVELOPMENT_SESSION.md](DEVELOPMENT_SESSION.md).

## Checkpoint (2026-11-19, version 0.9.1)

- Authorised execution for experimental version 3 and scheduled action timing, for organiser-authorised play-money
  bot games only ([AUTHORISED_EXECUTION.md](docs/bot/AUTHORISED_EXECUTION.md)). Version 2 stays the default; version 3
  stays experimental and recommendation-only unless its separate execution permission (Settings, off by default) is
  on, in addition to autonomous mode, the organiser confirmation and the table's own authorisation.
- Each decision waits one delay drawn when Hero's turn is confirmed (uniform 4-20 s by default, same for every action,
  computation included), never past the deadline minus a 3 s margin; a pending action is cancelled at once on any
  change of state, permission or settings. No strategy algorithm changed.
- Validated: `tests/bot/scheduler.test.ts` 18/18 (manual clock, seeded randomness); Chromium against the stand-in
  table 23/23 ([reports/e2e-exec-2026-11-19.md](reports/e2e-exec-2026-11-19.md)): 18 turns acted on after 4.2-19.9 s,
  0 timeouts, 0 clicks without the permissions, 2.1-2.5 s with a 5 s clock and the conflict shown. Not run on the live site.
- Release verified ([reports/RELEASE_0.9.1.md](reports/RELEASE_0.9.1.md)), one check at a time: full suite 1,211 / 1,211
  (four workers); Chromium autonomous v2 24/24, recommendation-only 32/32, v3 recommendation-only 27/27, execution
  23/23; type-check, lint (0 errors) and build pass. The three earlier timeouts were CPU contention on version 3 tests
  at the 5 s default, not defects (diagnosis in the release record). Pushed to remote `private`; `dist/` built at 0.9.1.
- Not validated: the live PokerNow site.

## Previous checkpoint (2026-11-19, version 0.9.0)

- Branch `autonomous-bot`, version 0.9.0, pushed to remote `private`. `dist/` is built at 0.9.0.
- Phase 2.5 completed: the final held-out set (seed 13300) was run once, untouched. Calibrated version 3 (v3pr) minus
  version 2: +1.1 ± 11.4 bb/100, level. The river tilt alone is significantly worse (−5.6 ± 3.7). Better prediction of
  real players is not better play against the benchmark programs.
- Version 3 is selectable in Settings as **"v3 — Experimental (recommendation-only)"**. It uses the validated
  population calibration (model D) and river tilt, falls back to version 2 preflop, multiway and on failure (shown on
  the dashboard), and never clicks (`mayAct()` false). Version 2 stays the default; nobody is switched. Optional shadow
  comparison, off by default.
- Validated in Chromium against the local stand-in table only (27/27, 32/32, 24/24), not on the live site.
- Accounts: [reports/V3_EXTENSION_INTEGRATION.md](reports/V3_EXTENSION_INTEGRATION.md), [docs/bot/V3_IN_THE_EXTENSION.md](docs/bot/V3_IN_THE_EXTENSION.md), [reports/PHASE_2_5_STRATEGY_BENCHMARK.md](reports/PHASE_2_5_STRATEGY_BENCHMARK.md).

## Previous checkpoint (2026-11-18, version 0.8.2)

- Branch `autonomous-bot`, version 0.8.2, pushed to remote `private`. `dist/` is built at 0.8.2.
- Done in this version: Phase 2.5. The first real hand histories were used: 89,170 cash hands from the MIT-licensed
  PHH dataset (HandHQ, 2009), as a bounded, pinned, hashed sample under the git-ignored `data/` folder, with a
  provenance record. Fitted opponent models beat the hand-set one on held-out data. River ranges were found too
  strong and partly corrected. The river fold failure was diagnosed. Two experimental version 3 options were added.
- **No production behaviour changed.** Version 2 is the default; version 3 and its new options are offline only.
- The final held-out benchmark (seed 13300) was stopped by a low-memory condition here; it was run in 0.9.0.
- Accounts: [PHASE_2_5_OPPONENT_LEARNING.md](docs/bot/PHASE_2_5_OPPONENT_LEARNING.md), [reports/PHASE_2_5_CALIBRATION.md](reports/PHASE_2_5_CALIBRATION.md), [reports/PHASE_2_5_STRATEGY_BENCHMARK.md](reports/PHASE_2_5_STRATEGY_BENCHMARK.md).

## Previous checkpoint (2026-11-18, version 0.8.1)

- Branch `autonomous-bot`, version 0.8.1, pushed to remote `private`. `dist/` is built at 0.8.1.
- Done in this version: Phase 2.4. The cause of version 3's over-raising was found (learned knobs that counted
  Hero's own range selection twice) and corrected (residual calibration). Also: a value-bias study, eight reference
  fixtures, what the cash recording can calibrate (nothing about raises), and two fresh held-out benchmarks.
- **Version 3 is still not activated**: it is now equal to version 2 on fresh seeds (−1.8 ± 10.1 and −0.6 ± 10.9
  bb/100 heads-up pooled), not better. No behaviour change reaches the extension.
- Accounts: [PHASE_2_4_MODEL_CALIBRATION.md](docs/bot/PHASE_2_4_MODEL_CALIBRATION.md), [reports/PHASE_2_4_BENCHMARK.md](reports/PHASE_2_4_BENCHMARK.md).
- To resume: see `DEVELOPMENT_SESSION.md`.

## Previous checkpoint (2026-11-18, version 0.8.0)

- Branch `autonomous-bot`, version 0.8.0, pushed to remote `private`. `dist/` is built at 0.8.0.
- Done in this version: Phase 2.3 (cash-game strategy). The work: an experimental version 3 postflop engine that plans
  betting sequences over two streets; opponent statistics for check-raises and raises; analysis of the 2026-11-18
  cash recording; a solver comparison with independent ranges; a held-out benchmark of versions 1, 2, 3 and the
  PokerBench model.
- **Version 3 is not activated.** It was not better than version 2 (held-out seed, heads-up pooled −10.3 ± 11.9
  bb/100; significantly behind at three tables, ahead at none). The default is still version 2; Settings still offers
  versions 1 and 2 only. One behaviour change reaches the extension: version 2's bet sizes are now in cents at
  stakes below two chips per big blind (before, at 0.25/0.50, the 33/66/100% sizes collapsed into one).
- Tracking, interface, storage, action recognition and permissions: unchanged.
- Accounts: [PHASE_2_3_ADVANCED_STRATEGY.md](docs/bot/PHASE_2_3_ADVANCED_STRATEGY.md), [reports/PHASE_2_3_BENCHMARK.md](reports/PHASE_2_3_BENCHMARK.md), [reports/cash-session-2026-11-18.md](reports/cash-session-2026-11-18.md).
- To resume: see `DEVELOPMENT_SESSION.md`.

## Previous checkpoint (2026-11-16, version 0.7.0)

- Branch `autonomous-bot`, version 0.7.0, pushed to remote `private`. `dist/` is built at 0.7.0.
- Done in this version: dashboard, popup and history management; the audit of the 2026-11-16 recording with seven tracking fixes; the first part of Phase 2.2 (measuring instruments and their results).
- **No strategy behaviour changed.** The default engine is still version 2; version 1 can be chosen under Settings, Strategy experiments.
- The database is at version 3. Existing data is upgraded in place on first use; nothing is rewritten.
- `debug_bundles/` holds four local bundles. The folder is git-ignored and nothing in it is tracked. `data/` (external datasets) is git-ignored and empty: nothing was downloaded.
- To resume: `git pull private autonomous-bot`, `npm install` if `node_modules` is missing, `npm run test:bot` (expect {BOTN} passing, about two minutes).
- Waiting on you: the items at the end of `docs/bot/POKER_DATA_TRAINING_ROADMAP.md` (sources, your PokerNow logs, solver access), unchanged; and one live session with 0.7.0 so the new tracking rules and the dashboard are seen on the real site.

## Where things stand

**0.9.1 (latest): authorised execution and timing.** Experimental version 3 can act on authorised play-money bot tables with its own opt-in; every action waits a per-decision delay of 4-20 s by default within the deadline. Details: [AUTHORISED_EXECUTION.md](docs/bot/AUTHORISED_EXECUTION.md).

**0.9.0: version 3 as an experimental, recommendation-only option.** The Phase 2.5 final set shows calibrated version 3 level with version 2 (+1.1 ± 11.4 bb/100). It can be tried in Settings; it never clicks, and preflop and multiway spots fall back to version 2. Details: [V3_EXTENSION_INTEGRATION.md](reports/V3_EXTENSION_INTEGRATION.md).

**0.8.2: Phase 2.5, opponent learning from real hands.** 89,170 real 2009 cash hands show that the hand-set opponent model over-predicts folding, above all when raised, and that river betting ranges are estimated too strong. Fitted models predict significantly better; inside version 3 they do not yet play measurably better against the simulated opponents. Details: [PHASE_2_5_OPPONENT_LEARNING.md](docs/bot/PHASE_2_5_OPPONENT_LEARNING.md).

**0.8.1: Phase 2.4.** Version 3's over-raising came from opponent knobs that read Hero's own range selection as a trait of the player; they are now calibrated against the model's own predictions. Version 3 is now level with version 2 on fresh seeds but not better, so it stays offline. Details: [PHASE_2_4_MODEL_CALIBRATION.md](docs/bot/PHASE_2_4_MODEL_CALIBRATION.md).

**0.8.0: Phase 2.3, cash-game strategy.** An experimental engine (version 3) searches betting sequences: check-raises, re-raises, calling now and raising later. It plays against an opponent model that depends on the betting so far and allows for its own uncertainty. It works as designed, but it was not better than version 2 in a held-out benchmark, so it stays offline. The default is unchanged. Details: [PHASE_2_3_ADVANCED_STRATEGY.md](docs/bot/PHASE_2_3_ADVANCED_STRATEGY.md).

**0.7.0: interface, tracking audit, Phase 2.2 instruments.** Three pieces of work, details in "Version 0.7.0" below. In one paragraph: the dashboard and popup were rebuilt with a table manager and scoped deletion; the long recording showed that the large loss was real, that the positive total left out the largest losses, and seven defects in tracking, all fixed with tests on the recorded frames; and three new instruments (true-policy reference evaluation, independent opponents, a validated river solver reference) show that version 2 is ahead of version 1 against opponents that punish betting, behind against opponents that fold, and too passive on the river when nothing has been bet. **Neither engine is claimed to be stronger.**

**0.6.1: strategy diagnosis.** The benchmark that earlier notes called "not completed" did complete; it was verified and is committed. It and the follow-up experiments show that the 0.6.0 engine (v2) beats the 0.5.1 engine (v1) in no simulated setting and is significantly behind in several. The cause is the postflop engine: v2 bets far less often and folds more to flop bets. One mathematical defect (standard errors taken from the wrong scenario) was confirmed and fixed; it is not the cause. **No strategy is claimed to be stronger.** Details in "Version 0.6.1" below.

**0.6.0: strategy engine.** An audit against the recorded hands confirmed nine defects in how the engine chose actions, including the one behind "bet bottom pair into the preflop raiser". The postflop engine and the opponent model were replaced; the old engine is kept as a runnable baseline. A strategy library with importers was added; no solver data exists to put in it yet. No gain in win rate is claimed (and see 0.6.1 above: none was found). Details in "Version 0.6.0" below.

**0.5.1:** a second real recording showed tracking working on all five hands and one new failure: PokerNow's "Bet 5" shortcut was read as "Call 5", which blocked Hero's free check on the flop, turn and river. Buttons are now classified by their label. Details in "Version 0.5.1" below.

Version 0.5.0 fixes the turn-tracking failures found by replaying the first debug bundle from a real PokerNow table, and redesigns the dashboard and the in-page overlay. The real recording (5 hands, 118 frames) now reconstructs exactly: every Hero turn in it gets a recommendation, with no blocker, warning or deduced action. That is one six-handed session at 1/2 blinds; it is evidence for those situations, not a soak.

| Milestone | State |
|---|---|
| Original repository preserved | Tag `checkpoint/pre-autonomous-bot-2026-11-12`; remote `origin` untouched |
| Rules engine, 2 to 10 players, side pots, dead small blind | Done, tested |
| Multiway equity, strategy, opponent profiles, simulator | Done, tested offline (unchanged in 0.5.0) |
| Chrome MV3 extension (content script, service worker, popup, dashboard) | Built; passes browser checks against a local stand-in table |
| Turn tracking, reconciliation, participation, recommendation lifecycle | Done; **verified against one real recording** plus synthetic tests |
| Diagnostic recorder, timeline, debug bundle export, offline replay | Done; used on real data |
| Dashboard and overlay redesign | Done; checked in Chromium and on the recorded states |
| Further live sessions (other table sizes, antes, all-ins, long soak) | **Not done** |
| Autonomous play on a live table | Not attempted; stay in recommend mode |

## Version 0.7.0

### Interface and local data

- **Database version 3**: per-table indexes and two registries (tables, recording sessions), filled from existing rows on upgrade. See [STORAGE.md](docs/bot/STORAGE.md).
- **Tables tab**: every table the extension has seen, with nickname, last seen, hands, frames, log lines and authorisation. Revoking an authorisation and deleting history are separate actions. Remove stale authorisations; remove all inactive tables; optional export first. The open table is never included.
- **Deletion** of hands, single-hand recordings, recording sessions, log lines, tables and profiles, each in one transaction. Deleting hands never changes opponent profiles. A deleted profile and a revoked authorisation do not come back.
- **Opponents**: sortable, searchable, paged; six headline statistics with interval and sample size; style with a confidence tag; everything else in an expandable row.
- **Hand review**: filters, sorting, paging, selection; playing cards; actions by street; recommended against played; reconstruction warnings; results that are not verified are greyed and never summed.
- **Diagnostics**: live checks, stored data by table, recording sessions, searchable log, debug bundle.
- **Settings** in four groups. New under Strategy experiments: engine selector (default unchanged).
- **Popup**: this table, mode, authorisation, a count of other authorised tables and a link to the Tables tab.

### The 2026-11-16 recording

Full account: [LONG_SESSION_DIAGNOSTIC_AUDIT.md](docs/bot/LONG_SESSION_DIAGNOSTIC_AUDIT.md).

- The loss of 534 big blinds in one hand is real; the stored recommendation there was to fold and the call was a manual click.
- The positive total summed only hands marked valid (+848.7 bb over 55) and left out the largest losses. Rebuilt and checked against the stacks: minus 87.8 bb over 83 verified hands.
- Seven defects fixed, each with a test on recorded frames: uncalled bet returned during an all-in run-out; showdown where the loser does not show; call drawn as the whole stack; chips momentarily unreadable; fold with a free check; board run twice (new check of every result against the next hand's stacks); call button of a short all-in call.
- Stored summaries of that bundle: 73 of 110 verified. Rebuilt: 104 of 109.

### Phase 2.2, first part

Full account: [PHASE_2_2_REPORT.md](docs/bot/PHASE_2_2_REPORT.md). All offline; nothing reaches the extension.

| | Built | Result |
|---|---|---|
| A | Value of each candidate action under the simulated opponents' true policies | Version 2 minus version 1 per decision: −0.64 ± 0.36 bb against the tight-aggressive program, +0.81 ± 0.70 against the trapper; no class of action clearly ranked too low |
| B | Six opponents independent of both engines' models | Version 2 ahead at four of eight tables, behind at none (seed 8800) |
| C | River reference from the in-repository solver, validated on a closed-form game | With nothing bet, version 2 checks 62% where the solution checks 30% and loses 1.15 ± 0.24 bb more than version 1 against it |
| D | Offline adapter for the PokerBench model | Loaded and masked correctly; no advantage; stays off |
| E | Data schema, provenance, validation, importers | Synthetic fixtures only; no dataset downloaded |
| F | Calibration framework (assumption, population, player) | No real-hand frequencies yet |

## Version 0.6.1: strategy diagnosis (Phase 2.1)

Full account with every table: [STRATEGY_V2_DIAGNOSIS.md](docs/bot/STRATEGY_V2_DIAGNOSIS.md). Raw output: `reports/strategy-diag-2026-11-16.txt`.

**Status reconciled.** `reports/strategy-bench-2026-11-14.md` is a completed run (seed 2027, 70 minutes), written two minutes after the last checkpoint commit. Its "heads-up vs tight-aggressive" row was re-run from a clean checkout of `921447a` and matched to six decimals for both engines. Result: nine of thirteen comparisons lean toward v1, four significantly (heads-up vs the tight-aggressive program −25.9 ± 16.5; three v2 seats against three v1 seats −9.1 ± 7.6 per seat; forced loose preflop calls −29.6 ± 25.0; statistics off against stations and random players −82.9 ± 64.8). None favours v2 significantly.

**Preflop and postflop separated** (same decks, four combinations; bb/100, 95% interval):

| Table | v2/v2 − v1/v1 | Postflop change alone | Preflop change alone |
|---|---|---|---|
| Heads-up vs tight-aggressive, 6,000 hands | −32.0 ± 20.2 | −32.0 ± 20.2 | 0 (same code heads-up) |
| Six-handed independent, 4,800 hands | −4.2 ± 56.4 | +5.7 ± 54.5 | −1.7 ± 22.7 |
| Six-handed mixed, 4,800 hands | −28.5 ± 27.2 | −29.9 ± 26.2 | −13.5 ± 13.8 |
| Six-handed mixed with loose preflop calls, 4,800 hands | −6.4 ± 43.4 | −6.3 ± 40.8 | +6.5 ± 14.9 |
| Three seats against three v1 seats, 4,800 hands | −1.0 ± 12.2 per seat | −2.2 ± 12.9 | −1.6 ± 8.3 |

The significant differences are postflop. No preflop effect or interaction is significant. The direct match and the loose-call deficit from the benchmark were not reproduced at 4,800 hands (their intervals contain both zero and the benchmark's value).

**What v2 does differently.** It bets 15 to 37 points less often on every street (river, checked to: 36 to 48% against 70 to 77%) and folds 10 to 20 points more often to a flop bet.

**Ruled out as causes** (heads-up ablation, 6,000 hands): removing the pessimistic scenario (−8.3 ± 15.9 against plain v2), letting Hero's simulated next-street play bluff (0.0 ± 14.0), both together (−8.1 ± 16.5). The passivity comes from the core of v2 (range-relative responses, the second street, plan valuation), not from those guard rails. Which of the three is not yet separated.

**Simulator caveat.** The significant deficits are at tables with opponents built from v1's own behaviour model, which v1 predicts exactly, and none of the simulated opponents punishes over-betting. Against the range-aware and equity-threshold opponents heads-up there is no significant difference. So: v2 has no measured advantage; it is not shown that v1 is better against people.

**Defect fixed.** A bet's EV is the lower of two response scenarios, but its standard error, the error of the gap to the runner-up, the mixing weights and the stop-sampling flag were always taken from the first scenario. Now all come from the scenario the EV came from (`tests/bot/postflop-uncertainty.test.ts` failed before: 1.332 reported against 1.292). The best action is unaffected. Each bet now also reports both scenario values, and the explanation separates sampling error from opponent-model sensitivity.

**The weak out-of-position lead** (`oop-caller-bottom-pair-dry`). Not fold equity: the lead beats the check as long as the button folds more than 4% of the time (modelled 28%), and across every opponent tendency the model can express. It wins because being called is valued at +1.6bb, more than the whole check line (+1.4bb). That in turn is because the modelled opponent bets the turn in 64% of deals after its own flop bet but takes the pot on the turn in only 24% after calling Hero's lead. Not a coding error; an assumption about later streets with no data behind it. The lead stops winning once that 24% passes about 59%. Left unchanged until there is a measured frequency.

**Tools added (benchmark only):** per-street engine selection in `BotAgent`; `npm run bot:strategy-diag`, `npm run bot:response-calibration`, `npm run bot:lead-sensitivity`.

**Existing assets judged worth using:** the heads-up blueprint as an independent benchmark opponent; the in-repository river solver as an exact river reference; the open-source `postflop-solver` adapter once its solver is built. Not usable as references: the heads-up preflop CFR output, the small ML policy as a decision maker.

**Next five changes, ranked** (diagnosis, section 10): an exact evaluator against the simulated opponents' known policies; independent benchmark opponents (blueprint, a best-responder); river reference from the in-repository solver; measured response and turn frequencies from real hands; a decision margin for model error.

## Version 0.6.0: strategy

Documents: [STRATEGY_AUDIT.md](docs/bot/STRATEGY_AUDIT.md) (audit, the recorded hand, defects, remaining weaknesses), [STRATEGY_LIBRARY.md](docs/bot/STRATEGY_LIBRARY.md) (packs, import formats, missing data), [STRATEGY.md](docs/bot/STRATEGY.md) section 8 (the mathematics of the new engine).

Evidence: the three local debug bundles. Seventeen replayable hand records are kept anonymised in `tests/bot/fixtures/live-2026-11-13-hands.json`.

**The hand.** Fixture `c-12`: Hero limp-called a raise with 5d 3h against advice, flop 5h 9d Kh, big blind checks, raiser still to act. Recorded advice: bet 9 into 28. Cause: not a "bet any pair" rule. A called bet was valued as a showdown with no further betting; a check was charged for a forced call; the big blind's check to the raiser deleted its strong hands; the raiser was modelled like any other player. Now: check +3.4, bet small +2.6. The engine no longer prefers the lead here, by a narrow margin.

**Confirmed defects (each with a test that fails on the old engine):** one-round horizon; checking valued below folding; no betting lead; strength measured against all possible hands instead of ranges; range collapse on unlikely lines; a raise's width read from the seat instead of the line; realization discount on all-in calls; charts used outside their assumptions without saying so; nothing marking an off-range hand.

**Changes.**
- `strategy/postflop.ts` (new engine): this street and the next street played out; follow-ups are plans chosen on the average; pessimistic second scenario.
- `ranges/range-model.ts`: strength inside the player's own range and against the others' ranges; betting lead; calibrated to the population priors already in the code.
- `strategy/spot.ts`: preflop raiser, betting lead, position, bet names, off-range flag.
- `strategy/villains.ts`: opponent ranges from chart packs where a line is covered; Hero's perceived range, separate from Hero's cards.
- `strategy/library/`, `sim/bot/ranges.ts`: packs, validation, importers (JSON, text, CSV), coverage report.
- `strategy/postflop-v1.ts`: the 0.5.1 engine, frozen. Checked: `engine: 'v1'` gives decisions identical to the 0.5.1 commit at all 39 recorded decision points (action, every EV, explanation, ranges).
- Explanations: spot line, bet type and purpose, modelled replies, plan, and the warnings out-of-distribution / model-dependent / lower confidence.
- Not changed: tracking, button reading, legal-action validation, the interface, the modes. Autonomous play stays off unless authorised.

**Benchmark.** Written at the time: "not completed". That was wrong: the run finished after the checkpoint and is reported under "Version 0.6.1" above. Before it, there was a pilot on a development seed, run before the last two parameter changes (how a measured fold rate is applied, and the pessimistic scenario):

| Table (3,000 hands each, seed 31) | v2 bb/100 | v1 bb/100 | Paired difference (v2 − v1) |
|---|---|---|---|
| Six-handed, four archetypes and one equity-threshold player | +107.7 ± 48.1 | +107.9 ± 55.3 | −0.2 ± 37.3 |
| Six-handed, three equity-threshold players, a calling station, a random player | +387.0 ± 109.1 | +461.3 ± 126.3 | −74.3 ± 75.1 |
| Nine-handed mixed (includes a calling station) | +394.5 ± 90.3 | +447.5 ± 114.4 | −53.0 ± 72.8 |
| Heads-up against the equity-threshold player | +48.7 ± 24.6 | +51.9 ± 27.4 | −3.1 ± 13.9 |
| Heads-up against the original repository engine | −15.2 ± 31.1 | −21.7 ± 48.4 | +6.5 ± 55.9 |
| Three-handed against two v1 seats | −6.1 ± 31.6 | −32.1 ± 26.0 | +26.0 ± 39.0 |

No difference is significant. The two tables with a calling station lean toward the old engine; that was the reason for the later change to how measured fold rates are applied, and its effect has not been measured. Simulated opponents are programs, most of them built from the old engine's own opponent model.

**Solver comparison: none.** No authorised solver output is available, so decision quality against solver play is unmeasured. The scenario suite checks properties instead: 97 of 97 hold for the new engine, 85 of 97 for the old (design set and held-out set; `reports/scenarios-2026-11-14.md`).

**Open issue.** Heads-up, the new engine still prefers a small lead with bottom pair into a wide button range (bet +41.8, check +27.1 at 10/20), labelled "thin bet". A solver checks that hand. It follows from the modelled replies (button folds 30%, raises 10%; after a check it bets 60%). Without a reference it has been left as the model's output rather than overridden by a rule.

## Version 0.5.1: action buttons

Evidence: `debug_bundles/poker-bot-debug-2026-11-13T20-06-04-008Z.json` (local, git-ignored), anonymised copy `tests/bot/fixtures/live-2026-11-13b.json` (5 hands, 211 frames, recorded by 0.5.0 at a nine to ten handed 2/5 table).

- **Recorded:** with nothing to call, PokerNow shows `[Bet 5] [Bet] [Check] [Fold]`. The "Bet 5" button has the class list `button-1 action-button call with-tip call green`, the same as the Call button. Hero (big blind, 4d 9c) saw this on the flop, turn and river of one hand (frames 213 to 226); 0.5.0 reported "call button shows 5, engine computes 0" each time and gave no recommendation. The turn tracking itself was right: Hero's turn, nothing to call.
- **Root cause:** `PokerNowDom.readControls` selected `button.call` by CSS class and took the number at the end of its text as the call amount, without reading the word in front of it.
- **Second effect of the same defect:** the click driver used the same selector, so a "call" would have pressed "Bet 5". It never ran (autonomous mode has not been used), and the click guard would have required a matching amount, but it was wrong.
- **Fix:** `src/bot/adapter/pokernow/controls.ts` classifies every button by label text into fold, check, call, bet, raise, all-in, pre-action or other, with amount, size-shortcut flag, visibility and enabled state. `ControlsObs` gains `wagerKind`, `presets`, `allIn` and the classified list; `call` is set only by a button that says Call. Reading, validation, the click guard and clicking all use this one representation.
- **Diagnostics:** a mismatch message now carries the street, Hero's chips in front, the highest bet and every button as read; the same is stored per frame in the debug bundle and shown on the Diagnostics tab under "Action buttons".
- **Result on the recording** (buttons re-classified from the stored texts): no blocker on any settled frame, all 23 genuine Hero-turn frames usable, a recommendation on each of the three free-check streets (check or bet, never fold).
- Strategy code was not changed. The free-check rule from 0.4.0 already keeps fold out of the options when checking is free; the tests confirm it on these frames.

Also seen in this recording and **not fixed**: one hand starts with 2 dead chips in the middle (the pot shows "2 total 9" with blinds 2 and 5). The engine pot is 2 lower than the table for that hand; it is reported as a warning and decisions continue with a pot 2 chips too small.

## Version 0.5.0: engine

Evidence: `debug_bundles/poker-bot-debug-2026-11-13T19-25-50-823Z.json` (kept local, git-ignored), anonymised copy `tests/bot/fixtures/live-2026-11-13.json`. Details in [TRACKING.md](docs/bot/TRACKING.md) section 0.

| Confirmed failure in the recording | Root cause | Fix |
|---|---|---|
| Hand 3, frames 57 to 60: Hero is the big blind with QcQd, PokerNow shows "Your Turn" with a check button, bot says "engine expects no further action". Engine pot 12, table 10. | A sitting-out player (drawn with the `fold` class, no cards, no chips) was counted as dealt in and given the big blind. Hero's blind was read as a call, so the round "closed" when the small blind completed. | Dealt in means cards or chips at the first frame. |
| Hands 2, 3 (flop), 4, 5: the hand is declared complete while it is still being played. Hero's turns at frames 86 and 106 get no recommendation. | PokerNow leaves the acting-seat highlight on the seat that just acted for 0.2 to 0.9 s. 0.4.0 read that as "the action passed everyone else" and folded them. | A highlight on a seat with nothing to decide is ignored for 1.5 s; deductions that would end a hand while someone is shown acting are withdrawn. |
| Hand 5: engine pot 3, table 2. | The small-blind seat sat out and no small blind was posted. | Dead small blind in the rules engine; the blind layout is chosen from the chips shown. |

Corrected from 0.4.0: its leading hypothesis (PokerNow's fold marker is not recognised) is not supported by the recording; folds are displayed and read. The 0.4.0 changes that stand are the removal of assumed calls, blockers instead of a confidence score, the recommendation lifecycle and the recorder.

Emergency stop: confirmed in code and by test to be independent of tracking and recommendations. It only disarms clicking. The recording was made in recommend mode with the stop off.

## Version 0.5.0: interface

- **Live page**: one status pill (Ready, Waiting, Reconnecting, Needs attention, Paused); Hero's cards as cards with position, stack and effective stack; five board slots; one large recommended action (FOLD, CHECK, CALL n, BET n, RAISE TO n, ALL-IN) or a plain message (Waiting for your turn, Waiting for the next hand, You folded, You're all-in, Decision unavailable — turn tracking mismatch, Bot paused, Reading table information); whose turn it is and whether the table confirms it; pot, amount to call, blinds, opponents, heads-up or multiway; players list (name, position, stack, last action, status) with Hero, the actor, folded, all-in, not dealt in and sitting out distinguished, no horizontal scrolling; recent actions.
- **Under the recommendation**, collapsed: every option with EV where the engine computed one, the full reasoning, opponent ranges. No value is shown that the engine did not produce.
- **Diagnostics tab**: everything that was there, in collapsible sections (state checks, turn tracking, timeline, participation, system, tracker messages, discrepancies, debug bundle, page elements, log). Nothing was removed and no check was loosened.
- **Overlay**: Hero cards, position, pot, players remaining, current actor, recommendation or status, emergency stop. Drag by the header; minimise with the header button (the header then shows the recommendation); position is remembered.
- Presentation logic is in `src/bot/ext/view.ts` (pure functions, tested on the recorded states).

## Test results for 0.7.0 (2026-11-16)

| Check | Command | Result |
|---|---|---|
| Full suite | `npm test` | 1,136 of 1,136 in 87 files (1,042 in 79 at 0.6.1), 525 s |
| Bot suite | `npm run test:bot` | 358 of 358 in 23 files (264 in 15 at 0.6.1) |
| Type check, build | `npm run build` | clean; extension built at 0.7.0 |
| Type check of the offline tools | `npm run typecheck:tools` | clean (new: the `sim/` tools were not type-checked before) |
| Recommend-only browser check | `npm run bot:e2e:recommend` | 32 of 32 (`reports/e2e-extension-recommend-only-2026-11-17.md`); first run since 0.5.1 |
| Dashboard browser check | `npm run bot:e2e:dashboard` | 40 of 40 (`reports/e2e-dashboard-2026-11-17.md`): every tab at two widths, popup, hand / table / profile deletion, reload, recording after deletion |
| New tests against the unfixed tracker | `tests/bot/live-2026-11-16.test.ts` before the fixes | 7 of the first 10 failed as intended (the other 3 are "still caught" cases) |
| Autonomous browser check | `npm run bot:e2e` | Not run. Autonomous clicking was not exercised in this version. |
| Live site | | Not tested. Everything above is the stand-in table or recorded frames. |

## Test results for 0.6.1 (2026-11-16)

| Check | Command | Result |
|---|---|---|
| Bot suite | `npm run test:bot` | 264 of 264 pass (257 earlier, 7 new: 3 uncertainty, 4 engine selection) |
| New tests against the unfixed engine | `npx vitest run tests/bot/postflop-uncertainty.test.ts` before the fix | 3 of 3 fail, as intended |
| Full suite | `npm test` | 1,042 of 1,042 pass in 79 files (671 s), run alone |
| Type check, build | `npm run build` | clean; `dist/` is 0.6.1 |
| Benchmark reproduction | `npx tsx sim/bot/strategy-diag.ts --exp repro` on a clean checkout of `921447a` | both engines identical to the 2026-11-14 report |
| Diagnosis experiments | section 11 of the diagnosis | all completed; none stopped or skipped |
| Browser checks | `npm run bot:e2e:recommend` | **Not run** for 0.6.0 or 0.6.1. The extension builds; the new explanation lines have not been looked at in Chromium. |
| General benchmark | `npm run bot:bench` | Not re-run; `reports/bench-2026-11-13.md` describes the 0.5.1 engine. |

## Test results for 0.6.0 (2026-11-14)

| Check | Command | Result |
|---|---|---|
| Bot suite | `npm run test:bot` | 257 of 257 pass (205 earlier, 52 new: 25 strategy regression, 22 library, 5 scenario). Run before three last edits (an explanation string, two unused names). |
| Strategy files after those edits | `npx vitest run tests/bot/strategy-v2.test.ts tests/bot/library.test.ts tests/bot/scenarios.test.ts tests/bot/strategy-sim.test.ts` | 75 of 75 pass |
| Old engine on the new regression tests | same tests, `engine: 'v1'` assertions | The tests assert the old behaviour directly: v1 recommends the lead in `c-12`, values a check at −1.6 in `c-4`, fails 12 of 97 scenario properties |
| Baseline fidelity | `engine: 'v1'` against the 0.5.1 commit | identical at 39 of 39 recorded decision points |
| Type check, build | `npm run build` | clean; `dist/` is 0.6.0 |
| Lint | `npx eslint` | 0 errors (warnings only) |
| Decision scenarios | `npm run bot:scenarios` | v2 97 of 97 properties, v1 85 of 97 ([report](reports/scenarios-2026-11-14.md)) |
| **Full suite** | `npm test` | **Not completed.** Stopped by the system for low memory while running next to the benchmark. Not restarted. The 726 tests outside `tests/bot` cover code this change did not touch, but that is an inference, not a result. |
| Strategy benchmark | `npm run bot:strategy-bench` | Recorded here as not completed; it did complete. See 0.6.1. |
| Browser checks | `npm run bot:e2e:recommend` | **Not re-run** for 0.6.0. The extension builds; it has not been loaded in Chromium with the new engine. |
| General benchmark | `npm run bot:bench` | Not re-run; `reports/bench-2026-11-13.md` describes the 0.5.1 engine. |

## Test results for 0.5.1 (2026-11-13)

| Check | Command | Result |
|---|---|---|
| Full suite | `npm test` | 983 of 983 pass (74 files, about 10 minutes) |
| Bot suite | `npm run test:bot` | 205 of 205 (181 earlier, 24 for action buttons) |
| Button tests before the fix | `tests/bot/controls-dom.test.ts` on 0.5.0 code | 3 of 5 failed, as expected (Bet 5 read as a call of 5; "call" clicks the Bet shortcut) |
| Real-recording tests before the fix | `tests/bot/live-replay.test.ts` on 0.4.0 code | 8 of 10 failed, as expected |
| Type check, lint, build | `npm run build`, `npx eslint` | clean (lint warnings only) |
| Built extension in Chromium, recommend-only, stand-in table | `npm run bot:e2e:recommend` | 32 of 32 ([report](reports/e2e-extension-recommend-only-2026-11-13.md)) |
| Replay of the first real bundle | `npm run bot:replay -- debug_bundles/<file>` | 5 hands valid, 0 divergences, Hero turns usable 6 of 6 |
| Second real bundle, buttons re-classified | `tests/bot/controls.test.ts` | 5 hands valid, no settled blocker, 23 Hero-turn frames usable |
| Autonomous browser check, benchmark | `npm run bot:e2e`, `npm run bot:bench` | Not re-run (out of scope; strategy unchanged) |

One earlier synthetic test changed: scenario 21 now expects a highlight on a folded seat to be "lagging" for 1.5 s before it is a disagreement, because that is what the real page does.

## Remaining problems

- **Not seen on the live site**: the new dashboard, the table manager, and the seven tracking rules. They were checked on the stand-in table and on recorded frames.
- **Hands already stored keep their old status.** The stored summaries do not hold the observations, so they cannot be re-evaluated; new hands get the new checks. Profiles built before 0.7.0 left out most all-in hands.
- **Strategy**: neither engine is shown to be better. Version 2 is too passive on the river when nothing has been bet (measured against a solver reference with its own ranges); its EV numbers are 5 to 11 bb too low in six-handed pots at the simulated tables; every opponent-response number is still hand-set; the weak out-of-position lead is unchanged.
- **Three hands in the recording** show large bets and raises whose value rests on unmeasured fold frequencies (audit, last section).
- **Data**: no dataset downloaded; importers not run on real files; no calibrated frequency exists.
- **Seat numbers** shift by one when Hero is not seated, so a result across that change cannot be cross-checked.
- A showdown where nobody shows, and a pot paid differently when a player then leaves, remain unverifiable and are reported as such.
- Hero's own profile appears in the Opponents list. The Tables list is not paged.
- Hands that never completed leave recommendations and frames with no hand summary until their table's history is deleted.

## Next steps

0. One live session with 0.7.0 in recommend mode, then export a debug bundle: confirms the tracking rules and gives the first hands with a stack check.
1. Your PokerNow logs into a git-ignored folder, and decisions on the roadmap's sources. Then real response frequencies through the calibration framework.
2. River betting when nothing has been bet: find why version 2 values those bets too low, with the river reference as the test and the independent-opponent benchmark as the guard.
3. The multiway EV scale.
4. Larger reference samples per kind of spot.

Strategy changes remain gated by the acceptance rule in the roadmap: no significant loss across opponent families and seeds, scenario properties holding.

## Version control

- Private repository: `pokernow-autonomous-bot` (remote `private`), default branch `autonomous-bot`. `origin` is never pushed to. No force-pushes.
- `debug_bundles/` and `diagnostics/` are git-ignored (real names and table ids). Fixtures made from them go through `sim/bot/make-fixture.ts`, which replaces names and the table id.

## Log

- 2026-11-12: baseline verified (778 tests, build). Core engine, equity, profiles, strategy, simulator and adapter written.
- 2026-11-13: v0.3.0 (`96685c3`): extension, dashboard, storage, benchmark, first push.
- 2026-11-13: v0.4.0 (`af85cb5`): tracker rewrite around observed versus predicted actor, recorder, debug bundle, replay.
- 2026-11-13: v0.5.0 (`4ffaf72`): first real debug bundle analysed; sitting-out seats, highlight lag and dead small blind fixed against it; dashboard and overlay redesigned.
- 2026-11-13: v0.5.1: second real bundle; action buttons classified by label ("Bet 5" was read as "Call 5").
- 2026-11-14: v0.6.0: strategy audit against recorded hands; postflop engine and opponent model replaced (two-round look-ahead, betting lead, range-aware strength); strategy library and importers; scenario suite. Full test suite and benchmark not completed (machine low on memory).
- 2026-11-16: v0.6.1: Phase 2.1. Benchmark status corrected and verified; v2 deficit traced to the postflop engine; uncertainty defect fixed; weak-lead cause identified; data roadmap written. No strategic behaviour changed.
- 2026-11-16: v0.7.0: dashboard and popup rebuilt, table manager, scoped deletion, database v3; audit of the long recording, seven tracking fixes, result check against the next hand's stacks; Phase 2.2 instruments (reference evaluator, independent opponents, river solver reference, model adapter, data pipeline, calibration framework). No strategy behaviour changed.
