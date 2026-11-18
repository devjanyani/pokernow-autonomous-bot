# Development session log

Phase 2.3 (cash-game strategy) ran from 2026-11-17 to 2026-11-18, starting from commit `6ee2128` (v0.7.0, branch
`autonomous-bot`). The previous session's log (v0.7.0) is in git history at `6ee2128`.

## Current state (checkpoint, v0.8.0)

- **Finished and pushed:** experimental version 3 postflop engine (`src/bot/strategy/v3/`) with a history-conditional
  opponent model, a model-uncertainty mixture, and the raise fold-shift fix; three new profile statistics; the v2
  bet-size rounding fix at small stakes; the Phase 2.3 tools (`sim/bot/phase23-bench.ts`, `phase23-report.ts`,
  `cash-session.ts`, `solver-spots.ts`, `v3-bias.ts`, `v3-latency.ts`, reference evaluation for any engine pair).
- **Decision:** version 3 is **not** activated and not offered in the extension. It was not better than version 2 on
  the held-out seed (heads-up pooled −10.3 ± 11.9 bb/100, significantly behind at three tables, significantly ahead
  at none). The default stays version 2. Evidence: `reports/PHASE_2_3_BENCHMARK.md`; account and reasoning:
  `docs/bot/PHASE_2_3_ADVANCED_STRATEGY.md`.
- **Cash bundle used:** the 2026-11-18T04:35 export (nine-handed 0.25/0.50, ante 0.25), analysed in
  `reports/cash-session-2026-11-18.md` (anonymised). The 2026-11-18T02:28 export is a tournament and was not used.

## To resume

1. `git pull private autonomous-bot`; `npm install` if needed; `npm test`.
2. The next strategy step is the open defect in version 3 (over-raising against version 2's own model, never folding
   to a condensed river bet). Start from `docs/bot/PHASE_2_3_ADVANCED_STRATEGY.md` section 11. Calibrate fold-to-raise
   responses from data rather than by hand. Re-test on a fresh seed (12500 and up are used for reference
   evaluation; use 12700 or higher for the benchmark).
3. More cash-game recordings are the main missing input: no player has 30 postflop opportunities of any statistic.

## Rules kept

No autonomous clicking; recommend-only testing; nothing uploaded; no dataset downloaded; tournament data not used for
cash-game priors; raw bundles never committed; outcomes never used as decision labels.
