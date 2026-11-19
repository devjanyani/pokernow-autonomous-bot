# Release 0.9.1: verification record (2026-11-19)

Authorised execution for experimental version 3 and per-decision action scheduling
([docs/bot/AUTHORISED_EXECUTION.md](../docs/bot/AUTHORISED_EXECUTION.md)). No strategy algorithm changed.
All checks below were run one at a time on the final code (no source change after the execution check).

| Check | Command | Result |
|---|---|---|
| Full unit suite | `npx vitest run --maxWorkers=4` | **1,211 / 1,211 passed**, 92 files, 0 skipped, 690 s |
| Chromium: autonomous version 2 | `npm run bot:e2e` | 24 / 24 ([e2e-extension-2026-11-19.md](e2e-extension-2026-11-19.md)) |
| Chromium: recommendation-only | `npm run bot:e2e:recommend` | 32 / 32 ([e2e-extension-recommend-only-2026-11-19.md](e2e-extension-recommend-only-2026-11-19.md)) |
| Chromium: version 3 recommendation-only | `npx tsx sim/bot/e2e-v3.ts` | 27 / 27, 0 clicks without the version 3 permission ([e2e-v3-2026-11-19.md](e2e-v3-2026-11-19.md)) |
| Chromium: authorised execution and scheduling | `npm run bot:e2e:exec` | 23 / 23 ([e2e-exec-2026-11-19.md](e2e-exec-2026-11-19.md)) |
| Type-check (extension, tools) | `tsc --noEmit` | pass |
| Lint | `npm run lint` | 0 errors, 185 warnings (existing categories: console output in tools, empty test stubs) |
| Production build | `npm run build` | pass, `dist/` at 0.9.1 |

## The three earlier timeouts

An earlier full run (default worker count, about 19 workers on this 20-thread machine) failed three tests in
`tests/bot/scheduler.test.ts` on vitest's 5 s default timeout: 11 (v3 to v2 switch), 12 (v3 execution and fallback),
12b (v3 without permission). Diagnosis:

- They are the only tests in the file that run version 3's search. Alone, with one worker: 3.7 s each (all other
  tests in the file under 1.6 s). With four workers in the full suite: 4.1-4.7 s. With about 19 workers: 6-10 s.
- The rig's clock is manual, so version 3's time budget never runs out and each search runs to its fixed deal cap
  (2,400): bounded CPU work whose result does not depend on load. Results were identical in every run.
- Cause: CPU contention plus a default timeout close to the solo run time. Not a defect: no hang, no
  load-dependent outcome, and in the extension the search is bounded by the real clock.
- The controller-level tests carry a 60 s limit (about 16 times the solo time), which only catches a genuine hang.
  The full suite is now run with `--maxWorkers=4`, which also avoids the memory pressure that stopped one run.

## Memory

One full-suite run was stopped by Claude Code for low system memory (default worker count while the user's browser
was also open, about 4.4 GB of 16 GB free). It was not restarted automatically; the verification above used four
workers and one browser instance at a time and completed without memory problems.

## Not validated

- Nothing here was run on the live PokerNow site: its clock markup, its timing, its acceptance of clicks at every moment
  and multi-table behaviour are covered only by the selectors and the local stand-in table.
- The extension cannot detect real-money games; execution relies on the per-table organiser / play-money confirmation.
- Version 3 is not shown to play better than version 2 (reports/PHASE_2_5_STRATEGY_BENCHMARK.md).
