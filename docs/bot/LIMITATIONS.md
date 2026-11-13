# Status, limitations, failure modes and next steps

Dated 2026-11-13. Numbers are from `reports/bench-2026-11-13.md` and `reports/e2e-extension-2026-11-13.md`.

## 1. What is implemented and tested

Tested means an automated test or a scripted run in this repository exercises it and passes (`npm run test:bot`: 119 tests; `npm run bot:bench`; `npm run bot:e2e`).

| Area | Evidence |
|---|---|
| Rules engine, 2 to 10 players: positions from the button, heads-up blinds, min-raise, short all-ins that do not reopen betting, antes, straddle, side pots, split pots, odd chips | `tests/bot/engine.test.ts`; 1,350 random-play hands across all sizes conserve chips with zero illegal states |
| Hold'em-only gate: Omaha and four-card hands are rejected | engine, tracker, DOM adapter and log tests |
| Seven-card evaluation, ties, kickers | original exhaustive suite plus `equity-profile.test.ts` |
| Multiway equity against 1 to 9 ranges with joint sampling, ties, standard error, progressive refinement | benchmarks within Monte Carlo error of published values; mean error 1.1 points at 400 samples, 0.23 at 10,000 |
| Side-pot aware payouts | unit tests |
| Heads-up table / heads-up pot / multiway selection, scenarios A to E | engine and strategy tests |
| Preflop decisions at every table size and stack depth | strategy tests; zero illegal actions in every simulation |
| Postflop EV engine, legal action guarantee, deterministic per seed | strategy tests |
| Opponent profiles: opportunity counting, no double counting, shrinkage, classification, exploit gating | unit tests; counted VPIP and PFR equal ground truth exactly over 3,000 hands for five opponents |
| Decision-time controller and anytime loop with cancellation | unit tests |
| Offline simulator: 2 to 10 players, uneven stacks, antes, straddles, tournaments with blind levels, duplicate rotation, paired comparison, reproducible by seed | simulator tests and the benchmark report |
| State reconstruction from observations: exact on simulated hands at 2, 3, 6, 9 and 10 players; repeated observations add nothing; with 40% of observations dropped, 87 of 120 hands are still exact and none of the rest is accepted as valid | `adapter.test.ts` |
| Executor guards: stale, duplicate, out-of-turn, illegal, disarmed, mismatched controls, bad bet read-back, concurrent calls | `adapter.test.ts` |
| Storage: one-transaction hand plus profiles, idempotent by hand id, repair of corrupt rows, pruning, survives a worker restart | `ext.test.ts` with an in-memory IndexedDB |
| Controller: plays a simulated table in autonomous mode with one accepted click per decision; never clicks in manual, recommend, unauthorised or stopped states | `ext.test.ts` |
| The built extension in real Chromium against a local stand-in table: loads, service worker registers, tracks, recommends, plays when authorised, stops on emergency stop, stores hands / profiles / decisions, dashboard and popup render | `npm run bot:e2e`, 21 of 21 checks |

## 2. Implemented but not verified

| Area | Why it is unverified |
|---|---|
| **PokerNow selectors** (`src/bot/adapter/pokernow/dom.ts`) | Never run against the live site. They come from the repository's earlier scraper and public descriptions. The DOM tests and the browser check use markup written for this project. Expect to adjust selectors on first contact; the Diagnostics tab shows which elements were not found and Settings accepts overrides without a rebuild. |
| Reading the action clock | The timer selector is a guess. When it does not match, the assumed clock from Settings (default 20 s) is used. |
| Detecting sitting-out, folded and to-act seats on the live page | Class names are assumptions. Since v0.4.0 a fold no longer depends on its class: it is deduced from the action passing a seat that faced a bet with an unchanged stack. The acting-seat highlight and Hero's turn signal are still assumptions. |
| **Turn tracking and reconciliation (v0.4.0)** | 36 regression tests on synthetic tables and a recommend-only browser check on the stand-in table with fold markers hidden. Not confirmed on the live site; see [TRACKING.md](TRACKING.md) sections 1 and 8. |
| Typing a bet into PokerNow's input and submitting it | Works on the fixture form. The live control may need a different event sequence. |
| Loading in Google Chrome specifically | Verified in Playwright's Chromium build. Branded Chrome no longer accepts `--load-extension`, so "Load unpacked" in Chrome itself was not automated. |
| PokerNow log import | Parser written from the documented line formats and tested on a hand-written log, not on a real export. In particular whether "calls N" is the amount added or the street total is handled both ways and reported when neither matches. |
| Showdown reveals, mucked hands, run-it-twice on the live page | Run-it-twice boards are not handled by the tracker. |
| Strength against real opposition | No hand has been played against humans or other competition bots. |

## 3. Not implemented

- Live straddle detection. The engine and simulator support a straddle; live, a straddle looks like a raise and the hand is flagged when the straddler uses its option.
- Missed or dead blind posts, dead button with a missing small blind, bomb pots, run-it-twice, insurance prompts, rabbit hunting.
- Automatic handling of site prompts (rebuy, "I'm back", show or muck). The earlier extension clicked these; this one does not.
- ICM or any tournament-specific strategy. Tournaments are played for chip EV.
- Rake in EV.
- Multi-street planning or a game-tree solve. The trained heads-up blueprint in `blueprint/` is not used by the new agent.
- A stable player identity from the page. Profiles are keyed by display name per table.
- Web Worker or WebAssembly (measured as unnecessary at the current sample counts).
- Decisions are not included in the JSON export (profiles, hands and diagnostics are).

## 4. Measured strength, and what it does not show

Duplicate rotation, 100bb, 400 samples per decision, 95% intervals.

| Opposition | Result (bb/100) |
|---|---|
| Original engine with its trained blueprint, heads-up, 10,000 hands | −10.6 ± 27.6: not significant |
| Same at 2,000 samples per decision | −9.7 ± 27.6: more samples do not help, so the limit is the model, not sampling noise |
| Equity-threshold bot, heads-up, 6,000 hands | +60.6 ± 20.8 |
| Random and calling-station | +350 and +941 |
| Four archetypes, heads-up | +53 to +163 |
| Mixed field, 2 to 10 players | +63 to +545 at every size |
| Opponent profiles on versus off, same deals, six-handed | +113.4 ± 38.3 in favour of profiles |

Read these with care:

- **Heads-up it is statistically level with the engine it replaces**, on this seed and on an earlier 30,000-hand run before the last strategy change (+7.6 ± 15.7). It is not shown to be better.
- **Six-max versus the original engine was not completed.** The attempt was stopped by the machine running low on memory. `npm run bot:bench -- --legacy6` runs it.
- The archetype opponents are generated by the same behaviour model the bot uses to predict them, so those margins, and the size of the profiling gain, are optimistic.
- The mixed-field numbers at 7 or more players are inflated by a calling station joining the field.
- 30 tournaments (10 wins) is a small sample.

## 5. Mathematical approximations

Detailed in [STRATEGY.md](STRATEGY.md). The main ones:

1. Opponent ranges are percentile bands of an equity ordering, not solver ranges.
2. Opponent behaviour is a logistic model in a one-number hand strength. It ignores blockers, board texture beyond draw outs, and nut advantage.
3. EV is a one-round look-ahead with a realization factor in place of later streets.
4. When Hero is raised the other callers are assumed to fold; a raise behind Hero's call is treated as a call.
5. EV standard errors cover Monte Carlo noise only.
6. 6-max charts are applied by players-behind at larger tables and at stack depths they were not made for.
7. Preflop EVs are not estimated for chart decisions; only all-in calls are computed.
8. All-in calls ignore players still to act except through a fixed margin.

## 6. Failure modes and what the bot does

| Situation | Behaviour |
|---|---|
| PokerNow changes its markup | Elements show as missing in Diagnostics; no hand starts; nothing is clicked. |
| A card cannot be read | It is reported as a read problem, never guessed; Hero's cards stay unknown and no decision is made. |
| Joined mid-hand after the flop | Waits for the next hand. |
| An action was missed and cannot be inferred | Hand marked invalid; observing only until the next hand. On Hero's turn the panel says "Decision unavailable — state reconciliation required" with the reason. |
| A fold is not displayed in a way the adapter recognises | Deduced when the action has passed the seat, it faced a bet and its stack is unchanged; marked as deduced in the timeline. |
| Table and engine disagree (stacks, chips in front, call amount, whose turn) | Blocker: no recommendation, the reason is shown and logged, and the frames are recorded for the debug bundle. A pot-only difference is a warning. In autonomous mode the deadline fallback (check or fold) still applies if that option is on. |
| The page is mid-update | Nothing is deduced or reported until the same snapshot has been seen for 120 ms. |
| Two opponent actions inside one 250 ms read interval that reverse each other (raise then re-raise by the same pair) | Detected as "intermediate raises were missed": hand invalid. |
| A player folds although a check was free | Treated as a probable missed bet: the hand is kept out of profiles. |
| The hand or street changes while computing | The computation is cancelled; the executor rejects stale requests. |
| The click's outcome is unknown | Reported as unverified; that decision point is never clicked again. |
| The bet input does not accept the amount | Nothing is submitted; one fallback to check, call (if its EV was positive) or fold. |
| Service worker stopped | No effect on decisions. Messages wake it; a hand that fails to store is lost from history. |
| Extension reloaded while the table is open | The old content script stops sending; reload the table tab. |
| Two players share a display name | Their profiles for that table are not stored. |
| A player renames | Becomes a new profile. |
| Omaha or another variant | Reported as unsupported; observing only. |
| The earlier overlay extension is also installed | It will click on its own. Remove it. |

One known gap in this list: the timeout fallback clicks through the driver directly (it runs only when the state is not trusted, so the executor's state checks cannot apply). It is limited to check or fold, once per turn, and only on an authorised table.

## 7. Remaining improvements, in priority order

1. **Validate tracking on a real table in recommend mode and export a debug bundle** ([TRACKING.md](TRACKING.md) section 8). Replay it, correct selectors from the recorded class lists, compare the timeline with PokerNow's log, and keep the bundle as a regression fixture. Nothing else matters until this is done.
2. **Recommend-mode soak** on that table: compare stored hands with PokerNow's own log, using the log importer as the reference, before enabling autonomous mode.
3. Handle site prompts (rebuy, sit back in, show or muck) and straddles on the live page.
4. Run the six-max match against the original engine, and add an external reference opponent, to get a strength measurement that does not share the bot's own model.
5. Use the trained heads-up blueprint at true heads-up tables near 100bb, where it is at least as good as the new agent, behind a measured comparison.
6. Replace the percentile preflop ranges for 7 to 10 handed early seats and for 20 to 60bb stacks with solved charts.
7. Calibrate the behaviour model's constants from imported hand histories rather than by hand, and test it on opponents outside its own family.
8. Two-round look-ahead on the flop and turn in place of the realization factor.
9. ICM for tournament formats; rake.
10. Read a stable player id from the page so profiles survive renames and table changes.
