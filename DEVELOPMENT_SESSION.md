# Development session log

Phase 2.4 (version 3's over-raising and value bias) ran on 2026-11-18 from commit `14fe4ae` (v0.8.0). The Phase 2.3
log is in git history at `14fe4ae`.

## Current state (checkpoint, v0.8.1)

- **Finished and pushed:** residual calibration of version 3's response knobs (`strategy/v3/model.ts` `CALIB_GRID`,
  `solveCalib`; `search.ts` `calibCurve`; `agent.ts` `v3Calibration`); holdout valuation option (`holdoutEvery`, off);
  diagnostic hook `onV3Search` (offline); reference fixtures `tests/bot/v3-reference-fixtures.test.ts`; tools
  `sim/bot/v3-raise-diag.ts`, `sim/bot/cash-raise-counts.ts`, extended `v3-bias.ts` and `phase23-report.ts`.
- **Decision:** version 3 stays offline and is not offered in the extension. It is equal to version 2 on fresh seeds
  (12700: −1.8 ± 10.1; 12900: −0.6 ± 10.9 bb/100 heads-up pooled), not better. Version 2 is the default.
- **Seeds used:** benchmarks 12100, 12300 (development), 12700 (set A), 12900 (final set); reference evaluations 12500,
  12750. Next fresh benchmark seeds: 13100 and up, chosen before looking at results.

## To resume

1. `git pull private autonomous-bot`; `npm install` if needed; `npm test`.
2. The open items are in `docs/bot/PHASE_2_4_MODEL_CALIBRATION.md` sections 8 and 9. The main ones:
   - the population fold-to-raise response function (version 3 never folds to a condensed river bet);
   - the opponent's strength measured before Hero's action;
   - the bettor's range estimate on the river.
   All need data (recorded cash sessions, hand histories with known cards whose terms permit use, turn solver spots),
   not more hand-tuning.
3. Recording more cash sessions in recommend mode is the most useful thing the user can do for this.

## Rules kept

No autonomous clicking; recommend-only testing; nothing uploaded; no dataset downloaded; tournament data not used;
raw bundles never committed; outcomes never used as decision labels; held-out seeds fixed before their runs, and
nothing tuned on them.
