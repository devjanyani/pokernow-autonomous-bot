# v4 implementation roadmap (Phase 3.1 onward)

Written 2026-11-21 from the Phase 3.0 audit of `bf8bf21`:
[V4_PREFLOP_ARCHITECTURE_AUDIT.md](V4_PREFLOP_ARCHITECTURE_AUDIT.md),
[V4_HERO_IMAGE_AND_EXPLOITATION.md](V4_HERO_IMAGE_AND_EXPLOITATION.md),
[../../reports/V4_BASELINE_AND_GAPS.md](../../reports/V4_BASELINE_AND_GAPS.md).

This is a plan **[P]**, not a promise of strength. No phase may claim that v4 is stronger than v2 or v3 without the
pre-registered evaluation of Phase 3.7. v2 stays the default and v3 the second baseline throughout. Nothing here is
implemented yet; **Phase 3.1 starts only on instruction.**

## 0. Order, and why it differs from the brief

| Brief | Proposed | Reason |
|---|---|---|
| 3.1 Position and action-history coverage | **3.1 Coverage + evaluation harness** | Every later gate needs nine-handed, multi-depth, paired benchmarks against an independent pool. The existing benchmarks are mostly heads-up / 6-max. Building the harness last would leave Phases 3.2–3.6 ungated. |
| 3.2 Preflop data, mixed frequencies | 3.2 same | The data source is the main external dependency (licence). |
| 3.3 EV preflop | 3.3 same | Needs 3.2's prior and a response model; can start with population responses. |
| 3.4 Hero image and exploitation | **3.4 Bluffing and aggression calibration** (was 3.5) | The audit's largest measured bias is in v2's postflop scoring (river bluffs 5–15%, marginal folds 83–90%; [R] v2 already lost to v1 by betting less and folding more). It touches every postflop decision. Hero image changes only spots with per-opponent evidence, which is thin within a session (1,000–6,600 hands for postflop statistics). |
| 3.5 Bluffing calibration | **3.5 Opponent response model + Hero image** (was 3.4) | Depends on the posterior response model; small expected effect per session. |
| 3.6 Multiway search | 3.6 same | Highest cost and risk; last before evaluation. |
| 3.7 Evaluation + integration | 3.7 same: final held-out run + experimental integration | |

**Smallest implementation that could produce a measurable improvement** [H]: in Phase 3.2, two data-selection fixes
with no new algorithm, measured on the 9-handed and 6-handed paired benchmark of 3.1:

1. **Pack precedence by provenance:** exclude Greenline's exploitative cells (its own comments) from the baseline, or
   rank packs by verified provenance instead of registration order.
2. **One opener range for both halves of the model:** Hero's defence against an opener with more than 5 players
   behind must use the same opener range that `opponentPreflopRange` assigns (today 6-max UTG 15.5% vs heuristic 11%).

Both are cheap, reversible and isolated. Whether either *wins* is unknown.

## 1. Phase 3.1: position / action-history coverage and the evaluation harness

| Item | Content |
|---|---|
| **Scope** | (a) A `PreflopContext` built once per decision: players behind for Hero and every raiser, limpers, callers, raise level, size faced (bb and multiple), effective stack per opponent, SPR after a call, ante, straddle, missed-blind posts. (b) A benchmark harness: 2 / 6 / 9 players × 40 / 100 / 200bb × development and held-out opponent pools, paired seeds, CIs, tripwires, JSONL output. (c) Pre-registration template. No strategy change. |
| **Reuse** | `table/positions.ts`, `preflop.ts`'s action reader, `ranges/preflop-model.ts` `preflopLine`, `src/bot/sim/table.ts` `playSession` / `pairedDiff`, `sim/bot/phase23-bench.ts` (tables, JSONL), `sim/bot/v4-baseline.ts` (coverage, widths, Hero image), `sim/bot/legacy-seat.ts`, `src/bot/sim/independent.ts`. |
| **Files** | new `src/bot/strategy/v4/context.ts`; `preflop.ts` reads the context (behaviour identical); new `sim/bot/v4-bench.ts`; `tests/bot/v4-context.test.ts`; tracker fixture for a missed-blind post if a recording is available. |
| **Data** | none new; a live recording with missed-blind posts and straddles (user, recommend mode). |
| **Compute** | [M] one unpaired 3,000-hand v2 session at 200 samples per decision takes about 1 min; a paired duplicate run multiplies that by 2 engines × the seat rotations (9 at 9 players), so a 10,000-deal 9-handed paired row (about 180,000 hands) is roughly an hour of single-process time. Split by `--tables` groups; keep ≤ 2 heavy processes on this machine. |
| **Failure modes** | Context disagrees with the rules engine (straddle, dead blinds); harness confounds (unpaired seeds, shared RNG between engines); overfitting to the development pool. |
| **Tests** | Context property tests over random legal action sequences for 2–10 players (players-behind invariants, raise levels, size faced); golden decisions unchanged (v2 decisions identical before and after on 1,000 recorded states); harness reproducibility (same seed → identical JSONL). |
| **Acceptance** | All existing tests pass; v2 decisions bit-identical; harness reproduces a published row (`reports/PHASE_2_5_STRATEGY_BENCHMARK.md`) within its CI; held-out pool and seed range written down and **not run**. |
| **Dependencies** | none. |

### 1.1 Status: Phase 3.1 done (2026-11-21, 0.9.2)

Accounts: [reports/PHASE_3_1_PREFLOP_COVERAGE.md](../../reports/PHASE_3_1_PREFLOP_COVERAGE.md), [reports/PHASE_3_1_EVALUATION_BASELINE.md](../../reports/PHASE_3_1_EVALUATION_BASELINE.md).

**Done.**
- Exhaustive position and action-order tests for 2–10 players. One label defect fixed (duplicate "MP" at 10 dealt in
  with a dead small blind).
- `classifyPreflop` with 12 situations and flags, recorded with every preflop decision (`Decision.preflop`: situation
  and source).
- Silent chart substitutions now stated.
- The three Phase 3.0 chart-selection defects handled as offline options:
  - documented precedence;
  - consistent opener range;
  - chart-stated sizes.
- The paired harness `sim/bot/v4-bench.ts`: 28 cells, rake post hoc, negative controls, process measures.
- Reproducibility: Phase 2.5 rows reproduced bit for bit.
- Final seeds pre-registered (41000–41999, unrun).

**Result.** The corrections are not shown to help: ring pooled −16.1 ± 18.3 bb/100, ablations all inside their
intervals. They stay off and no default changed.

**Found.** The independent pool does not punish loose-passive preflop play: the limp-call-everything control is level
with v2. The pool needs a punishing opponent before it can gate preflop changes.

**Also in 0.9.2 (settings, not strategy).** Timing modes Instant / Random.

### 1.2 Recommended scope of Phase 3.2 (revised by the 3.1 results)

1. **Harness first:**
   - add at least one opponent that punishes loose or passive preflop play (a range-aware 3-bettor / squeezer, and
     the legacy blueprint engine heads-up via `sim/bot/legacy-seat.ts`);
   - require the limp-call negative control to be detected before any preflop change is judged.
2. **Data:** the preflop range source remains the blocker. Phase 3.2 needs either a licensed solver export the user
   supplies (6- and 9-handed cash at several depths and open sizes) or a project-run two-player subgame solve,
   labelled "computed approximation". No invented ranges.
3. **Only then:** size-keyed defence ranges and depth buckets, judged on the strengthened pool with the paired
   harness, with seeds outside 41000–41999.
4. **Out of scope until then:** EV preflop (3.3), bluffing calibration (3.4).

### 1.3 Amendment from the live forensic audit (2026-11-21)

[reports/LIVE_SESSION_FORENSIC_AUDIT_2026_11_21.md](../../reports/LIVE_SESSION_FORENSIC_AUDIT_2026_11_21.md)
covers 58 hands at a 5–10-handed autonomous table on 0.9.1.

Recommended order:

0. **3.1b reliability, before any strategy work.** No strategy change; each fix needs a deterministic regression
   test.
   - Detect and report page timer throttling, and keep the deadline cap enforceable from the service worker (D1).
   - Add live and dead posts to the engine and tracker (D2).
   - Correct the timing attribution in `fired()` (D4).
   - Record cancelled recommendations and Hero actions the executor did not send (D5).
   - D3 is already caught by the executor; optionally skip re-deciding a fired point.
1. **First strategy candidate:** a pot-odds floor in the two price-blind heuristic branches (audit §6.3). It is
   judged in the paired harness after item 1 of §1.2 (the punishing opponent), not on live hands.
2. **Stays with the data work (Phase 3.2):** full-ring early-seat composition, iso-raise thresholds and opponent
   jam-range widths (audit §6.1, §6.2, §6.4).

#### 1.3.1 Status of item 0: Phase 3.1b done (2026-11-26, 0.9.3)

[reports/PHASE_3_1B_RELIABILITY.md](../../reports/PHASE_3_1B_RELIABILITY.md). No strategy changed.

- **D1, background throttling:**
  - expired actions are never sent;
  - late wake-ups, suspensions and uncertain turn starts are detected on the monotonic page clock;
  - the stored settings are read again after delayed timers;
  - bet entry is checked again before the submit;
  - a visible warning is shown.

  **Departure from the plan above:** the deadline is *not* kept enforceable from the service worker. Its timers have
  no adequate guarantee (it is stopped when idle, and it cannot reach a frozen page), and waking a throttled page
  that way is a throttling workaround. Reliable unattended background-tab execution is stated as not achievable;
  the bot fails safe and warns instead.
- **D2, entry posts:** `post-live` and `post-dead` in the engine. The tracker recognises them only in the recorded
  pattern, and keeps everything else explicit and uncertain. Hand 45 is valid; three opponents' posts that were
  counted as calls are corrected.
- **D3/D4, the duplicate attempt:** a decision point that was acted on is never decided again, one attempt has one
  identity, and its timing is its own.
- **D5, lifecycle records:** one record per attempt, with its outcome, the reason, manual evidence (observed or
  inferred) and table confirmation. The schema addition is optional; no migration.

**Next:** item 1, the pot-odds floor judged in the harness, only on instruction. Phase 3.2 has not started.

## 2. Phase 3.2: validated preflop range data and mixed-frequency actions

| Item | Content |
|---|---|
| **Scope** | Pack precedence by provenance; packs keyed by players behind (6–9), stack bucket (20–40 / 40–80 / 80–150 / 150+bb), size bucket; squeeze, cold-4-bet, vs-squeeze, limp / complete spots; seeded mixed sampling (already present) with frequency tests. |
| **Reuse** | Strategy library and pack format (`library/*`, `import.ts`, `npm run bot:ranges -- import`), `validate.ts`, provenance tags, `cite()`. |
| **Files** | `library/library.ts` (`find`: size and stack keys, precedence), `library/builtin.ts` (tag Greenline cells), `library/types.ts` (`exploitative` flag, size buckets), `strategy/packs/*` (imported data), `preflop.ts` (read sizes). |
| **Data** | **The blocker.** Either (a) solver output for 6- and 9-handed cash at several depths, from a tool and source whose terms permit bundling (the user must supply and confirm the licence), or (b) a project-run solve. A full 9-handed preflop CFR is beyond the current solver (heads-up only). Feasible variant: per-spot two-player subgames (opener vs one defender with fold-equity leaves), clearly labelled "computed approximation". **No invented "GTO" ranges.** |
| **Compute** | Lookups: negligible. A project-run solve of two-player preflop subgames: minutes per spot offline with `src/solver/preflop` [H]. |
| **Failure modes** | Licence; transcription errors (validate totals per spot, mirror checks, monotonicity in stack depth); mixing producing visible patterns (seeded, but not predictable to opponents without the seed). |
| **Tests** | Pack validation; coverage matrix rerun (no 6–9-handed 100bb spot heuristic where data exists); frequency test: over 10,000 seeded draws each mixed cell's sampled frequency is within the binomial 99% interval; determinism per (seed, hand, events, seat). |
| **Acceptance** | Coverage report shows data (exact or labelled approximation) for every scenario family at 6 and 9 players, 40–150bb; v2 with the new packs is **not worse** than v2 with the old on the development pool (paired, 95% CI lower bound > −2 bb/100 at the agreed sample); no tripwire fires. |
| **Dependencies** | 3.1; a licensed data source. |

## 3. Phase 3.3: EV-based preflop decisions with stack, rake and opponent adjustments

| Item | Content |
|---|---|
| **Scope** | The preflop architecture of the audit §6: candidates (fold, call, two raise sizes, all-in) × response model (population first) × equity matrix × realization table × rake; policy combiner with bounded deviation from the 3.2 prior. |
| **Reuse** | `src/solver/preflop/equity-matrix.json` (169×169), `multiwayEquity` for multiway, `ranges/*`, `opponents/profile.ts` posteriors, the seeded sampler. |
| **Files** | new `src/bot/strategy/v4/preflop-ev.ts`, `v4/combiner.ts`, `v4/realization.ts`; `agent.ts` (engine `'v4'` option, offline only); settings untouched. |
| **Data** | Realization table measured by simulation (v2 / v3 postflop against the development pool, by position × SPR × players × class); population preflop response rates from HandHQ (`sim/bot/phase25/`). |
| **Compute** | < 5 ms per preflop decision heads-up; < 30 ms multiway with Monte Carlo [H]. |
| **Failure modes** | Realization errors bias every call / 3-bet; response model too optimistic about folds (the v3 failure in a new place); combiner drifts far from the prior. |
| **Tests** | Closed-form checks (pot odds, fold-equity break-even, rake cap); with `exploitWeight = 0` and population responses equal to the prior's implied ones, the combiner returns π0; monotonicity (more folds → more raises); all-in call EV equals today's computed branch within MC error. |
| **Acceptance** | Paired v4-preflop + v2-postflop vs v2: CI lower bound > −1 bb/100 on development pool, and the point estimate improves on at least 2 of the 3 table sizes; preflop frequency calibration within ±3 points of the prior on spots where no opponent evidence exists. |
| **Dependencies** | 3.1, 3.2 (prior), the population response fit. |

## 4. Phase 3.4: bluffing and aggression calibration

| Item | Content |
|---|---|
| **Scope** | v2: replace the fixed pessimistic min with a posterior lower-bound rule applied to deviations only; Hero rollout bluff rate from Hero's own decisions; check-raise as a plan (use v3's tree heads-up). v3: fold-to-raise and size-response calibrated on real hands by size bucket; tripwires for check-raise and all-in bluff frequency. |
| **Reuse** | `strategy/postflop.ts`, `v3/model.ts` (`respond3`, residual calibration), `v3/empirical.ts`, `sim/bot/solver-spots.ts`, `river-reference.ts`, `reference-eval.ts`. |
| **Files** | `postflop.ts` (scoring), `v3/model.ts`, `v3/empirical.ts`, new calibration fit in `sim/bot/phase25/`. |
| **Data** | HandHQ responses to raises by size; DCFR river spots (existing), turn spots if feasible. |
| **Compute** | No change per decision. |
| **Failure modes** | Over-correction into v3-like over-aggression; gains against simulated opponents that do not transfer to people (Phase 2.5 precedent); confusing sampling and model error. |
| **Tests** | Solver spots: per-decision EV loss vs the DCFR reference must not grow; river bluff share and check-raise frequency within the solver-reference band ± 10 points; calibration plots on held-out HandHQ days. |
| **Acceptance** | Paired vs v2 on the development pool: lower bound > −1 bb/100, and improvement on the per-decision reference evaluation; no tripwire fires against `adaptive-punisher` and `pot-odds-caller`. |
| **Dependencies** | 3.1; the response fit (shared with 3.3). |

## 5. Phase 3.5: opponent response model and Hero image

| Item | Content |
|---|---|
| **Scope** | Hierarchical posterior response model (companion doc §2); residual offsets for every bettor; `HeroFacing` per opponent (layers A–D, companion doc §4); bounded deviations; table-level false-discovery control. |
| **Reuse** | `opponents/profile.ts` (counters, posteriors), `v3/model.ts` `solveCalib` (generalised), IndexedDB profile store (migration), Opponents tab. |
| **Files** | `opponents/profile.ts`, new `opponents/response-model.ts`, `opponents/hero-facing.ts`, `ext/storage.ts` (schema version + migration), `ext/tabs/opponents.ts` (display). |
| **Data** | HandHQ population fit; the user's PokerNow recordings for per-opponent validation. |
| **Compute** | Posterior updates per hand: negligible; EV at 3–5 posterior draws multiplies postflop evaluation cost by that factor unless shared deals are reused (common random numbers) [H]. |
| **Failure modes** | Exploiting noise; mis-specified priors; storage migration errors; explanations implying mind-reading. |
| **Tests** | Recovery tests (simulated players with known offsets: posterior covers the truth at the nominal rate); robustness (wrong profile seeded: bounded loss); storage migration tests; explanation text lint (no belief claims). |
| **Acceptance** | Predictive: held-out log-likelihood better than the population model; play: paired lower bound > −1 bb/100 against every pool member, including mis-specified-profile runs; deviations off with no evidence (π = baseline). |
| **Dependencies** | 3.1, 3.3 (combiner), 3.4 (calibrated responses). |

## 6. Phase 3.6: limited multiway postflop search

| Item | Content |
|---|---|
| **Scope** | Three-way search on the current street only, one bet and one raise size, river leaves exact, earlier leaves by realization factor; four or more players stay on v2; explicit fallbacks with reasons. |
| **Reuse** | `v3/search.ts` (tree over real HandStates, reach weights), `MultiwayDealSampler`, `pots.ts` side pots, v2 as fallback. |
| **Files** | new `strategy/v4/search3.ts`, `agent.ts` routing. |
| **Data** | Multiway real-hand responses (HandHQ 6-max has them) for the response model. |
| **Compute** | The main risk: probably 5–20× v3's heads-up cost per node set [H]; must fit the postflop budget (`time/budget.ts`; hard cap ≤ clock − margin) or be skipped with a fallback. |
| **Failure modes** | Independence assumption between opponents' responses; tree blow-up; latency on low-end machines; small or no gain over v2. |
| **Tests** | Exact three-way river spots (enumerable small ranges) vs brute force; latency percentiles; fallback triggers. |
| **Acceptance** | Three-way pots: paired lower bound > −1 bb/100 vs v2 in those pots, p95 latency within budget; otherwise not shipped. |
| **Dependencies** | 3.1, 3.4. |

## 7. Phase 3.7: independent evaluation and experimental integration

### 7.1 Evaluation framework

| Dimension | Values |
|---|---|
| Table sizes | 2, 6, 9 players |
| Effective stacks | 40, 100, 200bb (plus a 20bb short-stack row) |
| Opponent pools | **Development:** `ARCHETYPES` (tight / loose, passive / aggressive), `range-aware`, `rangeEquity`. **Held-out, never used to tune:** `INDEPENDENT_FACTORIES` (raiser, pot-odds-caller, mdf-defender, trapper, maniac, nit, adaptive-punisher), the legacy engine with the blueprint (`sim/bot/legacy-seat.ts`, ≤ 6 players), plus at least two new policies written from a written spec by a separate session before Phase 3.2 starts. |
| Baselines | v2 (default) and v3 (experimental), unchanged code paths |
| Pairing | Same decks, seats, opponent seeds; only the measured seat's engine changes; duplicate rotation where the table size allows |
| Statistics | bb/100 with 95% CI from per-deal paired differences (`pairedDiff`); stated sample size per row; no optional stopping |
| Separate measures | (1) predictive accuracy: log-likelihood on held-out real hands; (2) tactical correctness: per-decision EV vs DCFR river references and paired-continuation reference (`reference-eval.ts`); (3) exploitability proxy: heads-up local best response on subgames; (4) realised chips |
| Tripwires | Check-raise, river bluff share, all-in bluff frequency, 3-bet frequency per position: each inside stated bands from the solver references and the baseline pack |
| Preflop calibration | Sampled frequencies vs the pack's mixes per spot (binomial interval) |
| Robustness | Mis-specified profiles (profiles from another opponent), cold start (no profiles), adaptive opponent |
| Regression | Full unit suite with `--maxWorkers=4`; tracking replays (`tests/bot/live-replay.test.ts`); legal-action fuzz; latency budget per street; Chromium e2e checks one at a time |

### 7.2 Pre-registration

Before the final run, write `reports/V4_PREREGISTRATION.md` and commit it. It names the commit, the engines, the
seeds (taken from a range never used before; 13100 and 13300 are spent, 31000–31002 are audit seeds), the sample per
row, the primary metric (pooled paired bb/100 vs v2 over the held-out pool at 6 and 9 players, 100bb) and the decision
rule. Run it once. No tuning after looking. If the primary metric's 95% CI does not exclude zero in v4's favour, v4
is not called stronger.

### 7.3 Integration

As with v3 in 0.9.0, integration is experimental: selectable in Settings, recommendation-only by default, falling back
to v2 with stated reasons. It acts on authorised tables only through the existing gate (`mayAct`) with its own
separate permission. The scheduler, emergency stop, legality and reconciliation checks are unchanged.

| Item | Content |
|---|---|
| **Acceptance** | Pre-registered result reported as is; Chromium e2e against the stand-in table; full suite; build; live validation explicitly listed as not done until it is. |
| **Dependencies** | 3.1–3.6 (any subset that passed its gate). |

## 8. Expected performance and computational trade-offs

- **Performance: no prediction.**
  - Effects of the size plausible for each phase (a few bb/100) are inside today's benchmark CIs (±10 bb/100 at the
    sample sizes used in Phases 2.4–2.5).
  - Halving the CI needs four times the hands. A ±5 bb/100 pooled CI at 6–9 players needs roughly 40,000 paired deals
    per comparison [H, from the per-deal SD of the Phase 2.5 runs].
  - That cost decides how many variants can be tested honestly, and argues for few, isolated changes.
- **Compute per decision:**
  - preflop EV: milliseconds;
  - response-model posterior draws: up to 3–5× postflop evaluation if done naively, about 1.3× with shared deals;
  - three-way search: the only item that may exceed the clock and needs a fallback.
- **The 0.9.1 scheduler already waits 4–20 s per authorised action.** Computation fits inside that delay, so longer
  searches are possible in authorised play but not in recommendation mode, where the user waits for the advice.
- **Complexity:**
  - Phases 3.1–3.3 add modules without changing v2's code paths, so they are reversible.
  - Phases 3.4–3.5 change postflop scoring and storage, so they need the strictest gates.
  - Phase 3.6 is optional.
