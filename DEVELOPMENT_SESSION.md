# Development session log

Phase 2.3 (cash-game strategy) started on 2026-11-17 from commit `6ee2128` (v0.7.0, branch `autonomous-bot`).
The previous session's log (v0.7.0: dashboard, tracking audit, Phase 2.2 instruments) is in git history at `6ee2128`.

## Current state (checkpoint)

- **Done and pushed (`1be2aee`):** experimental v3 postflop engine (`src/bot/strategy/v3/`), history-conditional
  opponent model with profile knobs, three new profile statistics, agent wiring with fallback to v2, tests.
- **Done, not yet committed:** model-uncertainty mixture in v3; v2 bet-size rounding fix at small stakes (cents
  below 2 chips per big blind); benchmark harness `sim/bot/phase23-bench.ts`; raise-heavy `raiser` opponent;
  cash-session analysis `sim/bot/cash-session.ts`; solver comparison with independent ranges
  `sim/bot/solver-spots.ts` and inner-node analysis in `sim/bot/river-reference.ts`; reference evaluator for any
  engine pair (`--engines v3,v2`); STRATEGY.md section 9.
- **Running:** `phase23-bench.ts` seed 12100 (17 tables, v1/v2/v3/ml, 2,000 hands); reference evaluation v3 vs v2
  on hu-tag, hu-lag, hu-trapper (seed 12500).
- **Cash bundle used:** the 2026-11-18T04:35 export (nine-handed 0.25/0.50, ante 0.25). The 2026-11-18T02:28
  export is a tournament (rising blinds) and is not used for anything.

## To resume

1. If the benchmark did not finish: `npx tsx sim/bot/phase23-bench.ts --engines v1,v2,v3,ml --hands 2000 --seed 12100 --tables <remaining>`.
2. Write `docs/bot/PHASE_2_3_ADVANCED_STRATEGY.md` and `reports/PHASE_2_3_BENCHMARK.md` from the results.
3. Decide on integration (Stage 10) from the evidence; the default stays v2 unless the evidence supports otherwise.

## Rules kept

No autonomous clicking; recommend-only testing; nothing uploaded; no dataset downloaded; tournament data not used for
cash-game priors; raw bundles never committed.
