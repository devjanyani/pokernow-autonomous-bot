# Phase 3.1c: preflop decision consistency (QJs and 56s folds)

Date 2026-11-27. Starting point 0.9.3, commit `19c2ed0`, branch `autonomous-bot`. No version change: the extension's
behaviour is unchanged.

## 0. Summary

- **Both folds are fully reproduced and explained.** Each came from one of the two heuristic branches whose
  continuing range is a fixed percentile band of the equity ordering and never reads the price:
  - **h25 (QJs):** the "vs raise over limpers" band. It treats Hero's spot like a cold call of a fresh open, which
    misclassifies the 1 bb Hero had already put in.
  - **h5 (56s):** the "vs 3-bet without a chart" band. It assumes Hero's raising range was the top 28% of the equity
    ordering, while Hero had actually raised 56s from the CO isolation chart. 56s sits at the 57th percentile, so it
    is outside the band at any price.
- **Neither fold is demonstrably negative-EV.** Under the engine's own ranges, calling is worth more than folding
  against most simulated opponent families (§3). The answer turns on two things the data cannot settle:
  - **Range width.** With opponent ranges twice as strong as modelled, the h5 call's point estimate is negative
    against 8 of 10 families, none significantly. The h25 call against the engine's own self-model is −1.0 ± 0.9 bb.
  - **Hand quality.** The valuation does not separate hand quality: calling with **72o** at the h5 spot also comes out
    positive against most families. The positive values come mostly from the simulated opponents giving up after the
    flop, not from anything specific to 56s.
- **Candidate correction:** a price check in exactly those two branches (`PreflopCorrections.priceAware`). It
  discounts own-range equity by the existing flop realisation factor and adds the all-in rule's margin.
  - **Not adopted; the strategy is unchanged.** It is off by default and no shipped engine sets it.
  - **Benchmark result:** it changed 1.2% of the decisions it could touch and made no measurable difference
    (development +0.8 ± 2.9 bb/100, held-out +0.6 ± 3.0; §4).
  - **Defect found:** heads-up against a small 3-bet it calls any two cards, which is the raw-equity conversion the
    brief rules out.
- **The punishing opponent is a negative result in its own right.** I wrote the `value-punisher` from a spec to
  punish loose calling, in three revisions. Against every independent pool, including it, a control that calls every
  price-blind fold *gained* (+24 to +43 bb/100). Only self-play against version 2 moved it the other way (−9.8 ± 16.2).
  So a "no degradation" result from these pools cannot show that a calling correction is safe.

## 1. The two recorded spots (fixture `tests/bot/fixtures/live-2026-11-21-preflop.json`)

The fixture holds anonymised records of hands 25, 5 and 58 from table T8 of the 2026-11-21 bundle.
- **Anonymisation:** seat labels replace names, player ids and the table id, and only Hero's cards and the board are
  kept.
- **Leak check:** none of the bundle's 277 player names or table ids occurs in the fixture.
- **Rebuild:** each point is rebuilt by `rebuildHand(record, events)`, and the engine is re-run the way
  `sim/bot/replay-decisions.ts` re-runs a recorded point (version 2, seed 7, no learned profiles).

### 1.1 h25 · 10: Q♦J♦, "call 2 into 17"

| Item | Value |
|---|---|
| Table | 8 dealt in, 10 seats, blinds 1/2, no ante, no rake (every valid hand's result reconciles with the next hand's stacks without one) |
| Hero | UTG, 69 chips; effective stack 69 (34.5 bb) |
| Sequence | SB 1, BB 2, **UTG (Hero) limps 2** (a manual action, audit §3.1), UTG+1 folds, MP limps 2, HJ raises to 4 (a min-raise), CO calls 4, BTN folds, SB folds, BB calls 4 |
| Price | pot 17, call 2 → needs **10.5%**; Hero's 2 already in are sunk; SPR after the call 3.4 |
| Behind Hero | MP (a limper, can still squeeze) |
| Engine's ranges | MP limp 36.6% (heuristic band); HJ iso 17.1% (Greenline 6-max MP-ISO, approximation at 8-handed); CO call 11.1% (band); BB defend 17.8% (Greenline BB-vs-open-MP, approximation) |
| Equity vs those ranges | **21.4% ± 0.6** (20,000 samples); 19.8% against the strongest half of each range |
| Recommendation | fold 100%; source heuristic, situation facing-iso. Basis: "vs HJ raise over limpers (est. 17% range) + 2 caller(s), squeeze sizing: 3-bet top 4.4%, continue top 9%" |
| Hero's class | QJs at the 15.8–16.1% percentile of the equity ordering, outside "continue top 9%" |

### 1.2 h5 · 13: 5♦6♦, "call 10 into 41"

| Item | Value |
|---|---|
| Table | 8 dealt in, blinds 1/2, no ante, no rake |
| Hero | CO, 97 chips; effective 97 (48.5 bb) against UTG+1 (114) |
| Sequence | SB 1, BB 2, UTG limps, UTG+1 limps, MP folds, HJ limps, **CO (Hero) isolates to 12** (bot, chart "Greenline CO-ISO"), BTN, SB, BB, UTG fold, **UTG+1 limp-re-raises to 22** (1.83×), HJ folds |
| Price | pot 41, call 10 → needs **19.6%**; Hero's 12 are sunk; SPR after the call 1.47; nobody behind |
| Engine's range | UTG+1 3-bet 11.8% (heuristic band `0.3 × opener range`, plus a 30% weight on a lower band) |
| Equity | **34.8% ± 0.7**; 30.5% against the strongest half |
| Recommendation | fold 100%; heuristic, facing-3bet. Basis: "vs 3-bet without a chart: 4-bet top 2.6%, call a band of the opening range when deep"; also flagged out-of-distribution ("Hero's hand is not in the range the model gives a player who took this preflop line") |
| Hero's class | 56s at the 56.6–56.9% percentile; the band is `clamp(0.5 × openFraction(3 behind) = 0.14, 5%, 16%)` |

### 1.3 Control h58 · 13: K♦Q♠, "call 18 into 68", five opponents

- **Spot:** 10 dealt in, 112 bb.
- **Needed:** 20.9%; equity against the five modelled ranges is 17.5%.
- **Engine:** the same band gives fold 34% / call 66%. The 0.9.1 bot sampled fold; today's re-run samples call.
- **Candidate:** keeps the fold share (§4).

## 2. Audit of preflop fold conditions (`src/bot/strategy/preflop.ts`)

Every place the engine can fold while the pot odds look favourable:

| # | Branch | Reads the price? | What decides |
|---|---|---|---|
| 1 | facing an all-in, or a call ≥ 40% of the stack (`computed`) | **yes** | chip EV vs every committed range; margin 1.5% of the winnable pot + 2% per player behind. Realisation is 1 (no later betting) |
| 2 | short stack ≤ 12 bb, unraised | no | jam band or fold (completing the small blind is never considered) |
| 3 | ≤ 16 bb facing a raise | partly | re-jam band; the big blind calls only if price < 30% and the hand is in the top 45% |
| 4 | unopened (RFI) | no price (cost of folding is 0 except the blinds) | chart, or the `openFraction` band |
| 5 | facing limpers | no | iso band `0.6 × openFraction`; over-limp only at CO, BTN and SB with pairs or suited hands (audit §6.2) |
| 6 | **facing one raise, no chart** (h25) | **no** | 3-bet `0.3 × opener width`, continue `+0.25 × opener width` (more in the BB and at CO/BTN) |
| 7 | **facing a 3-bet of Hero's raise, no chart** (h5) | **on/off only** | call band `0.5 × Hero's openFraction` (5–16%), only if ≥ 40 bb and price < 36% |
| 8 | cold facing a 3-bet, or Hero called and faces a 3-bet | no | 4-bet top 2%, fold the rest |
| 9 | facing a 4-bet or more, no chart | no | all-in top 1.3% |
| 10 | chart branches (library) | through the chart only | the chart's mix; approximations are stated |

The terms the brief asks to separate:

- **Raw showdown equity:** branches 6–9 never compute it. It is computed for display after the decision, against the
  players who have entered.
- **Pot odds:** only branch 1 (and the gates in 3 and 7) read them.
- **Realisable equity:**
  - preflop it is modelled only implicitly, by the bands;
  - branch 1 has no later betting, so realisation is 1;
  - postflop, `realizationFactor` (flop 0.92, −0.07 out of position, −0.02 per extra opponent) is applied when later
    streets are not simulated.
- **Reverse implied odds, position, stack depth and rake:** none of them enters branches 6–9.
  - Position enters only through which band is used (BB and CO/BTN get wider ones).
  - Depth enters only through the 40 bb gate of branch 7.
  - Rake is never modelled (the live table had none).
- **Multiway equity and opponents who can still raise:** they enter branch 6 only as a smaller 3-bet band and wider
  BB/late call bands (`+0.03` or `+0.05` per caller), and branch 1 through the margin.
- **Uncertainty in ranges:** stated in the basis ("heuristic", "approximation") but never priced.

**Double counting and misclassification:**

1. **Branch 6, misclassified investment (h25).**
   - The continue band is a fraction of the opener's range, built for a cold call of a fresh open.
   - When Hero has already limped, the decision is a much cheaper one (2 into 17, 10.5%, instead of 4 into 13,
     23.5%), but the same band is used.
   - The chart path flags this case ("Hero limped first, the data assume Hero had not entered the pot"); the heuristic
     path does not.
2. **Branch 7, incompatible range assumptions (h5).**
   - The call band is a share of `openFraction(Hero's seat)`, the top 28% of the equity ordering.
   - Hero's actual raise came from the isolation chart, which raises suited connectors the equity ordering ranks
     around 50–60%.
   - So the hands Hero raises and the hands the band lets continue come from different orderings. A raised 56s is
     outside the band at any price.
   - The engine already flags this ("out-of-distribution: Hero's hand is not in the range …").
3. **No double counting of costs.** The bands do not subtract sunk chips: they ignore cost altogether. Branch 1 counts
   only the increment (`callEv = equity × winnable − toCall`, sunk chips not subtracted).
4. **Opponent ranges:** each is built once per decision and used consistently in branch 1 and in the display. The
   limp-re-raise in h5 is modelled as an ordinary 3-bet band (11.8%). Whether a limp-re-raise is narrower is exactly
   the range uncertainty §3 tests.

## 3. Continuation-EV comparison (`sim/bot/preflop-consistency.ts`)

### 3.1 Method

For each candidate (fold, call, the engine's raise size, all-in) at the recorded state:

- **Opponents' cards** are drawn jointly from the engine's own ranges for them, with card removal. Separately, they
  are drawn from the strongest 50% of each range (width 0.5: ranges twice as strong as modelled).
- **Play-out:** the hand is played to the end by `sim/bot/reference.ts`. Opponents use one policy family; Hero
  continues with version 2. One board run-out per deal; 1,200 deals per row.
- **Accounting:**
  - fold is exactly 0 from the decision point;
  - a call costs only the increment, and chips already in are sunk;
  - later betting is played, not assumed;
  - rake: none in the table below (the recorded table had no rake observed). A 5%/3 bb no-flop-no-drop option exists
    (`--rake 1`) and is covered by tests.
- **Pairing:** common random numbers across candidates. Errors are 95% intervals over deals. Seeds 33500 for the
  recorded hands, 33600 for control hands.
- **Families:**
  - `model`: every opponent plays version 2 itself;
  - the seven independent programs;
  - `value-punisher`: revision 1 in the main table; revision 3, the benchmarked one, in §3.2.

### 3.2 Results: call minus fold, bb (95% interval)

| Family | h25 QJs, modelled | h25, ×2 stronger | h5 56s, modelled | h5, ×2 stronger |
|---|---|---|---|---|
| model (v2 self) | +0.58 ± 0.90 | **−0.98 ± 0.91** | **+2.18 ± 1.45** | −1.05 ± 1.46 |
| pot-odds-caller | **+4.56 ± 1.67** | **+3.61 ± 1.70** | **+3.22 ± 1.91** | −0.10 ± 1.85 |
| mdf-defender | **+2.46 ± 1.17** | **+2.03 ± 1.30** | **+1.99 ± 1.73** | −0.59 ± 1.76 |
| trapper | **+6.93 ± 1.95** | **+5.76 ± 2.11** | +1.18 ± 1.76 | −1.67 ± 1.83 |
| nit | **+1.11 ± 0.89** | −0.06 ± 0.91 | **+8.87 ± 1.20** | **+5.30 ± 1.34** |
| raiser | **+5.12 ± 1.74** | **+3.42 ± 1.75** | **+2.30 ± 1.67** | −1.84 ± 1.76 |
| maniac | **+7.09 ± 2.18** | **+1.99 ± 1.45** | +1.54 ± 1.83 | −2.02 ± 1.78 |
| adaptive-punisher | **+6.97 ± 1.89** | **+6.33 ± 2.11** | **+2.86 ± 1.71** | −0.90 ± 1.77 |
| value-punisher rev. 1 | **+1.81 ± 1.14** | +0.74 ± 1.14 | **+5.68 ± 1.35** | **+1.88 ± 1.47** |
| value-punisher rev. 3 | **+3.99 ± 1.53** | **+3.23 ± 1.53** | **+2.13 ± 1.56** | −1.39 ± 1.60 |

Bold marks a 95% interval that excludes 0.

**Effective realisation** under the self-model: `(EV_call + toCall) / (equity × pot after call)`, using the table's
chip values (bb × 2).
- h25: (1.16 + 2) / (0.214 × 19) = **0.78**. The candidate's factor, 0.79, is almost the same.
- h5: (4.36 + 10) / (0.348 × 51) = **0.81**, below the candidate's 0.92.

**Control hands at h5** (call minus fold, bb, modelled ranges):

| Family | 72o (25.6% raw equity) | K3o (32.6%) |
|---|---|---|
| model | **+2.03 ± 1.10** | **+3.34 ± 1.20** |
| pot-odds-caller | −0.34 ± 1.64 | **+4.49 ± 1.91** |
| trapper | **−2.69 ± 1.62** | **+3.34 ± 1.82** |
| nit | **+8.98 ± 0.99** | **+10.54 ± 1.14** |
| value-punisher rev. 3 | +0.98 ± 1.23 | **+5.16 ± 1.56** |

**What this shows:**
- Calling a 1.8× 3-bet with any two cards at SPR 1.5 "profits" against most simulated families. Those families give
  up too easily after the flop, especially the version-2 self-model, which plays its 3-bet range out of position.
- The rollouts therefore measure the opponents' post-flop leaks more than the merit of 56s. They do not support
  "56s calls, 72o folds".
- The raise and all-in columns (JSON in the scratch outputs; not tabulated here) are even larger against several
  families for the same reason, and strongly negative against the stronger ranges. Nothing here was read as a reason
  to raise.

**Limitations:**
- The opponents' real strategies are unknown. The families bracket plausible play; none is a model of the actual
  players.
- One run-out per deal, so chance and policy noise share the interval.
- Hero's continuation is version 2, which is itself what is being judged.
- The ranges are the engine's own; the width-0.5 column is a stress test, not an estimate.
- No ICM; chip EV only.

### 3.3 Verdict per fold

| Fold | Demonstrably negative-EV? | Why |
|---|---|---|
| h25 QJs, 2 into 17 | **No** (likely −EV against most families, but not robustly) | Calling beats folding significantly against 9 of 10 rows under modelled ranges. The engine's own self-model gives +0.6 ± 0.9 and −1.0 ± 0.9 with stronger ranges |
| h5 56s, 10 into 41 | **No** | Significantly positive under the modelled 11.8% range against 8 of 10 rows. With ranges twice as strong the point estimate is negative against 8 of 10 (none significantly; one significantly positive). The same method also "profits" with 72o, so the value comes from the price and the simulated opponents' leaks, not the hand |

## 4. Candidate correction (off by default, not adopted)

**`PreflopCorrections.priceAware`** (`src/bot/strategy/preflop.ts`) applies only in branches 6 and 7. When the band
gives a hand some fold weight, the check runs:

    R × equity(own ranges of the players in the pot) × (pot + call) − call  >  (0.015 + 0.02 × players behind) × (pot + call)

- **What it reuses:** `R` is the existing postflop `realizationFactor('flop', in position?, opponents, 0)`; the margin
  is that of the computed all-in rule.
- **What it does:** it moves the band's fold share to call. It never adds raises.
- **What it leaves alone:** charts, the all-in rule, short-stack branches and every other branch.
- **Explanation:** the result is stated in the basis (`phase 3.1c: price check …`).
- **RNG:** it draws randomness only when the flag is on, so version 2's decisions are bit-identical without it
  (tested).

**Behaviour:**
- calls h25 and h5;
- keeps h58's 34% fold;
- folds QJs at h25 when the iso is 12 instead of 4;
- folds 72o at h25;
- **but calls 72o and K3o at h5**: `R` does not depend on the hand, so raw equity heads-up against a tight range is
  converted straight into a call. Tested as a known limitation.

### 4.1 Benchmark: development seeds (33000 + cell index, 4,000 deals per cell)

Suite `c31` of `sim/bot/v4-bench.ts`, 20 cells, three engines:
- `v2`;
- `v2-price` (the candidate);
- `neg-loose-call`, a negative control: version 2, except every fold in branches 6 and 7 becomes a call.

Pools:
- **ring:** six and nine players, 40/100/200 bb, standard or big sizes, the earlier independent pools;
- **punisher:** mostly value-punisher rev. 3 plus one loose limper;
- **self-play:** eight version-2 opponents.

| Group | v2-price − v2 (bb/100) | with 5% rake | neg-loose-call − v2 |
|---|---|---|---|
| all 20 cells | +0.8 ± 2.9 | +0.7 ± 2.9 | **+32.1 ± 11.7** |
| ring pools (12) | +1.2 ± 4.1 | +1.1 ± 4.1 | **+43.1 ± 17.5** |
| punisher pools (6) | +0.8 ± 4.5 | +0.7 ± 4.4 | **+24.3 ± 16.0** |
| self-play (2) | −1.3 ± 6.2 | −1.3 ± 6.0 | −9.8 ± 16.2 (nine-self-40 alone **−16.1 ± 14.9**) |

Per cell, the candidate ranged from −7.4 ± 11.4 to +17.1 ± 23.7, and no cell's interval excluded 0.

Process measures:

| Engine | Preflop decisions | VPIP | Decisions in branches 6–7 | Changed to call | Illegal actions | Legality-gate replacements |
|---|---|---|---|---|---|---|
| v2 | 81,636 | 20.8% | 12,286 | 0 | 0 | 0 |
| v2-price | 81,630 | 20.8% | 12,286 | **151 (1.2%)** | 0 | 0 |
| neg-loose-call | 83,154 | 33.1% | 12,295 | 9,927 | 0 | 0 |

- **Where the changes fell:** facing-3bet fold 50.5% → 45.4% (1,642 decisions); facing-iso 76% → 55% (42 decisions).
- **Why so few:** the simulated opponents seldom make the small 3-bets and min-raise isolations that produced the live
  spots.

### 4.2 Benchmark: held-out seeds (34000 + cell index, run once)

Same 20 cells, seeds 34000 + cell index. The seeds and the decision rule were written into
`reports/V4_PREREGISTERED_SEEDS.md` before this run. Each cell was run exactly once; the run was split across
processes by cell, and duplicated rows from an overlap matched hash for hash. All tables are in
[PHASE_3_1C_BENCHMARK.md](PHASE_3_1C_BENCHMARK.md).

| Group | v2-price − v2 (bb/100) | with 5% rake | neg-loose-call − v2 | with rake |
|---|---|---|---|---|
| all 20 cells | **+0.6 ± 3.0** | +0.6 ± 3.0 | **+31.5 ± 11.4** | **+27.8 ± 11.3** |
| ring pools (12) | +0.9 ± 3.8 | +0.9 ± 3.7 | **+43.7 ± 17.4** | **+39.5 ± 17.1** |
| punisher pools (6) | +1.1 ± 6.3 | +1.0 ± 6.2 | **+22.8 ± 14.9** | **+20.1 ± 14.7** |
| self-play (2) | −2.4 ± 6.5 | −2.5 ± 6.3 | −15.4 ± 16.2 | **−19.2 ± 15.8** |

- **Per cell:** the candidate ranged from −10.3 ± 11.3 (nine-self-100) and −8.9 ± 10.0 (six-100-std) to +9.2 ± 12.4
  (nine-100-std). No cell's interval excludes 0.
- **Changes:** it changed 162 of 12,464 decisions in branches 6–7. Facing an iso the fold rate went 75% → 50%, over
  only 48 decisions; facing a 3-bet, 52.9% → 47.4%.
- **Process measures:** no illegal actions and no legality-gate replacements for any engine. Preflop latency median
  1.6 ms, p95 4.1 ms (v2 2.9 ms).

Reading: no measurable effect in either direction. The candidate acts too rarely in these pools to matter, and the
pools cannot penalise the over-calling it risks.

### 4.3 Decision

The rule was registered before the held-out run (`reports/V4_PREREGISTERED_SEEDS.md`, Phase 3.1c); all four
conditions had to hold. **Conditions 3 and 4 were already known to fail on the development evidence when the rule was
written**, so the held-out run was for the record, not a test the candidate could pass:

1. pooled lower bound above 0: **fails** (+0.6 ± 3.0; lower bound −2.4);
2. no cell significantly negative: holds;
3. **the punishing-opponent check is not valid.** Loose calling gains against the punisher pools; the only pool where
   it loses is version 2 itself;
4. **the stronger-range valuation of h5 is not positive**: its point estimate is negative against 8 of 10 families, and the method does not separate 56s
   from 72o.

**Result: strategy unchanged.** `priceAware` stays a benchmark-only flag. The two folds are explained but not shown to
be mistakes robustly enough to change the engine. Their real fix is a sourced continuing range, which belongs to the
Phase 3.2 data work, not a price rule:
- for branch 7, a range consistent with Hero's actual raising chart;
- for branch 6, a range that accounts for Hero's limp.

## 5. The punishing opponent (`valuePunisherPolicy`, `src/bot/sim/independent.ts`)

**Spec (written before use):**
- Preflop it plays narrower, stronger ranges than a percentile model gives its line, at small, tempting sizes:
  - iso the top 8% to a min-raise;
  - 3-bet the top 4% to 1.8×;
  - squeeze the top 10% to 4× + 1× per caller;
  - 4-bet jam the top 2.5%.
- Postflop it plays for value.

**Revisions.** Each revision was judged **only** against the negative control, never against the candidate.

| Revision | Postflop | neg-loose-call − v2 on its pools |
|---|---|---|
| 1 | bets ¾ pot with good hands, continues only with the top ~40%, never bluffs | **+72.9 ± 23.4** (mixed pool) |
| 2 | sticky: continues with every hand above a price-scaled bar; never bluffs | **+29.5 ± 20.4** |
| 3 (kept) | polar: value plus about one bluff per two value bets, sticky defence, more squeezes | +15.1 ± 20.0 (dev check), +24.3 ± 16.0 in the full dev run |

None of the three punishes loose calling: a caller that folds correctly to their bets loses nothing.
- **Rule-based stand-ins aren't enough.** Building an opponent that does punish loose calls needs more than these
  rule-based programs. Version 2 itself is the only pool that moved the control the right way.
- **Pools stay separate.** It is kept in a separate `PUNISHER_FACTORIES`, so every earlier pool, test and
  pre-registered cell is unchanged.

## 6. Tests

`tests/bot/preflop-consistency-31c.test.ts`, 19 deterministic tests:
- **Fixture:** reconstruction of h25 · 10 and h5 · 13 (seats, positions, stacks, blinds, pot, price, players behind),
  and that no names remain.
- **Baseline explanation:** each band fold, its basis line, and own-range equity above the price.
- **Unchanged default:** `priceAware: false` is identical to version 2.
- **Candidate behaviour:**
  - calls the two spots without adding raises, and its actions are legal;
  - the h58 control keeps its fold share;
  - poor-price QJs folds; 72o multiway folds;
  - 72o heads-up calls, the known limitation;
  - chart spots are untouched.
- **Tools:** `strongest()`, joint hole drawing without collisions, the reference evaluator's preflop guard, fold = 0,
  "call then give up" losing exactly the increment, rake monotonicity and no-flop-no-drop, and pairing in
  `valueSpot`.
- **value-punisher:** legal play and its sizes.

## 7. Remaining limitations

- The recorded folds remain the engine's behaviour. Branches 6 and 7 still ignore the price, and branch 7 still uses
  a range incompatible with Hero's chart raise.
- The simulator's opponents are exploitable by loose calling, so the benchmark cannot detect the cost of calling too
  much. A punishing opponent strong enough for that test is still missing (roadmap §1.2 item 1 remains open).
- Valuations depend on the opponents' post-flop play and on the engine's ranges. Neither is known for the live
  players, and two recorded spots are anecdotes, not a measurement.
- The candidate's realisation factor does not depend on the hand, which is why it calls 72o heads-up.

## 8. Verification

- Full suite: **1,301 / 1,301** tests in 97 files (`npx vitest run --maxWorkers=4 --minWorkers=1`), including the
  19 new tests.
- `tsc --noEmit`, `npm run typecheck:tools`: pass. Lint: 0 errors. Production build: pass.
- Chromium, built extension against the stand-in table, run one at a time:
  - `bot:e2e` 24/24;
  - `bot:e2e:recommend` 32/32;
  - `bot:e2e:exec` 28/28;
  - `bot:e2e:dashboard` 40/40;
  - `e2e-v3` 27/27.
  These are the same counts as 0.9.3. Not run on live PokerNow.
- Shipped preflop behaviour is unchanged: `priceAware` is off unless set, and a test checks that version 2's
  candidates and basis are identical with the flag explicitly false.
