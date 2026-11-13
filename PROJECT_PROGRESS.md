# Project progress

Last updated: 2026-11-13. Branch `autonomous-bot`. Version 0.4.0.

Detailed documents: [docs/bot/README.md](docs/bot/README.md) (install and use), [TRACKING](docs/bot/TRACKING.md) (state reconstruction, debug bundle, next live test), [ARCHITECTURE](docs/bot/ARCHITECTURE.md), [STRATEGY](docs/bot/STRATEGY.md), [STORAGE](docs/bot/STORAGE.md), [LIMITATIONS](docs/bot/LIMITATIONS.md).

## Where things stand

The extension has been used in recommend mode on real no-money PokerNow tables. It read the table, but turn tracking was unreliable: PokerNow showed Hero's turn while the bot expected another seat, with pot and stack differences of one call. Version 0.4.0 fixes the defects found in the code for that (see below) and adds a local recorder so the next live session produces evidence that can be replayed. **The fixes are tested on synthetic tables only. They have not been confirmed on a live table.**

| Milestone | State |
|---|---|
| Original repository preserved | Tag `checkpoint/pre-autonomous-bot-2026-11-12`; remote `origin` untouched |
| Rules engine, 2 to 10 players, side pots | Done, tested |
| Multiway equity and side-pot payouts | Done, tested |
| Preflop and postflop strategy with EV estimates | Done, tested offline |
| Opponent profiles, persistence | Done, tested |
| Decision-time controller | Done, tested |
| Offline simulator and benchmark report | Done |
| Guarded action executor | Done, tested |
| Chrome MV3 extension (content script, service worker, popup, dashboard) | Built; passes browser checks against a local stand-in table |
| **v0.4.0: turn tracking, reconciliation, participation model, recommendation lifecycle** | Done, 36 regression tests |
| **v0.4.0: diagnostic recorder, action timeline, debug bundle export, offline replay** | Done, tested, exercised in a real browser |
| Confirmation of the tracking fixes on a live PokerNow table | **Not done: needs a debug bundle from a real session** |
| Autonomous play on a live table | Not attempted; stay in recommend mode |

## Version 0.4.0: what was wrong and what changed

Full analysis: [docs/bot/TRACKING.md](docs/bot/TRACKING.md) section 1. The four defects, all in code that existed:

1. A fold was recognised only from one unverified CSS class. An unrecognised fold left the engine waiting on that seat, so on Hero's turn the table said Hero and the engine said someone else.
2. When the next street appeared with a seat's action unknown, a call was assumed. That put one call too many in the pot and took it off that player's stack (the reported 19 vs 18, 258 vs 256, 98 vs 100).
3. Chip mismatches only lowered one confidence number, so such hands stayed "valid" at 0.85 or 0.70.
4. The last recommendation stayed on screen after Hero's turn ended.

These explain every reported symptom, but no log of the reported hands exists, so this is a hypothesis until a real bundle confirms it.

Changes: folds deduced from the rules (action passed a seat facing a bet, stack unchanged) and marked as deduced; no assumed calls; observed and predicted actor tracked separately; contradictions block the decision with a stated reason; per-seat participation model; recommendations tied to hand, street and state version and recomputed whenever the action returns to Hero; hand start waits for the blinds to match the button; free-check rule in one place; local recorder, timeline, debug bundle, replay.

## Test results (2026-11-13)

| Check | Command | Result |
|---|---|---|
| Full suite, original plus new | `npm test` | 933 of 933 pass (70 files, about 10 minutes) |
| Bot suite only | `npm run test:bot` | 155 of 155 pass (119 earlier tests unchanged, 36 new in `tests/bot/tracking.test.ts`) |
| Type check, lint, build | `npm run build`, `npx eslint "src/bot/**/*.ts"` | clean (lint: warnings only, no errors) |
| Built extension in Chromium, recommend-only, stand-in table with fold markers hidden | `npm run bot:e2e:recommend` | 28 of 28 checks pass ([report](reports/e2e-extension-recommend-only-2026-11-13.md)) |
| Built extension in Chromium including the autonomous phase on the stand-in table | `npm run bot:e2e` | Not re-run for 0.4.0 (autonomous play was out of scope); last result 21 of 21 on 0.3.0 |
| Benchmark report | `npm run bot:bench` | Not re-run; strategy code unchanged apart from the free-check guard. `reports/bench-2026-11-13.md` is from 0.3.0 |

The recommend-only browser check, in numbers: 4 hands, 16 Hero turns, 122 samples taken on Hero's turn of which 119 had a recommendation, 3 fell inside the 120 ms settle window and 0 were blocked; observed and predicted actor never disagreed on a settled table; no recommendation was ever shown outside Hero's turn; 17 hidden folds were deduced; the exported bundle (84 frames) replayed offline with no divergence. This shows the built extension is wired to the new tracker. It says nothing about PokerNow's real markup.

The 35 scenarios requested for regression testing are covered in `tests/bot/tracking.test.ts`; test names carry the scenario numbers.

## Limitations

- Nothing in 0.4.0 has been run on the live site. The stand-in table uses markup written for this project.
- PokerNow's real class names for folded, away and acting seats are still unknown. Folds no longer depend on them; the acting-seat highlight and Hero's turn signal still do.
- How PokerNow displays the pot mid-street, bets of folded players, and blinds after a player leaves is unknown. Pot differences are warnings; a blind in the wrong place is a visible blocker for that hand.
- Dead blinds, missed-blind posts, straddles, run-it-twice and site prompts are not handled.
- A blocked or invalid hand gets no recommendation, by design.
- "Load unpacked" was verified in Playwright's Chromium, not automated in branded Google Chrome.
- The PokerNow log importer was written from the documented format, not tested on a real export.
- Strategy limits are unchanged from 0.3.0 (see LIMITATIONS.md): heuristic opponent model, no multi-street planning, no ICM or rake; six-max versus the original engine not completed.

## Remaining tasks, in priority order

1. **Live recommend-mode session with recording on, then export a debug bundle and PokerNow's log** (TRACKING.md section 8). Replay the bundle, read off the real class names, compare the timeline with the log, fix selectors, keep the bundle as a fixture.
2. Decide blind handling for players leaving (dead blinds) once the bundle shows what PokerNow does.
3. Handle site prompts and straddles on the live page.
4. Recommend-mode soak comparing stored hands with PokerNow's log before any thought of autonomous mode.
5. Six-max match against the original engine; an independent reference opponent.
6. Trained heads-up blueprint at true heads-up tables near 100bb, behind a measured comparison.
7. Solved ranges for early seats at 7 to 10 handed tables and for 20 to 60bb stacks.
8. Calibrate the behaviour model from imported hand histories.
9. Two-round look-ahead on flop and turn; ICM and rake; stable player identity.

## Version control

- Private repository: `pokernow-autonomous-bot` (remote `private`), default branch `autonomous-bot`.
- Original public repository stays on remote `origin` and is never pushed to from this work.
- Practice: one meaningful commit per verified milestone (tests passing), pushed to `private`. No force-pushes.
- Debug bundles and site logs from live sessions go in `diagnostics/`, which is git-ignored (they contain player names and table ids).

## Log

- 2026-11-12: baseline verified (778 tests, build). Core engine, equity, profiles, strategy, simulator and adapter written.
- 2026-11-13: tracker hardened against missed observations; pessimistic response scenario added to bet EV; extension, dashboard and storage built; browser end-to-end check; benchmark report; documentation; first commit and push to the private repository (v0.3.0, `96685c3`).
- 2026-11-13: v0.4.0. Root-cause analysis of the live turn-tracking reports; tracker rewritten around observed versus predicted actor with evidence-tagged actions; reconciliation, participation model, recommendation lifecycle; recorder, timeline, debug bundle and replay; 36 regression tests; recommend-only browser check.
