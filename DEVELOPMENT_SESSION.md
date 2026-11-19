# Development session log

2026-11-19, second part: authorised execution for experimental version 3 and action scheduling (0.9.1), from commit
`00c7157` (v0.9.0). The v0.9.0 log is in git history at `00c7157`.

## Current state (checkpoint, v0.9.1)

- **Gate:** `executionStatus()` / `mayAct()` in `src/bot/ext/records.ts`: autonomous mode, no emergency stop, organiser
  confirmation, table authorised, and with v3 selected the separate `v3ExecutionOptIn` (default false, cleared without
  the confirmation). Checked on every read, again just before the click, and by the executor's re-validation.
- **Scheduler:** `src/bot/ext/scheduler.ts`; settings `randomDelay`, `minDelayMs` (4 s), `maxDelayMs` (20 s),
  `deadlineMarginMs` (3 s), `assumedClockMs` (20 s). Replaces `minThinkMs` / `maxThinkMs`.
- **Tests:** `tests/bot/scheduler.test.ts` (18, all 15 requested cases); e2e `npm run bot:e2e:exec` (23/23, stand-in
  table, real time). The stand-in table takes `clock=<s>`.
- **Verified** (reports/RELEASE_0.9.1.md): full suite 1,211 / 1,211 with `--maxWorkers=4`; Chromium 24/24, 32/32,
  27/27, 23/23; type-check, lint, build. Run the suite with `--maxWorkers=4` on this machine (the default worker
  count ran it out of memory once). Not done: a live PokerNow session.

## To resume

1. `npx vitest run --maxWorkers=4` (about 12 minutes; one process); `npm run build`; then one at a time `npm run bot:e2e`,
   `npm run bot:e2e:recommend`, `npx tsx sim/bot/e2e-v3.ts`, `npm run bot:e2e:exec`.
2. Live test on an organiser-authorised play-money table: see docs/bot/AUTHORISED_EXECUTION.md.

## Rules kept

No strategy algorithm changed; v2 default; v3 experimental and recommendation-only unless separately permitted;
table authorisation, emergency stop, legality and reconciliation checks intact; nothing uploaded.
