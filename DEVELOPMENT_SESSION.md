# Development session log

Record of the session that started on 2026-11-16 from commit `d950658` (v0.6.1, branch `autonomous-bot`) and
ended at v0.7.0. Priorities, in order: (1) dashboard, popup and history management; (2) audit of the long-game
recording; (3) Phase 2.2 strategy work. Raw debug bundles stay in `debug_bundles/` (git-ignored) and were never
committed.

**State: all three priorities were worked through. No strategy behaviour changed.** The session was interrupted
twice by a usage limit and resumed from this file each time.

## Tasks completed

**Priority 1: interface and local data.** Database v3; Tables tab (table manager); deletion of hands,
recordings, sessions, log lines, tables and profiles; Opponents, Hand review, Diagnostics and Settings rebuilt;
popup reduced to this table; engine selector (default unchanged). Detail: `docs/bot/STORAGE.md`.

**Priority 2: the 2026-11-16 recording.** Audit tools; both screenshot figures explained and checked against
the stacks; seven tracking defects reproduced on recorded frames and fixed; a new check of every result against
the next hand's stacks. Detail: `docs/bot/LONG_SESSION_DIAGNOSTIC_AUDIT.md`.

**Priority 3: Phase 2.2, items A to F.** Reference evaluator, independent opponents, river solver reference,
PokerBench model adapter, data pipeline, calibration framework. A to D produced results; E and F are working
frameworks with no real data behind them yet. Detail: `docs/bot/PHASE_2_2_REPORT.md`.

## Commits

| Commit | What |
|---|---|
| `fd0245f` | Dashboard and popup redesign, table manager, deletion, database v3 |
| `f2d328f` | Debug-bundle audit tools; first checkpoint |
| `6f896ee` | Seven tracking fixes; result check against the next hand's stacks; audit document |
| `fb62fd7` | Phase 2.2 tools: reference evaluator, independent opponents, river reference, model adapter |
| `29d1900` | Data schema, provenance, validation, importers; calibration framework; first results |
| (this commit) | v0.7.0: model and river results, Phase 2.2 report, documents, version |

## Test results (final, at v0.7.0)

| Check | Result |
|---|---|
| `npm test` (everything) | 1,136 of 1,136 in 87 files, 525 s |
| `npm run test:bot` | 358 of 358 in 23 files |
| `npm run build` | clean, extension built at 0.7.0 |
| `npm run typecheck:tools` | clean |
| `npm run bot:e2e:recommend` | 32 of 32 (`reports/e2e-extension-recommend-only-2026-11-17.md`) |
| `npm run bot:e2e:dashboard` | 40 of 40 (`reports/e2e-dashboard-2026-11-17.md`) |
| Autonomous browser check (`npm run bot:e2e`) | not run: autonomous clicking was not exercised |
| Live PokerNow site | not tested |

Screenshots of every redesigned tab and the popup were taken with fixture data and looked at (desktop: Hand
review, Opponents, Tables, Diagnostics, Settings; phone: Hand review; popup). The Live tab and the other phone
views were captured and checked by the browser test for overflow and content but not looked at. The option to
load the real bundle into the new dashboard (`sim/bot/e2e-dashboard.ts --bundle`) was written and not run.

## Experiments run (all completed; none stopped)

| Experiment | Size | Report |
|---|---|---|
| Reference evaluation, three heads-up tables | 800 hands each, seed 7100 | `reports/reference-eval-2026-11-16-hu-*.md` |
| Reference evaluation, two six-handed tables | 900 hands each, seed 7200 | `reports/reference-eval-2026-11-16-six-*.md` |
| Independent-opponent benchmark, eight tables | about 2,400 hands per table and engine, seed 8800 | `reports/independent-bench-2026-11-16.md` |
| PokerBench model comparison | 1,500 hands at two tables, seed 9300 | `reports/ml-compare-2026-11-16.md` |
| River solver reference | 3,000 hands at four heads-up tables, seed 9350; 1,455 spots | same file, section 4c |

## Assumptions made without asking

- "Stale" table: not seen for 7 days (selectable 1, 7 or 30).
- Deleting hands leaves opponent profiles as they are; removing profiles with a table is an explicit tick box.
- A table left with neither authorisation nor history is dropped from the list.
- Added a Tables tab as a sixth tab rather than putting the manager in Settings.
- Added an engine selector under Strategy experiments, default unchanged.
- Version number 0.7.0 (new database version and new stored fields).
- The result check treats an exact re-division of the pot among players still in at showdown as "the table
  paid differently" and uses the table's result; anything else that does not add up is shown as unverified.
- Reference evaluation continues every line with version 2 after the action being priced.
- River reference uses version 2's own ranges, capped at the 140 heaviest hands per player.

## Known limitations

- Nothing in this session was tested on the live site.
- Hands already stored keep their old status; only new hands get the new checks.
- No dataset was downloaded; the importers have only seen synthetic fixtures; no response frequency was calibrated.
- Benchmarks against the independent opponents are one seed, against programs the bot beats easily.
- The full list is in `PROJECT_PROGRESS.md`, "Remaining problems".

## Next steps

1. One live session with 0.7.0 in recommend mode, then a debug bundle.
2. Your PokerNow logs and decisions on the external sources (end of `docs/bot/POKER_DATA_TRAINING_ROADMAP.md`).
3. River betting when nothing has been bet (Phase 2.2 report, last section), gated by the acceptance rule.
