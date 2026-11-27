# Development session log

2026-11-26: Phase 3.1b, live execution and tracking reliability (0.9.3), from `74bcad0`.

## Current state (checkpoint, v0.9.3)

- **Report:** `reports/PHASE_3_1B_RELIABILITY.md`.
- **D1, background throttling:**
  - `scheduler.ts` `waitFor` / `verdict` (expiry on the monotonic clock: `LATE_TOLERANCE_MS`, `UNRELIABLE_START_MS`,
    `CLOCK_JUMP_MS`);
  - the controller's loop-gap measurement (`LOOP_GAP_MS`), the executor `guard`, `onTime` before a bet submit, and
    `deps.loadSettings` after delayed timers;
  - `LiveState.timing` and the warning.
- **D2:** engine `extraPosts` (`post-live`, `post-dead`), tracker `reentryPosts`, and `rebuild.ts`. Fixture
  `tests/bot/fixtures/live-2026-11-21-h45.json`, anonymised; made with a throwaway script from the private bundle.
- **D3/D4/D5:** the controller's `acted` set, attempt ids in the scheduler, and `DecisionRecord.lifecycle` (schema 2).
  Manual clicks come from `PokerNowDom.userActionOf` (real clicks only).
- **Tests:** `tests/bot/reliability-31b.test.ts` (28).
- **Replay check across the 7 private bundles:** a throwaway script fed every recorded frame to `HandTracker` and
  counted valid / invalid / not-observed hands and hands with entry posts. Before → after: valid 483 → 484, invalid
  unchanged. Use the same method to check any future tracker rule.
- **Verified:**
  - full suite **1,282 / 1,282** (96 files, `npx vitest run --maxWorkers=4 --minWorkers=1`), including the 28 new tests;
  - type-check (`tsc --noEmit`, `npm run typecheck:tools`), lint (0 errors), production build: pass;
  - Chromium, built extension, stand-in table, one at a time: `bot:e2e` 24/24, `bot:e2e:recommend` 32/32,
    `e2e-v3` 27/27, `bot:e2e:exec` 28/28, `bot:e2e:dashboard` 40/40 (same counts as 0.9.2). Not run on live PokerNow.

## To resume

Only on instruction: roadmap §1.3 item 1 (a pot-odds floor judged in the harness), or Phase 3.2. Before a live test,
keep the table tab visible; the dashboard says when it is not.

---

2026-11-21, third part: live session forensic audit (documents only), from `1905518`.

## Current state (checkpoint, forensic audit)

- **Report:** `reports/LIVE_SESSION_FORENSIC_AUDIT_2026_11_21.md`. The bundle
  `debug_bundles/poker-bot-debug-2026-11-21T20-16-26-506Z.json` stays git-ignored.
- **Tools:** the existing `sim/bot/audit-bundle.ts` and `audit-hand.ts`, plus scratch scripts (not committed). The
  scratch scripts:
  - re-run the current engine at every recorded Hero point (123 of 125 live recommendations reproduced);
  - compute equity against the engine's own villain ranges (`buildTable` + `multiwayEquity`);
  - detect 1-second-grid frame cadence (background throttling).
- **How to tell bot actions from outside actions:** an executed action always has a decision record with
  `execution`. A Hero action without one was not sent by the executor.
- **Not changed:** strategy, timing, permissions and engines.

## To resume

Only on instruction: 3.1b reliability fixes D1, D2, D4, D5, then the pot-odds floor in the harness (roadmap §1.3).

---

2026-11-21, second part: Phase 3.1 and timing modes (0.9.2), from `c256433`.

## Current state (checkpoint, v0.9.2)

- **Preflop classification:** `src/bot/strategy/preflop-context.ts`. Every preflop `Decision` has
  `preflop: {situation, source, context}`.
- **Offline options:** `AgentOptions.preflopCorrections` (`precedence: 'documented'`, `consistentOpener`,
  `chartSizes`). Not used by the extension; not adopted (benchmark not better).
- **Library:** `defaultLibrary(precedence)`; Greenline spots carry `conditional` and RFI `sizing`; the size faced is
  stated as a departure.
- **Harness:** `npx tsx sim/bot/v4-bench.ts --suite main|ablation|negative|smoke`. Seeds 32000+ are development; final
  41000–41999 are reserved and unrun. Results are in `reports/phase31-bench-*.{md,jsonl}`.
- **Coverage:** `npx tsx sim/bot/v4-baseline.ts coverage [--corrected]` → `reports/phase31-coverage-{before,after}.md`.
- **Timing:** `Settings.timingMode` ('random' default | 'instant'), migration in `records.ts` `timingFields`,
  `ActionScheduler.replan`.
- **Verified:** suite 1,254 / 1,254; Chromium 24 / 32 / 27 / 40 / 28; type-check, lint, build. Vitest now needs
  `--maxWorkers=4 --minWorkers=1`.

## To resume

Phase 3.2 only on instruction: roadmap §1.2 (strengthen the opponent pool first; licensed or computed preflop data).

---

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
