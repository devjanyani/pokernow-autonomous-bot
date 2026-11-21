# Development session log

2026-11-21: Phase 3.0, v4 audit, research and architecture, from commit `bf8bf21` (v0.9.1). Documents only plus one
measurement script; no strategy or extension code changed. The 0.9.1 log is in git history at `bf8bf21`.

## Current state (checkpoint, Phase 3.0)

- **Deliverables:** `docs/bot/V4_PREFLOP_ARCHITECTURE_AUDIT.md`, `docs/bot/V4_HERO_IMAGE_AND_EXPLOITATION.md`,
  `docs/bot/V4_IMPLEMENTATION_ROADMAP.md`, `reports/V4_BASELINE_AND_GAPS.md`; raw measurements in
  `reports/v4-*-2026-11-21.md`.
- **Measurement tool:** `sim/bot/v4-baseline.ts` (`coverage` 8 s, `widths` 35 s, `hero --hands 3000` 3 min,
  `hero --v3 --hu-only --hands 3000` 2.5 min; one process at a time, no memory problems). Audit seeds 31000-31002.
- **Main findings:** see the checkpoint in PROJECT_PROGRESS.md and the ranked list in reports/V4_BASELINE_AND_GAPS.md §5.
- **Checks run:** `npm run typecheck:tools` passes; `npx eslint sim/bot/v4-baseline.ts` 0 errors (29 `no-console`
  warnings, as in the other tools); `npx vitest run tests/bot/engine.test.ts tests/bot/library.test.ts --maxWorkers=4
  --minWorkers=1` 56 / 56 (positions and library; a two-file run needs `--minWorkers=1`, otherwise vitest rejects the
  thread options). The full suite was not rerun: no file under `src/` changed since the verified 1,211 / 1,211 run of
  0.9.1.

## To resume

Phase 3.1 (coverage + evaluation harness) only on instruction: docs/bot/V4_IMPLEMENTATION_ROADMAP.md §1.

## Rules kept

No strategy algorithm, model, default or setting changed; v2 default; v3 experimental; no retraining or large
benchmark; nothing uploaded; no claim that v4 will be stronger.

---

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
