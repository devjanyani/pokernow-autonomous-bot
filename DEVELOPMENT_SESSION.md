# Development session log

The 2026-11-19 session completed Phase 2.5 and integrated version 3 into the extension as an experimental option,
from commit `7314571` (v0.8.2). The Phase 2.5 log is in git history at `7314571`.

## Current state (checkpoint, v0.9.0)

- **Phase 2.5 final set (seed 13300):** run once with `npm run bot:phase25 -- --bench --seed 13300 --jobs 1`, nothing
  changed before or after; the re-derived tables were byte-identical. v3pr − v2 +1.1 ± 11.4 bb/100 (level), v3r − v3
  −5.6 ± 3.7 (worse). Per-deal results `reports/phase25-bench-13300.jsonl`; account
  `reports/PHASE_2_5_STRATEGY_BENCHMARK.md`.
- **Extension:** Settings offers v1, v2 (default) and "v3 — Experimental (recommendation-only)".
  - `mayAct()` is false under v3.
  - Validated tables: `src/bot/strategy/v3/artifacts.ts`.
  - Strategy note on every decision, dashboard and diagnostics labels, fallback to v2.
  - Shadow comparison (off by default).
  - Tests: `tests/bot/v3-extension.test.ts`. Chromium check: `sim/bot/e2e-v3.ts`. Latency: `sim/bot/v3-latency.ts`.
- **Seeds:** used 13100, 13300 (Phase 2.5, now spent); fixed but not run: 13150 (reference evaluation); earlier
  phases 12100–12900. A new held-out seed is needed for any future claim.

## To resume

1. `git pull private autonomous-bot`; `npm install` if needed; `npm test`; `npm run build`.
2. To try version 3: reload the extension in `chrome://extensions`, reload the PokerNow tab, then Dashboard → Settings
   → Strategy engine → "v3 — Experimental (recommendation-only)".
3. Open: a live play-money session with v3 selected or shadow comparison on (the browser checks used the stand-in
   table only); response functions of hand strength need data with hole cards known outside showdown
   (`docs/bot/PHASE_2_5_OPPONENT_LEARNING.md` section 8); the river tilt should not be kept alone.

## Rules kept

No autonomous clicking under v3; v2 remains the default; nothing uploaded; no raw hands, player hashes or bundles
committed; tournament hands never used; the final seed run once and not tuned on.
