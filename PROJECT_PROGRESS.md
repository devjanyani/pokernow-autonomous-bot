# Project progress

Last updated: 2026-11-13. Branch `autonomous-bot`. Version 0.5.1.

Detailed documents: [docs/bot/README.md](docs/bot/README.md) (install and use), [TRACKING](docs/bot/TRACKING.md) (state reconstruction, what the real recording showed, debug bundle, next live test), [ARCHITECTURE](docs/bot/ARCHITECTURE.md), [STRATEGY](docs/bot/STRATEGY.md), [STORAGE](docs/bot/STORAGE.md), [LIMITATIONS](docs/bot/LIMITATIONS.md).

## Where things stand

**0.5.1 (latest):** a second real recording showed tracking working on all five hands and one new failure: PokerNow's "Bet 5" shortcut was read as "Call 5", which blocked Hero's free check on the flop, turn and river. Buttons are now classified by their label. Details in "Version 0.5.1" below.

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

## Test results (2026-11-13)

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

- Dead money at the start of a hand (seen once: 2 chips) is not modelled; the engine pot is low by that amount for the hand.
- An all-in player's stack is not a number on the page; it is treated as unknown and skipped in stack checks.
- The 0.5.1 fix has been checked against recorded button texts, not yet seen running on the live page.
- Two recordings only. Not yet seen live: heads-up and short-handed tables, antes, straddles, a dead big blind, all-in run-outs with side pots, showdowns involving Hero, Hero betting or raising.
- Two frames of the recording show Hero's turn for 80 to 90 ms before Hero is folded (probably a pre-selected fold; that is an inference). No recommendation can be read in that time.
- At frame 64 PokerNow showed "Your Turn" with no action buttons readable for one frame; the tracker agrees on the actor but the controller waits for the buttons. Harmless there (Hero folded 70 ms later), worth watching.
- The bundle's log mentions earlier hands on another table marked "reconstruction invalid"; their frames were not in the export, so they could not be examined.
- A player who folds before the first frame of a hand is left out of the hand (same picture as sitting out). Blinds and order stay right; early-position labels can be off by one for that hand.
- Strategy limits are unchanged (see LIMITATIONS.md).

## Next steps

1. Another recommend-only session with recording on: more hands, a different table size if possible, and export "Last 20 hands" afterwards. Put the bundle in `debug_bundles/`.
2. Replay it; add it as a second fixture; fix whatever it shows.
3. Site prompts, straddles, dead big blind once seen in a recording.
4. Then the strategy items in LIMITATIONS.md.

## Version control

- Private repository: `pokernow-autonomous-bot` (remote `private`), default branch `autonomous-bot`. `origin` is never pushed to. No force-pushes.
- `debug_bundles/` and `diagnostics/` are git-ignored (real names and table ids). Fixtures made from them go through `sim/bot/make-fixture.ts`, which replaces names and the table id.

## Log

- 2026-11-12: baseline verified (778 tests, build). Core engine, equity, profiles, strategy, simulator and adapter written.
- 2026-11-13: v0.3.0 (`96685c3`): extension, dashboard, storage, benchmark, first push.
- 2026-11-13: v0.4.0 (`af85cb5`): tracker rewrite around observed versus predicted actor, recorder, debug bundle, replay.
- 2026-11-13: v0.5.0 (`4ffaf72`): first real debug bundle analysed; sitting-out seats, highlight lag and dead small blind fixed against it; dashboard and overlay redesigned.
- 2026-11-13: v0.5.1: second real bundle; action buttons classified by label ("Bet 5" was read as "Call 5").
