# Pre-registered final validation seeds for v4 (written 2026-11-21, Phase 3.1, before any of them was run)

These seeds are reserved for the final, held-out v4 evaluation (roadmap Phase 3.7). **None of them has been run.**
Nothing may be tuned against them. Each is used exactly once, in the pre-registered run, with the commit and the
decision rule recorded in `reports/V4_PREREGISTRATION.md` before that run (to be written in Phase 3.7).

| Use | Seeds | Rule |
|---|---|---|
| Final paired benchmark, `sim/bot/v4-bench.ts` cells | **41000 + cell index** (cell order of `cells()` at the commit that adds this file: 28 cells, seeds 41000–41027) | `--seed-base 41000`, once |
| Final per-decision reference evaluation | **41500–41509** | once |
| Final solver-reference spot sample | **41900** | once |

Seeds already used, and therefore not held out:

| Seeds | Used by |
|---|---|
| 12100, 12300, 12500, 12700, 12750, 12900 | Phases 2.3–2.4 benchmarks and reference evaluations |
| 13100, 13300 (13150 reserved, unused) | Phase 2.5 evaluation set A and final set |
| 31000–31002 | Phase 3.0 audit (Hero image baseline) |
| 3101, 3102 | Phase 3.1 tests (`tests/bot/positions-exhaustive.test.ts`, `tests/bot/preflop-context.test.ts`) |
| 32000–32027 | Phase 3.1 development benchmark (`sim/bot/v4-bench.ts --seed-base 32000`, the default) |

Any later development run must use seeds outside 41000–41999.
