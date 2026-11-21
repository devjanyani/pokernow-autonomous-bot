# Phase 3.1: preflop position mapping, decision classification and chart selection

Branch `autonomous-bot`, from `c256433` (Phase 3.0 audit), version 0.9.2, 2026-11-21.

**No production default changed.**
- v1, v2 and v3 make the same decisions as before. This is tested, and two published Phase 2.5 benchmark rows were
  reproduced bit for bit.
- The chart-selection corrections exist as offline options and are **not adopted**: the paired benchmark does not
  support them ([PHASE_3_1_EVALUATION_BASELINE.md](PHASE_3_1_EVALUATION_BASELINE.md)).
- The settings change of this release (timing modes) is reported in the evaluation baseline report, §6.

## 1. Position mapping (2 to 10 players)

`src/bot/table/positions.ts` was already correct for every case tested below. One defect was found and fixed: at 10
dealt in with a dead small blind, two seats were both labelled "MP". The labels are now UTG, UTG+1, UTG+2, UTG+3, MP,
LJ, HJ, CO. Labels never affected decisions, which use `behindPreflop`; they did affect the display.

`tests/bot/positions-exhaustive.test.ts` (9 tests) covers:
- **756 layouts:** 2–10 players × every button seat × contiguous and gapped seating (empty seats) × with and
  without a dead small blind;
- **invariants for each layout:**
  - one button, one big blind, one small blind (none when it is dead);
  - preflop and postflop orders are permutations;
  - the big blind is last preflop and the button last postflop;
  - the first postflop actor is the first seat left of the button;
  - `behindPreflop = n − 1 − order`;
  - the 6-max chart key follows players behind;
  - labels are unique and follow the documented early-position labels;
- **heads-up rules:** the button posts the small blind, acts first preflop and last after the flop;
- **dead button, straddle** (the straddler acts last; action starts on the straddler's left);
- **rules-engine order:** for 2–10 players and every button seat the turn passes in preflop order exactly once around,
  and the first actor on the flop is correct;
- **sitting-out and zero-stack players:** they get no position and are never asked to act;
- **players leaving and joining between hands:** the next hand is positioned from its own dealt-in seats, using the
  dead-button rule;
- **the counts kept apart:** seats, seated, dealt in, in pot, can act (`tableCounts` and `classifyPreflop`).

Position groups (early / middle / late / blinds) are exposed by `positionGroup()`. Opponent statistics keep their
existing Early / Late / Blinds groups unchanged (no new profile heuristics).

## 2. Classification of the preflop decision

New: `src/bot/strategy/preflop-context.ts` `classifyPreflop(h, heroSeat)`. It is pure, decides nothing, and is
recorded with every preflop decision (`Decision.preflop`: situation, source, a one-line context).

| Situation | Meaning |
|---|---|
| `unopened` | nobody entered; Hero (not the BB) may open / limp / fold |
| `limped-bb-option` | big blind after limps, no raise |
| `facing-limpers` | limps, no raise, Hero not the BB |
| `facing-open` | one raise, no caller before Hero |
| `facing-open-callers` | one raise and callers (squeeze opportunity) |
| `facing-iso` | Hero limped and faces a raise |
| `facing-3bet` | Hero opened and faces a re-raise, nobody else in |
| `facing-squeeze` | Hero opened and faces a re-raise with a caller before or after it, or Hero flat-called the open and faces a re-raise |
| `cold-facing-3bet` | a raise and a re-raise before Hero (cold 4-bet spot) |
| `facing-4bet`, `facing-5bet-plus` | Hero's 3-bet / 4-bet+ was re-raised |
| `cold-facing-4bet-plus` | three or more raises, Hero has not raised |

Flags:
- `facingAllIn`: the last raise is all-in, or the call is at least 40% of Hero's stack (`decidePreflop`'s rule);
- `shortStack`: effective stack ≤ 16bb;
- `blindDefense`.

Recorded fields:
- Hero's position, group, players behind and chart key;
- the four counts;
- players still to act after Hero;
- limpers, raise count and Hero's own raise level;
- the opener and the last raiser (position, players behind, size in bb, multiple of the previous bet, all-in);
- the call amount, the pot, the effective stack, the ante and straddle, a dead small blind;
- the full voluntary action sequence.

Tests (`tests/bot/preflop-context.test.ts`, 23 tests):
- every situation is constructed and checked field by field;
- 9-handed, short-stack, all-in, straddle and heads-up cases;
- **random legal preflop sequences:** 120 hands at 2–10 players, random stacks of 5–250bb, sometimes a straddle,
  more than 500 decisions.
  - Classification never throws and stays consistent with the event log.
  - Every v2 decision, with and without all corrections, passes `validateAction` (**no illegal action**) and records
    a known source.

## 3. Coverage before and after (measured)

`npx tsx sim/bot/v4-baseline.ts coverage [--corrected]` builds every reachable spot of eight scenario families for
every seat. It covers 2–10 players at 10 / 15 / 25 / 40 / 100 / 200bb and records the source each decision itself
reports (`Decision.preflop.source`, new in this phase). Full matrices:
[phase31-coverage-before.md](phase31-coverage-before.md) (v2 as shipped) and
[phase31-coverage-after.md](phase31-coverage-after.md) (v2 with the three corrections).

Spots per source at 100bb:

| Players | Spots | Before: exact chart | Before: chart outside its assumptions | Before: opponent-conditional chart | Before: nearest-seat chart | Before: heuristic | After: exact chart | After: outside assumptions | After: conditional | After: nearest seat | After: heuristic |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 6 | (4 HU chart) | 0 | 0 | 0 | 1 | (4 HU chart) | 0 | 0 | 0 | 1 |
| 6 | 58 | 20 | 0 | **23** | 0 | 10 | **42** | 0 | 1 | 0 | 10 |
| 7 | 76 | 0 | 20 | 23 | 5 | 22 | 0 | 42 | 1 | **0** | 27 |
| 8 | 96 | 0 | 20 | 23 | 10 | 36 | 0 | 42 | 1 | **0** | 46 |
| 9 | 118 | 0 | 20 | 23 | 15 | 52 | 0 | 42 | 1 | **0** | 67 |
| 10 | 142 | 0 | 20 | 23 | 20 | 70 | 0 | 42 | 1 | **0** | 90 |

The remaining columns (computed all-in calls, push/fold) are unchanged: 5–9 computed spots per table size at 100bb.

How to read this:
- **The data did not grow.** No chart was added; nothing was invented.
- What changed is that every decision is labelled with its real source, and three chart-selection defects are handled
  explicitly.
- "After" has *more* heuristic spots at 7–10 players **by design**: the nearest-seat substitution is replaced by a
  declared fallback (§4.2).
- **A lower fallback rate is not evidence of better play, and neither is a higher one.** The play results are in the
  evaluation baseline report: the corrections were not better.

## 4. The Phase 3.0 defects

### 4.1 Chart precedence by registration order: addressed as an option, not adopted

**Before.**
- `StrategyLibrary.find` ranked equally good matches by registration order. Greenline is registered first, so it won
  every spot it shares with Pekarstas.
- The Greenline source text marks pages 6, 8, 9, 10 and 11 as opponent-dependent:
  - "3bet vs weak opponents who fold to 3bet";
  - "fold to 4bet from passive opponents (otherwise call)";
  - "3bet and call 4bet from passive opponents";
  - "vs tight 3bettor".
- The transcription merged those conditions into single actions.

**Now.**
- These 27 of Greenline's 42 spots carry `conditional` with the page reference (`library/builtin.ts` `GREENLINE_CONDITIONAL`):
  SB vs open, BTN vs open, BB vs 4-bet, and every vs-3bet.
- Every explanation that uses one says "OPPONENT-CONDITIONAL in its source".
- `StrategyLibrary` takes an explicit `Precedence`:
  - `'registration'` is the old ranking, now documented, and still the default for v1/v2/v3;
  - `'documented'` ranks a conditional spot below an unconditional spot of the same quality.
- Under `'documented'`, 22 of the 23 conditional spots at 6-handed 100bb are replaced by Pekarstas. BTN vs MP has no
  Pekarstas equivalent and stays Greenline, labelled.
- Example: BTN vs a CO open changes from Greenline's 26% 3-bet-or-fold to Pekarstas's 14.8% with flats.

**Unresolved.** Neither pack's licence or solver origin is verified. "Documented" precedence prefers the
unconditional source; it does not make it validated.

### 4.2 A 15.5% defence chart against an opener modelled at about 11%: addressed as an option, not adopted

**Before.**
- At 7–10 players, an opener with more than 5 players behind has no chart.
- Hero's response used the nearest seat's chart (6-max UTG, a 15.5% opener), tagged "APPROXIMATION".
- The opponent model gave the same opener the heuristic 11% band. The two halves disagreed.

**Now.**
- With `consistentOpener`, no nearest-seat chart is used. The explicit percentile fallback is computed from the
  opponent model's own opener range, and the explanation states that the nearest chart was not used and why.
- This applies to every lookup keyed by the raiser's seat.

**Unresolved.** No trustworthy range exists for these seats. The fallback is a documented heuristic, not a better
chart.

### 4.3 Open sizes inconsistent with the chart: addressed as an option, not adopted

**Before.**
- Hero opened 2.5bb everywhere (3bb SB), isolated with `(3 + limpers)bb` and 3-bet 3x in position.
- Greenline states different sizes for the same charts:
  - opens: UTG / MP / SB 3bb, CO / BTN 2.5bb (page 4);
  - isolation: 4bb + 1 per limper in position, 5bb + 1 out of position (page 5);
  - 3-bets: 2.5bb → 9bb in position, → 10bb out of position (pages 6–7).
- The library also never compared the size faced with the size the data assume.

**Now.**
- `chartSizes` makes Hero use the stated sizes. Seats earlier than any chart seat use 3bb, labelled.
- **For every engine**, the library compares the size faced with the size the data assume (more than 25% apart) and
  states it as a departure: "made for a 2.5bb open, the raise faced is to 4.0bb". This changes no choice (every pack
  states the same size), only the explanation.

**Unresolved.** Defence ranges still do not depend on the size faced: there are no size-specific data.

### 4.4 Silent substitutions now stated (text only, all engines)

- **A raise over limpers answered with a vs-open chart:** "the raise came over N limper(s), the data assume an
  unopened pot".
- **A squeeze answered with the plain vs-3bet chart:** "N player(s) called Hero's raise before the 3-bet (a squeeze),
  the data assume a heads-up 3-bet".
  - v2 detects a squeeze only when someone *called the 3-bet*, not when someone called Hero's open before it; the
    classification records both.
- **Hero flat-called the open and faces a 3-bet:**
  - before: the heuristic labelled "cold 4-bet top 2%";
  - now: "Hero called the open and now faces a 3-bet; it is treated like a cold 4-bet spot". The behaviour is
    unchanged (4-bet top 2%, fold the rest) and it is listed below as unsupported.
- **An opponent who called after callers:** that opponent's range from a "no caller in between" chart now says
  "APPROXIMATION: N caller(s) acted before this player".

## 5. Preflop situations still unsupported (no trustworthy data; explicit heuristic or labelled approximation)

| Situation | Players / depth | What decides now |
|---|---|---|
| Any spot at 7–10 players | all | 6-max data by players behind (labelled), or the heuristic for seats with more than 5 behind |
| Opens from UTG / UTG+1 / UTG+2 / MP at 8–10 players | all | `OPEN_BY_BEHIND` heuristic (11% / 13% / 15%) |
| Responses to an opener with more than 5 behind | 7–10 | nearest-seat chart (v2) or explicit fallback (option) |
| Any stack outside 60–150bb, above 16bb | all | 100bb charts, labelled "made for 60-150bb" |
| Squeeze (`facing-open-callers`), facing a squeeze, cold 4-bet, cold facing 4-bet+ | all | heuristic |
| Hero called the open and faces a 3-bet | all | heuristic (treated as a cold 4-bet) |
| Limping / completing / over-limping strategy; facing an isolation raise (`facing-iso`) | all | heuristic (no limping data) |
| CO vs an MP open; CO / BTN facing a 4-bet after 3-betting MP | 6-max | heuristic |
| Opens of any size other than 2.5bb faced | all | chart applied with a stated size departure |
| Big blind vs a limp, heads-up | 2 | heuristic (raise top 30%) |
| Short stacks: re-jam spots, jams with more than one behind | ≤ 16bb | heuristic bands; heads-up Nash only for one player behind |
| Antes, straddles | all | charts made without them (labelled) |
| Rake | all | not modelled by the strategy; the evaluation can charge it post hoc |

## 6. Files

- **New:**
  - `src/bot/strategy/preflop-context.ts`;
  - `tests/bot/positions-exhaustive.test.ts`, `tests/bot/preflop-context.test.ts`;
  - `sim/bot/v4-bench.ts`, `tests/bot/v4-bench.test.ts`;
  - `reports/V4_PREREGISTERED_SEEDS.md`.
- **Changed:**
  - `table/positions.ts` (label; `UTG+3`);
  - `strategy/preflop.ts` (classification, recorded source, optional corrections, stated approximations);
  - `strategy/library/{library,builtin,types}.ts` (precedence, conditional flag, size departures, Greenline sizes);
  - `strategy/types.ts` (`Decision.preflop`);
  - `strategy/villains.ts` and `agent.ts` (offline `preflopCorrections` option, library parameter);
  - `ranges/preflop-model.ts` (stated caller approximation);
  - `sim/bot/v4-baseline.ts` (coverage from the recorded source, before / after).
