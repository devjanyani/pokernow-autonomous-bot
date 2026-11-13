# Project progress

Last updated: 2026-11-13. Branch `autonomous-bot`. Version 0.3.0.

Detailed documents: [docs/bot/README.md](docs/bot/README.md) (install and use), [ARCHITECTURE](docs/bot/ARCHITECTURE.md), [STRATEGY](docs/bot/STRATEGY.md), [STORAGE](docs/bot/STORAGE.md), [LIMITATIONS](docs/bot/LIMITATIONS.md).

## Where things stand

The local poker bot is built and passes its offline checks. It has **not** been run on a live PokerNow table, so the page selectors are unverified and live play must not be assumed to work yet.

| Milestone | State |
|---|---|
| Original repository preserved | Tag `checkpoint/pre-autonomous-bot-2026-11-12`; remote `origin` untouched |
| Rules engine, 2 to 10 players, side pots | Done, tested |
| Multiway equity and side-pot payouts | Done, tested |
| Preflop and postflop strategy with EV estimates | Done, tested offline |
| Opponent profiles, persistence | Done, tested |
| Decision-time controller | Done, tested |
| Offline simulator and benchmark report | Done |
| State reconstruction from table observations | Done, tested on simulated hands |
| Guarded action executor | Done, tested |
| Chrome MV3 extension (content script, service worker, popup, dashboard) | Built; passes a browser check against a local stand-in table |
| Validation on a live authorised PokerNow table | **Not done** |

## Test results (2026-11-13)

| Check | Command | Result |
|---|---|---|
| Full suite, original plus new | `npm test` | 897 of 897 pass (69 files, about 11 minutes) |
| Bot suite only | `npm run test:bot` | 119 of 119 pass |
| Type check, lint, build | `npm run build`, `npx eslint "src/bot/**/*.ts"` | clean |
| Built extension in Chromium against the stand-in table | `npm run bot:e2e` | 21 of 21 checks pass |
| Benchmark report | `npm run bot:bench` | `reports/bench-2026-11-13.md` |

Benchmark headlines (duplicate deals, 100bb, 400 samples per decision, 95% intervals):

| Opposition | Bot result, bb/100 |
|---|---|
| Original engine with its trained blueprint, heads-up, 10,000 hands | −10.6 ± 27.6 (not significant) |
| Equity-threshold bot, heads-up, 6,000 hands | +60.6 ± 20.8 |
| Mixed field at 2 to 10 players | +63 to +545, zero illegal actions |
| Opponent profiles on versus off, same deals, six-handed | +113.4 ± 38.3 |

The four archetype opponents share the bot's own behaviour model, so margins against them are optimistic. Heads-up, the bot is level with the engine it replaces, not better.

## Limitations

- PokerNow DOM selectors, the bet input and the action-clock reading are untested on the live site.
- "Load unpacked" was verified in Playwright's Chromium, not in branded Google Chrome.
- The PokerNow log importer was written from the documented format, not tested on a real export.
- Six-max versus the original engine was not completed (the run was stopped when the machine ran low on memory). Opt in with `npm run bot:bench -- --legacy6`.
- Not implemented: live straddle detection, run-it-twice, site prompts (rebuy, show or muck), missed blinds, ICM, rake, multi-street planning, a stable player id from the page.
- Opponent ranges and responses are hand-set heuristics; EV standard errors cover sampling noise only.

## Remaining tasks, in priority order

1. Validate the DOM adapter on a real authorised table in manual mode; fix selectors; save real page snapshots as fixtures.
2. Recommend-mode soak on that table, comparing stored hands with PokerNow's own log, before enabling autonomous mode.
3. Handle site prompts and straddles on the live page.
4. Run the six-max match against the original engine and add an independent reference opponent.
5. Use the trained heads-up blueprint at true heads-up tables near 100bb, behind a measured comparison.
6. Solved ranges for early seats at 7 to 10 handed tables and for 20 to 60bb stacks.
7. Calibrate the behaviour model from imported hand histories.
8. Two-round look-ahead on flop and turn.
9. ICM and rake.
10. Stable player identity.

## Version control

- Private repository: `pokernow-autonomous-bot` (remote `private`), default branch `autonomous-bot`.
- Original public repository stays on remote `origin` and is never pushed to from this work.
- Practice from here on: one meaningful commit per verified milestone (tests passing), pushed to `private`. No force-pushes.

## Log

- 2026-11-12: baseline verified (778 tests, build). Core engine, equity, profiles, strategy, simulator and adapter written.
- 2026-11-13: tracker hardened against missed observations; pessimistic response scenario added to bet EV; extension, dashboard and storage built; browser end-to-end check; benchmark report; documentation; first commit and push to the private repository.
