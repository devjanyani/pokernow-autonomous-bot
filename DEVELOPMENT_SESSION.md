# Development session log

Phase 2.5 (opponent learning from real cash-game hands) ran on 2026-11-18 from commit `c39befe` (v0.8.1). The
Phase 2.4 log is in git history at `c39befe`.

## Current state (checkpoint, v0.8.2)

- **Finished and pushed:**
  - data pipeline for the PHH / HandHQ dataset: `sim/bot/data/fetch-handhq.ts`, `parsePhhs`, `sim/bot/phase25/extract.ts`;
  - model evaluation: `predict.ts`, `run-predict.ts`, `models.ts`, `calibrate.ts`;
  - river estimator: `river-range.ts`, `river-eval.ts`;
  - experimental version 3 options: `src/bot/strategy/v3/empirical.ts` and agent options `v3Population` / `v3RiverRange`, with fitted tables beside them;
  - solver-spot raise diagnostic;
  - experiment command `npm run bot:phase25`;
  - tests: `tests/bot/phase25-learning.test.ts`.
- **Data:** under `data/phh-handhq/` (git-ignored), 120 files with a manifest of hashes; derived files under
  `data/phh-handhq/derived/`. Recreate with `npm run bot:phase25`, which fetches only what is missing.
- **Decision:** nothing promoted. Better probability prediction is established; better play is not (set A).
- **Seeds:**
  - used: 13100 (Phase 2.5 evaluation set A);
  - fixed but **not yet run**: 13300 (final set) and 13150 (reference evaluation);
  - earlier phases: 12100–12900.

## To resume

1. `git pull private autonomous-bot`; `npm install` if needed; `npm test`.
2. Run the final held-out set once, one process at a time because of memory:
   `npm run bot:phase25 -- --bench --seed 13300 --jobs 1` (the data steps are quick when the files are present).
   Then add it to `reports/PHASE_2_5_STRATEGY_BENCHMARK.md` without changing anything first.
3. Next modelling step: version 3's response *functions* of hand strength need data with hole cards known outside
   showdown (`docs/bot/PHASE_2_5_OPPONENT_LEARNING.md` section 8).

## Rules kept

No autonomous clicking; recommend-only; production default unchanged; nothing uploaded; only a pinned, bounded
sample of an MIT-licensed dataset downloaded; no raw hands, player hashes or bundles committed; tournament hands
never used; outcomes never used as decision labels; held-out seeds fixed before their runs.
