# v4 audit (Phase 3.0): baseline, positional preflop coverage, preflop mathematics and the proposed architecture

Audit of commit `bf8bf21` (v0.9.1), 2026-11-21. **Audit and design only: no strategy, model or setting was changed.**
No-limit hold'em cash games; tournaments and ICM are out of scope.

Every statement carries one of these labels:

| Label | Meaning |
|---|---|
| **[F]** | Verified repository fact: read in the code or the git-tracked data at `bf8bf21`, with the file and function named. |
| **[M]** | Measured in this audit with `sim/bot/v4-baseline.ts` (deterministic; raw output in `reports/v4-*-2026-11-21.md`). |
| **[R]** | Result from an earlier, committed report (named). |
| **[H]** | Hypothesis: plausible, not shown. |
| **[P]** | Proposal for v4. |
| **[E]** | Missing evidence: what would be needed to settle the point. |

Companion documents: [V4_HERO_IMAGE_AND_EXPLOITATION.md](V4_HERO_IMAGE_AND_EXPLOITATION.md) (opponent model, Hero
image, bluffing), [../../reports/V4_BASELINE_AND_GAPS.md](../../reports/V4_BASELINE_AND_GAPS.md) (measurements, ranked
weaknesses), [V4_IMPLEMENTATION_ROADMAP.md](V4_IMPLEMENTATION_ROADMAP.md) (phases and gates).

---

## 1. What the extension actually runs

### 1.1 Call path [F]

```
content.ts → controller.ts (scheduler, mayAct) → BotAgent.decide()                         src/bot/agent.ts
  prepare(): legalActions, tableCounts, buildTable()                                          strategy/villains.ts
             ├─ opponentPreflopRange()  chart range via the library, else percentile bands     ranges/preflop-model.ts
             ├─ narrowSeat()            Bayes narrowing per postflop action                    ranges/range-model.ts
             └─ heroPerceived           range of Hero's LINE (neutral tendencies)
  preflop  → decidePreflop(..., defaultLibrary())                                             strategy/preflop.ts
  postflop → v3 selected and exactly one opponent → PostflopSearchV3                          strategy/v3/search.ts
             otherwise (or v3 failure)            → PostflopSolver (v2)                        strategy/postflop.ts
  finish(): free-check rule, validateAction() legality gate, explanation, StrategyNote
```

- The preflop engine is the same for v2 and v3. `finish()` labels every preflop decision under v3 as the fallback
  "version 3 has no preflop engine" (`agent.ts` `finish`).
- `decidePreflop` samples its action mix with `Rng(hashSeed(seed, handId, events.length, heroSeat))` (`agent.ts`
  `prepare`). Preflop mixing is therefore already reproducible.
- The time budget (`time/budget.ts` `planBudget`) applies only to postflop. A preflop decision is one chart lookup
  plus a 1,200-sample display-equity estimate.

### 1.2 Status of each component

| Component | Implemented | Tested | In the extension | Notes |
|---|---|---|---|---|
| Position reconstruction 2–10, dead SB, dead button, straddle (`table/positions.ts` `assignPositions`) | yes | yes (`tests/bot/engine.test.ts`) | yes | labels below |
| Strategy library and pack format (`strategy/library/*`) | yes | yes (`library.test.ts`) | yes | user packs: **none** (`packs/index.ts` `USER_PACKS = []`) |
| Greenline 6-max chart (42 spots) and Pekarstas 6-max chart (46 spots) | yes | indirectly | yes | provenance unverified (§3) |
| Heads-up table charts (`core/ranges/preflop-charts.ts`, hand-encoded) | yes | yes | yes | 4 scenarios |
| HU push/fold Nash (`core/ranges/pushfold-nash.ts`) | yes | yes | yes | used ≤12bb, one player behind |
| HU preflop CFR+ solve (`src/solver/preflop/`, output `headsup-solved.ts`) | yes | yes | **no** | replaced: about 33% of its cells unconverged (header of `preflop-charts.ts`) |
| Percentile-band heuristics (`ranges/preflop-model.ts` `OPEN_BY_BEHIND`, `bandsForLine`; `preflop.ts` fallbacks) | yes | yes | yes | hand-set widths |
| Preflop EV | **only for all-in calls** (`preflop.ts` branch 1) | yes | yes | §5 |
| Opponent profiles, 41 counters (`opponents/profile.ts`) | yes | yes | yes | 4 tendencies and 1 exploit note feed decisions (companion doc §1) |
| v2 postflop two-round Monte Carlo (`strategy/postflop.ts`) | yes | yes | yes, the default | |
| v3 heads-up postflop search (`strategy/v3/`) | yes | yes | experimental; recommendation-only unless separately permitted (0.9.1) | |
| v3 population calibration and river tilt (`v3/empirical.ts`, `v3/artifacts.ts`) | yes | yes | with v3 only | |
| Legacy `DecisionEngine` (`src/core/engine.ts`), C++ blueprint (`blueprint/`), TS blueprint loader (`src/core/blueprint/`), CFR (`src/core/cfr`, `src/solver`) | yes | yes (own suites) | **no** | `src/bot` imports only `core/equity/hand-eval`, `core/equity/multiway-equity` and the chart and strength tables in `core/ranges` (grep of `src/bot` imports) |
| TS range-vs-range DCFR (`src/core/solver/postflop-cfr.ts`) | yes | yes | **no** | used offline for river references (`sim/bot/river-reference.ts`, `solver-spots.ts`) |
| Rake | **no** | — | — | `rake` exists only as a free-text pack field (`library/types.ts`) |

### 1.3 Can the legacy engines be reused? [F/R/H]

| Asset | What it is [F] | Reusable for v4 |
|---|---|---|
| C++ MCCFR blueprint (`blueprint/`, shipped policy `blueprint/web/policy.gpobp.gz`) | Heads-up only; 100bb (`stack=10000; blind=50,100`); preflop sizes 0.5 / 1 pot, up to 3 raises; postflop 0.5 / 1 pot and all-in; 200 buckets per postflop street; 12.7 billion iterations (`blueprint/web/meta.json`) | **As an independent heads-up opponent and reference.** `sim/bot/legacy-seat.ts` already seats the original engine (blueprint included) in the simulator. [R] `reports/bench-2026-11-13.md`: bot vs legacy −10.6 ± 27.6 bb/100 heads-up, not significant. **Not as a v4 policy**: fixed 100bb, two sizes, heads-up only. Retraining for other depths, or for three or more players, is most likely outside this project's compute: the shipped heads-up policy alone took 12.7 billion iterations [H]. |
| `bp search` (C++ DCFR subgame re-solve) | River re-solve about 1.5 s; turn too slow; runs only in the simulator / play app (README) | Offline solver references for heads-up river and turn spots. Not online. |
| `src/core/solver/postflop-cfr.ts` (TS DCFR) | Range-vs-range river solver, already validated against independent recomputation (`river-reference.ts` `independentCheck`) | **Yes**, already in use: solver-reference spots for v4 acceptance tests (heads-up river; turn if bounded). |
| HU preflop CFR+ (`src/solver/preflop/`) | HU preflop game, leaves valued by all-in equity × realization; under-converged cells | Its **169×169 all-in equity matrix** (`src/solver/preflop/equity-matrix.json`) is directly reusable for fast preflop EV (§6). The solve itself is not a source of ring ranges. |
| Legacy `DecisionEngine` | Older overlay engine with flags (`src/core/engine-flags.ts`) | As a benchmark opponent only (independent code). |

---

## 2. Positions at 2–10 players [F]

`assignPositions` (`table/positions.ts`) derives positions from the button and the seats **dealt into this hand**,
never from physical seat numbers, so players leaving, joining or sitting out change the positions of the next hand
correctly. `createHand` marks `sittingOut` or zero-stack seats `dealtIn: false` (`engine.ts`).

| Dealt in | Labels, first to act first (`EARLY_LABELS`) | Strategy key |
|---|---|---|
| 2 | BTN(=SB), BB | heads-up branch (`hu = dealt.length === 2`) |
| 3 | BTN, SB, BB | `behindPreflop` |
| 4 | CO, BTN, SB, BB | |
| 5 | HJ, CO, … | |
| 6 | UTG, HJ, CO, … | 6-max chart keys UTG / MP(=HJ) / CO / BTN / SB / BB via `chart6For` |
| 7 | UTG, MP, HJ, CO, … | |
| 8 | UTG, UTG+1, MP, HJ, CO, … | |
| 9 | UTG, UTG+1, MP, LJ, HJ, CO, … | |
| 10 | UTG, UTG+1, UTG+2, MP, LJ, HJ, CO, … | |

- **Heads-up rules are correct.** The button posts the small blind, acts first preflop and last postflop, and the
  heads-up branch and charts are used. Dead small blind (`noSmallBlind`), dead button (nearest dealt seat
  counter-clockwise) and a live straddle (straddler acts last preflop) are handled and tested.
- **Labels are cosmetic.** Decisions use `behindPreflop` (players still to act in an unopened pot), not the label.
  The 7- and 8-handed names differ from common usage: 7-handed "MP" is usually called LJ, and 8-handed "UTG+1 / MP" is
  usually called "UTG+1 / LJ". This affects the display and the profile groups (`posGroup`: Early / Late / Blinds),
  not the chart key.
- **The chart key is `behindPreflop`.** A 9-handed LJ (5 behind) is read as 6-max UTG, HJ as MP, and so on. That is the
  usual approximation. Seats with more than 5 behind (UTG, UTG+1, MP at 9-handed) have **no chart** (`chart6 = null`).
- **[E]** Not verified here: how the tracker handles a player who posts a missed blind or a "post to play" big blind
  out of position. `engine.ts` models SB, BB, ante and straddle posts only. A newcomer's extra post would appear as a
  forced bet the position model does not know about. A recording of such a hand is needed (TRACKING.md workflow).

---

## 3. Provenance of the preflop data [F]

| Source | Content | Provenance and limits |
|---|---|---|
| `core/ranges/greenline-gto.ts` | 6-max: 5 RFI, 5 ISO, 12 vs-open, 15 vs-3bet, 5 vs-4bet (BB only) | "Extracted from GreenCharts2024_01.pdf". Licence and solver origin unverified (`library/builtin.ts`: `verified: false`). **Its own comments describe some cells as exploitative**: "SB vs UTG (3bet always, 3bet vs weak opponents who fold to 3bet)", "3bet IP vs RFI 26% (CO range)", "UTG 14% - Sizing: 3bb". The SB and BTN vs-open charts are 3-bet-or-fold: [M] BTN vs CO 26.2% 3-bet, 0% call; SB vs BTN 29.4% 3-bet. |
| `core/ranges/pekarstas-gto.ts` | 6-max: 5 RFI, 13 vs-open, 15 vs-3bet, 13 vs-4bet | Origin unstated ("transcription"); `verified: false`. BTN vs CO 14.8% continue with flats. |
| Library precedence | `buildDefaultLibrary` registers Greenline before Pekarstas; on equal match quality the **first registered wins** (`library.ts` `find`, `-0.001 * order`) | Greenline's exploitative cells override Pekarstas wherever both exist. This was never an evidence-based choice. |
| `core/ranges/preflop-charts.ts` (heads-up table) | RFI (raise or fold, no limps), vs-open, vs-3bet, vs-4bet | "Encodes established heads-up GTO ranges… not a fresh solve". [M] Button opens 67% and never limps. |
| `core/ranges/pushfold-nash.ts` | HU jam / call thresholds by stack | Well-known Nash push/fold (Sklansky–Chubukov, HoldemResources). Correct only heads-up with no ante. |
| `ranges/preflop-model.ts` | `OPEN_BY_BEHIND` [1, .42, .44, .28, .21, .17, .145, .125, .11, .10], `JAM_POINTS`, `JAM_BEHIND_MULT`, `bandsForLine` | Hand-set ("commonly published opening frequencies"). |
| `ranges/range.ts` ordering | 0.5 × all-in equity vs random + 0.5 × vs top 20% | Computed, an equity ordering, not a playability ordering: every percentile band misranks suited connectors against offsuit broadways [H]. |

**Missing from both chart packs [F, M].** CO vs an MP open; CO and BTN facing a 4-bet after 3-betting MP; every squeeze
(`vs-open-call`), facing a squeeze (`vs-squeeze`), cold 4-bet, limp / over-limp / complete strategy, multiway pot,
straddle and ante variant, and every stack depth other than 60–150bb.

---

## 4. Coverage matrix (measured) [M]

`npx tsx sim/bot/v4-baseline.ts coverage` builds every reachable spot of eight scenario families for every seat at
2–10 players and six stack depths, and records which source decided it. The full matrix (2,500 cells) is in
[reports/v4-preflop-coverage-2026-11-21.md](../../reports/v4-preflop-coverage-2026-11-21.md). Summary at 100bb and 25bb:

| Dealt in | Spots | 100bb: exact chart | 100bb: chart outside its assumptions | 100bb: heuristic | 100bb: computed (all-in call) | 25bb: chart outside its assumptions | 25bb: heuristic |
|---|---|---|---|---|---|---|---|
| 2 | 6 | 4 (HU chart) | — | 1 | 1 | 3 (HU chart) | 1 |
| 3 | 16 | — | 12 | 2 | 2 | 10 | 2 |
| 6 | 58 | **43** | — | 10 | 5 | 39 | 9 |
| 8 | 96 | — | 53 | 36 | 7 | 49 | 33 |
| 9 | 118 | — | 58 | **52** | 8 | 54 | 48 |
| 10 | 142 | — | 63 | **70** | 9 | 59 | 65 |

Scenario families: first in, one limper, facing an open (every opener seat), squeeze, facing a 3-bet (every 3-bettor),
facing a 4-bet, cold 4-bet, facing an all-in open. "Outside its assumptions" means the library returned a 6-max
60–150bb chart with stated departures (table size, stack, earlier opener seat). Only the 6-handed 100bb game is
covered by data as stated.

### 4.1 The seventeen preflop decision types

| # | Decision | How it is decided today | Verdict |
|---|---|---|---|
| 1 | Raise first in | 6-max chart by players behind; heuristic `OPEN_BY_BEHIND` for seats with >5 behind | [M] widths: UTG 15% at 6-handed, 11% at 9, 10% at 10; BTN 45%, SB 43%. **Identical at 25bb and 100bb.** Plausible at 100bb; no depth adaptation. |
| 2 | Open fold | complement of 1 | as 1 |
| 3 | Open limp / complete | **never** in ring games ([M] limp 0% in 2,821 hands); HU button never limps | No limping strategy at all. SB completing is part of modern no-rake equilibria [H]. |
| 4 | Isolate vs limpers | Greenline ISO for MP / CO / BTN / SB / BB; else 0.6 × open width; over-limp late with pairs and suited hands below the 45th percentile | Iso size `(3 + limpers)bb` fixed; ignores limper count beyond size; no data for 2+ limpers. |
| 5 | Call an open | chart; heuristic `0.25 × openerF` (OOP non-blind), `0.45 × openerF` (CO / BTN) | Greenline's SB / BTN charts never flat (exploitative 3-bet-or-fold). CO vs MP heuristic. |
| 6 | 3-bet | chart; heuristic `clamp(0.3 × openerF, 2.5%, 12%)`; one exploit (`overfold-3bet`) | Sizes 3× IP / 4× OOP of the open (+1× per caller). Not size- or stack-aware. |
| 7 | Facing a 3-bet | chart (6-max), else heuristic 4-bet top 2.6%, call a band when deep and priced | [M] 9-handed UTG facing a 3-bet: heuristic, folds 94.5%. |
| 8 | 4-bet | chart cells, heuristic top 2.6% / cold top 2% | 4-bet size 2.3× (2.7× from the blinds). |
| 9 | Facing a 4-bet | chart only after Hero 3-bet: else top 1.3% all-in | Coarse but conservative. |
| 10 | 5-bet / all-in | the 45% commitment rule converts big raises to all-in; facing a jam → computed chip EV | The only EV-based preflop decision (§5). |
| 11 | Squeeze | **heuristic only** (no pack has `vs-open-call`) | Every squeeze spot in the matrix is heuristic. |
| 12 | Blind defence | BB / SB vs-open charts (6-max); others nearest seat | [M] BB defends 44% vs CO / BTN / SB opens averaging 2.8bb (6-handed simulation): consistent with the charts; the charts ignore the open size. |
| 13 | Multiway calling | heuristic `callW + 0.05 × callers` | No data; no multiway equity or realization. |
| 14 | Short stack | ≤12bb push/fold (HU Nash with one behind, else `jamFraction × JAM_BEHIND_MULT`); ≤16bb re-jam bands | Heuristic away from the HU case; antes ignored in the widths. |
| 15 | Stack depth | 60–150bb charts used from 13bb to any depth with "APPROXIMATION" notes | **No adaptation between 13bb and 60bb, or above 150bb.** |
| 16 | Raise size faced | **ignored**: `SpotQuery` has no size; `PreflopSpot.sizing` is never read by `find` | A 5bb open is defended like a 2.5bb open. |
| 17 | Rake and caps | **not modelled anywhere** | PokerNow play money is usually raked at 0 [H], so lower priority, but packs and EV must take a rake parameter. |

### 4.2 Six-max data at eight to ten players [F, M]

1. **Early seats have no data.** At 9-handed, UTG / UTG+1 / MP (6–8 behind) open from `OPEN_BY_BEHIND` (11%, 13%,
   15%) and use heuristics for every response.
2. **Facing an open from those seats, Hero uses the 6-max UTG chart** (`preflop.ts` `lookup`: `villainBehind > 5` →
   5, tagged "APPROXIMATION"). [M] At 9-handed, HJ / CO / BTN / SB / BB defend against a UTG open exactly as against
   a 6-max UTG open (for example BB 7.1% 3-bet + 17.8% call, SB 15.8% 3-bet).
3. **The two halves of the model disagree.** The opponent-range model (`opponentPreflopRange`) gives the same 9-handed
   UTG opener the heuristic 11% band, because the library has no RFI spot with 8 behind. Hero defends as if the opener
   had 15.5%, while the range used postflop is 11%. Defending against a range about 30% wider than the one assumed
   later is a systematic over-defence against early-position opens [H, plausible; magnitude unmeasured].
4. **"Same players behind" is the right first-order mapping** for first-in decisions (LJ ≈ 6-max UTG). It ignores the
   card removal of the earlier folds and the different multiway frequencies, small effects at 100bb [H].

---

## 5. How preflop expected value is estimated today [F]

| Quantity | Present? | Where / how |
|---|---|---|
| Pot odds | yes, all-in calls only | `preflop.ts` branch 1: `callEv = equity × winnable − toCall`, margin `(0.015 + 0.02 × behind) × winnable` |
| Equity vs ranges | display only, except all-in calls | `multiwayEquity` (4,000 samples all-in; 1,200 display) against `toWeighted(v.range)` |
| Fold equity | **no** | Charts encode it implicitly; no computation of P(fold) for any raise |
| Blockers | partly | Card removal in equity sampling and `removeDead`; chart lookups are per class; combo overrides possible (`PreflopSpot.hands` "AhKh") but unused |
| Equity realization | **no** preflop | Postflop has `realizationFactor` (heuristic) |
| Reverse implied odds | **no** | |
| Effective stack | partly | Branch selection (≤12 / ≤16 / facing jam), commitment rule at 45% of the stack |
| SPR | **no** | |
| Position | via the chart key only | |
| Rake | **no** | |
| Uncertainty of opponent responses | **no** | All-in call margin only |
| Multiway | partly | All-in call vs all committed ranges; `winnable` side-pot capped; players behind only via the margin |

**Approximations that can produce systematic errors.**

1. **Facing an all-in:** jam ranges are percentile bands (`jamFraction`, `JAM_BEHIND_MULT`) of an equity ordering,
   shrunk by profile tendencies. A wrong width moves the call threshold directly. The players still to act are
   covered only by a margin of 2% of the winnable pot each; their over-calls (which cut Hero's equity) are not
   simulated [H].
2. **`facingJam` triggers at `toCall ≥ 0.4 × stack`** even when the raiser is not all-in. Hero's own re-raise option is
   then dropped (call or fold only) [F].
3. **Raise sizes are fixed** (2.5bb open, 3bb SB, `(3 + limpers)bb` iso, 3× / 4× 3-bet, 2.3× / 2.7× 4-bet). They are
   chosen without reference to the size the chart assumes. Greenline's UTG chart says "Sizing: 3bb" [F].
4. **Charts are applied whatever the open size** (item 16): too-wide defence against large opens, too-tight against
   min-raises [H].
5. **The heuristic bands use one equity ordering for every purpose**, so suited and connected hands, which realise
   better than their all-in equity, are under-weighted in calling and opening bands [H].

---

## 6. Proposed v4 preflop architecture [P]

Position-specific baseline ranges combined with an EV comparison, with bounded deviations. The baseline is a prior,
not a chart lookup that ends the decision.

```
                      ┌──────────────────────────── features ─────────────────────────────┐
 HandState ──► PreflopContext: players dealt, behind(Hero), behind(each raiser), limpers, callers,
                       raise level, size faced (bb and ×), effective stack per opponent, SPR after a call,
                       ante, straddle, rake {pct, cap, no-flop-no-drop}
        │
        ├─► BaselinePrior π0(a | context, holding)       versioned packs, provenance-tagged, keyed by
        │      (players-behind, stack bucket, size bucket, scenario); explicit "nearest" rules; heuristic last
        │
        ├─► ResponseModel R(opponent, context, size)     P(fold), P(call), P(raise) of each opponent left to act,
        │      population prior × position × size, player posterior (Beta / logit-normal), with its uncertainty
        │
        ├─► EV evaluator for each candidate a ∈ {fold, call, raise s1..sk, all-in}
        │      EV(a) = Σ_r R(r) · [ fold-out: pot won − rake
        │                          | continue: E_eq(hand vs range_r) · realization(pos, SPR, players, hand class)
        │                                       · final pot − investment − rake ]
        │      equity from the 169×169 all-in matrix (src/solver/preflop/equity-matrix.json) with card removal,
        │      Monte Carlo only multiway; reported with a model-uncertainty interval, not only sampling error
        │
        └─► PolicyCombiner                              π(a) ∝ π0(a) · exp(β · ΔEV_lcb(a)), deviation from π0
               capped (total-variation ≤ δ per spot); a deviation needs a positive lower confidence bound;
               seeded sampling (hashSeed(seed, handId, events, seat)) as today
```

Design rules:

- **Baseline first.** With no evidence the combiner must return π0. That makes the change testable: with
  `exploitWeight = 0` and no opponent data, v4 preflop must equal the baseline.
- **EV decides only where the baseline is silent or where it is clearly beaten.** A deviation from π0 requires
  `ΔEV_lcb > 0`, with the lower bound covering both the response-model posterior and the Monte Carlo error. This is
  the preflop analogue of v2's pessimistic scenario, but applied to deviations, not to every bet.
- **Realization is a table, not a constant:** by position (IP / OOP), SPR bucket, number of players and hand class
  (pairs, suited connectors, offsuit broadway). Its values must come from a measurement (postflop simulation of v2 /
  v3 against the benchmark population) and be stored with that provenance [E: not measured yet].
- **Sizes become candidates.** At least two open sizes and two 3-bet sizes are evaluated, and the size faced enters the
  context.
- **Data source rules.** Pack precedence by evidence (verified solver data > verified chart > unverified chart >
  heuristic), never by registration order. Exploitative charts are tagged as such and excluded from the baseline.
- **Rake** enters every pot computation as `{percentage, cap, noFlopNoDrop}` from Settings (default 0, PokerNow play
  money [H]).
- **Preflop does not need a search.** One evaluation is about 4–6 candidates × (one response distribution per
  opponent left to act) × matrix lookups. That is sub-millisecond heads-up and a few milliseconds multiway with
  Monte Carlo [H, to measure in Phase 3.3].

What it deliberately does not do: invent solver ranges. Where no validated data exists the prior is the current
heuristic, flagged, and the EV layer may move away from it only with evidence.

---

## 7. Postflop architecture and multiway coverage (summary; detail in the roadmap)

- **Keep v3's heads-up search unchanged** as the heads-up postflop engine candidate and v2 as the default and the
  fallback. Neither is shown to be better than the other: [R] Phase 2.5 final seed 13300, v3pr − v2 +1.1 ± 11.4 bb/100.
- **v2 handles multiway today**: a joint simulation of all opponents for one street plus a one-bet rollout of the next
  street (`postflop.ts`). Its bet sizes when facing a bet are 0.55 and 1.0 of the pot after calling, and 0.33 / 0.66 /
  1.0 / 1.5 when first in. Rollout bets are fixed at 50% of the pot (`ROLLOUT_BET`).
- **Three-way search is not a direct extension of v3.** The tree grows with every player's actions at every node; a
  third player multiplies the opponent-node count and the deal sampling becomes joint. v3 already takes 20–265 ms
  heads-up ([R] `docs/bot/PHASE_2_4_MODEL_CALIBRATION.md` §8). A three-way tree with the same sizes is roughly an order of magnitude larger
  [H]. The opponent model (one response function per player, independent given the cards) also ignores the way
  players behind condition each other's continuing ranges, which is not mathematically sound for multiway [H].
- **Staged proposal [P]:** (1) three-way search restricted to the current street, one bet size and one raise size,
  with the river exact and earlier streets by the realization factor; (2) four or more players stay on v2; (3) side
  pots and all-ins stay exact through the rules engine (`table/engine.ts` and `pots.ts` already do this); (4) explicit
  fallbacks with stated reasons, as v3 does now (`agent.ts` `newSearchV3`).

---

## 8. Summary of the preflop audit

1. Only the 6-handed, 100bb, no-straddle game is covered by chart data as stated. Every other table size and depth
   uses 6-max data outside its assumptions or a heuristic: at 9 handed 44% of spots are heuristic.
2. Positions and heads-up rules are correct. Labels for 7–8 handed differ from common names but do not affect
   decisions.
3. The data that decides is unverified and partly exploitative (Greenline 3-bet-or-fold cells), and it wins over the
   alternative because it is registered first.
4. Preflop EV is computed only for all-in calls. Fold equity, realization, SPR, rake, the size faced and opponent
   responses do not enter preflop decisions (one exploit note aside).
5. v4 preflop should be "validated prior + EV comparison with bounded, evidence-gated deviation", using the existing
   equity matrix, library and seeded sampling.
