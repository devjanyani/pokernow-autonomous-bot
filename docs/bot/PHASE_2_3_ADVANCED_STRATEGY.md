# Phase 2.3: advanced cash-game strategy

Date: 2026-11-18. Version 0.8.0. Branch `autonomous-bot`. Cash games only: nothing here concerns tournaments, and
the tournament recording of 2026-11-18 was not used for anything.

**Result in one paragraph.** A new, experimental postflop engine (version 3) plans betting sequences over two
streets: check-raises, re-raises, calling now and raising later, delayed bets. It plays against an opponent model
that depends on the betting so far, and accounts for its own uncertainty about that model. It works as designed
(tested sequences, exact arithmetic, 25 to 270 ms per decision), and it check-raises about ten times as often as
version 2. **It is not better than version 2.** On a held-out seed, pooled over 13 heads-up tables, it was
-10.3 ± 11.9 bb/100 against version 2. It was significantly behind at three tables (nit, range-equity, version 2's own
model), ahead at none, and level with version 2 against equilibrium play in seven solved river spots. One defect found on
the way (the opponent model counted the strength of a raising range twice) is fixed. Another (raising far too
often against version 2's own model) is found but not fixed. Version 3 therefore stays an offline experiment and is
not offered in the extension; the default remains version 2. Also fixed, in version 2: bet sizes collapsed into one
at stakes below two chips per big blind.

## 1. Audit of the engine as it was (v0.7.0)

What runs is `src/bot/agent.ts` → `strategy/preflop.ts` before the flop and `strategy/postflop.ts` (version 2) after
it, with ranges from `strategy/villains.ts` and the behaviour model `ranges/range-model.ts`. `strategy/postflop-v1.ts`
is the 0.5.1 engine, active only when chosen as the baseline. `src/core/engine.ts` (the old overlay's
`DecisionEngine`, which used the PokerBench model) is not used by the bot at all.

| Question | Answer for version 2 (0.7.0) | Where |
|---|---|---|
| 1. Aggressive actions it can evaluate | Hero's first action only: bets of 33, 66, 100, 150% of the pot and all-in when short; raises of 55 and 100% of the pot after calling. Every later Hero action is fixed by one of two plans. | `postflop.ts` buildCandidates |
| 2. Check-raises | **No.** After a check the only plans are "fold to a bet" and "call a bet". A check-raise is valued only when Hero is already facing the bet at the moment of deciding, as a raise candidate, never as a plan made when checking. | `postflop.ts` run(), check branch |
| 3. Planning across streets | Partly. One more betting round is simulated with one bet size (half the pot) by the first willing player; no raises on it; Hero follows the behaviour model or gives up. The river after a flop decision is a realization factor. | settle() |
| 4. Opponent re-raises | Opponents may raise Hero's bet (to the larger of 2.5x and bet plus pot). Hero then folds or calls; **Hero cannot re-raise**, and nobody raises on the simulated next street. | run(), bet branch |
| 5. Bet sizing | Sizes are compared, but the value of each rests on one continuous fold function of the size (threshold rising with the square root of the size) and is scored by the lower of two response scenarios. At 0.25/0.50 stakes sizes were rounded to whole chips (2 big blinds), so the smaller sizes collapsed into one in small pots: a defect, fixed in 0.8.0. | buildCandidates, range-model.ts |
| 6. Range updates | Observed opponent actions narrow the range by Bayes' rule with the behaviour model. Inside the simulation a player that continues against a bet is re-read in the top 1 - t of its range on the next card (a threshold approximation, not the actual narrowing). | villains.ts narrowSeat; conditionOnContinue |
| 7. Opponent tendencies | Four knobs from statistics (aggression, stickiness, looseness, preflop aggression), shrunk by sample size. Check-raise, raise-facing-a-bet, turn barrel and river betting statistics existed in the profile but **did not reach any decision**. | profile.ts tendencies() |
| 8. Hero's previous actions | Hero's line narrows Hero's perceived range (what opponents put Hero on), used in opponents' strength. Betting lead, bet type (continuation, lead, probe, delayed) are tracked. | villains.ts, spot.ts |
| 9. Biased EV estimates | Phase 2.2: version 2's EVs are 5 to 11 bb too low in six-handed pots at the simulated tables; river bets valued 3.3 bb too low against the tight-aggressive program; with nothing bet on the river it checks 62% where a solver reference for its own ranges checks 30%. | PHASE_2_2_REPORT.md |
| 10. Solver components | `core/solver/postflop-cfr.ts`: a range-against-range CFR for one street, exact on the river, with check-raises and re-raises in its tree, validated in Phase 2.2. Phase 2.2's reference evaluator prices actions under the simulated opponents' true policies. The `postflop-solver` adapter is not built; the heads-up blueprint is a separate, small game. | sim/bot/river-reference.ts, reference.ts |

Documented but not implemented (or only in inactive code): nothing that the documents claim as implemented was
missing; the documents already listed "no check-raise by Hero and no raise behind a call" as a limit (STRATEGY.md 8.4).

**Smallest change that gives reliable multi-action planning.** The behaviour model and the range estimate could stay;
what was missing was a tree. Replacing the fixed follow-up plans with a best response over an explicit public betting
tree, built by the rules engine, needs no change to tracking, legality, ranges or the interface. That is version 3.

## 2. Multi-street action planning (version 3)

`src/bot/strategy/v3/search.ts`, selected with `engine: 'v3'` (or Settings → Strategy experiments). Heads-up pots
after the flop only; preflop and multiway pots are version 2, and every such decision says so in its explanation.
The method is in [STRATEGY.md section 9](STRATEGY.md); in short:

- **Public tree, built by the rules engine.** Every node is a real `HandState`, so minimum raises, the re-open rule,
  all-ins and uncalled bets are the game's own rules (no separate reimplementation). The current street and the next
  street are expanded, at most four bets and raises on the first and three on the second, with a few sizes per node.
  A typical flop decision has 400 to 1,000 nodes, a river decision 15 to 60.
- **Deals with reach.** Opponent holdings are sampled from version 2's range estimate. Each deal carries the
  probability that the opponent took every action on the path, so the opponent's range after any sequence is exactly
  the holdings the model plays that way (no threshold approximation).
- **Hero best-responds on what Hero knows.** At each Hero node, the action with the highest reach-weighted value over
  the deals reaching it; on the next street one choice per strength bucket of Hero's hand on the new card. Hero never
  conditions on the opponent's cards.
- **Sequences covered** (tested in `tests/bot/strategy-v3.test.ts`): check → bet → raise (check-raise); bet → raise →
  re-raise / call / fold; check → bet → call → next street check → bet → raise; bet → call → next street check → bet →
  call / raise; check → check → next street bet; calling a bet now and raising it on the next street.
- **Recomputed at every decision.** The plan is shown, never replayed: when Hero checks and the opponent bets, the
  controller asks for a new recommendation for the new state (as it always has; recommendations are keyed by hand,
  street and state version).
- **Bounded.** Two streets; discrete sizes; a 6,000-node cap; the anytime loop stops by the existing time budget or at
  2,400 deals. Measured live-path time with a 20-second clock: 24 to 267 ms on test spots (v2: 16 to 252 ms).
- **Not claimed.** A two-street search against a heuristic opponent is not a solution of the game, and its values are
  only as good as the opponent model (section 6).

## 3. Check-raise evaluation

At a decision where Hero may check, the value of checking already includes Hero's best answer to each opponent bet
size: fold, call, raise to about 45% or 90% of the pot after calling, or all-in, each followed through the opponent's
response and the next street. The explanation lists, for each bet the opponent may make after the check, how often the
model has it bet that size and the value of every answer, then the plan. When the plan is a raise, its purpose is
computed, not assumed:

| Label | Computed condition |
|---|---|
| semi-bluff check-raise | the hand's equity comes from a draw (8 or more outs, made-hand percentile under 60%, cards to come) |
| value check-raise | wins 55% or more at showdown against the hands that continue against the raise |
| protection / thin value | 40 to 55% against the continuing hands, and at least 30% of bets fold |
| bluff check-raise | the rest |

Check-calling, check-folding and checking to induce are the other answers in the same table: checking to induce shows
as a check whose best answer to a bet is a call or raise and whose value exceeds every bet's. Effective stacks, the
stack-to-pot ratio, the next street and the opponent's history-dependent folding (section 6) all enter through the
tree. Multiway check-raises are not searched (version 2 decides multiway pots).

**What was measured.** In the held-out benchmark version 3 check-raises in 2 to 38% of its chances, depending on the
opponent (87% against version 2's own model, a known failure). Version 2: 0 to 13%; version 1: 0 to 7% (section 9).
At the solver's check-raise nodes, with the equilibrium's own ranges, version 3 loses 0.15 ± 0.11 bb (dry board)
and 0.17 ± 0.14 bb (wet board) per decision against the solution; version 2 loses 0.10 ± 0.08 and 0.17 ± 0.14
(section 8). More check-raising did not, on this evidence, make it play better.

## 4. Bets, raises and re-raises

Every bet or raise candidate is followed through the opponent's fold, call or raise, Hero's answer to a raise (fold,
call, re-raise of one size or all-in), the opponent's answer to that, and the next street. The explanation decomposes
the value of the chosen bet into the parts contributed by folds, calls and raises, and states whether the profit
comes from fold equity, from value when called, or both; it gives the opponent's response frequencies and Hero's
showdown share against the hands that call. Continuation bets, donk bets, probes and delayed continuation bets are
named by the spot analysis of version 2 (`strategy/spot.ts`); thin value, protection, semi-bluff and pure bluff follow
from the computed decomposition, not from hand categories.

## 5. Bet sizing

Hero's first action compares every legal size of version 2's set (33, 66, 100, 150% of the pot, all-in when short;
raises of 55 and 100% of the pot after calling), and later Hero raises compare two sizes and all-in. Every size is
clamped to the legal window of its node (minimum raise, all-in) and rounded to whole chips at stakes of two or more
chips per big blind, to cents below. Each size changes the opponent's continuing range through the model's
size-dependent threshold (the fold threshold rises with the square root of the size), and its own future through the
tree (a larger bet leaves less behind and fewer raises). The assumptions behind each recommended size are in the
explanation: the response frequencies, the decomposition, and the value of the same action against each opponent of
the model mixture.

**Defect fixed in version 2 as well:** sizes were rounded to whole chips. At 0.25 / 0.50 a chip is two big blinds, so
in a pot of one or two chips the 33%, 66% and 100% sizes collapsed into one candidate. Now cents at stakes below two
chips per big blind (`tests/bot/strategy-v3.test.ts`, "bet sizes at small stakes").

## 6. Opponent model and its uncertainty

`src/bot/strategy/v3/model.ts`. Version 2's bet / continue / raise functions, made conditional on the betting so far
(facing a bet, a raise of the player's own bet, a check-raise, a third raise), with the player's own statistics moving
seven knobs: raising facing a bet, folding to a check-raise, folding when raised, turn barrel, river betting, share of
large bets, and version 2's aggression and stickiness. Each knob moves by (estimate − prior) × d / (d + 20): twenty
observed opportunities count half; fewer move it little. Every knob that moved is stated with its evidence. New
profile statistics: `foldToCheckRaise`, `foldVsRaise`, `reraiseVsRaise` (opportunity-based, shrunk like the others).

**Model uncertainty.** Hero's decision is a best response to a mixture: in each deal the opponent is the modelled one,
a stickier one or a more aggressive one, which Hero cannot tell apart. Before evidence the deviations have 20% each;
their share falls with the player's observed responses to bets. This was added after the recorded cash session showed
version 3, trusting the model fully, recommending an all-in river bluff-raise with ten-high whose value rested
entirely on the modelled fold rate (section 7). With the mixture it folds there.

## 7. The new cash-game recording

Bundle exported 2026-11-18 04:35 UTC (local, git-ignored): one 102-minute session, nine-handed, blinds 0.25 / 0.50
with an ante of 0.25 per player, stacks from 30 to 960 big blinds (median 208). The other new bundle (2026-11-18
02:28) has rising blinds across five sessions: a tournament. It was not used for anything.

**Reconstruction** (`npm run bot:audit`): 100 hand summaries, 95 verified, 3 with the ending not observed, 1 invalid
(a folded seat's stack moved by an ante's worth), 1 unverified (a pot that everyone paid into before the next
hand). Three pots were paid differently from the cards shown (run twice) and were detected by the result check.
Hero: 131 actions, 130 with a recommendation, 122 played as recommended; the 8 differences were manual clicks.

**Analysis** (`sim/bot/cash-session.ts`, report `reports/cash-session-2026-11-18.md`, anonymised). The 96 rebuilt
hands were split by time: the first 57 for counting opponent statistics (calibration), the last 39 only looked at
(evaluation). Showdown hands are settled from the cards shown before they are counted; no unshown card is used.
Hands' results are never used to judge a decision.

### What there is to calibrate with

12 opponents; 7 have 30 or more preflop opportunities. After the flop no opponent has 30 opportunities of any
statistic, so **no player-specific postflop knob can move much** (by design, 30 opportunities move a knob about 60%
of the way to the player's estimate, and here every count is lower).

| Statistic (opponents pooled) | Observed | Engine's assumption | Enough? |
|---|---|---|---|
| VPIP | 107 / 390 (27%) | 26% | yes, population and 7 players |
| Preflop raise | 54 / 390 (14%) | 18% | yes |
| 3-bet | 11 / 164 (7%) | 7% | population only |
| Flop continuation bet | 15 / 31 | 55% | no |
| Fold to a flop bet / turn / river | 18 / 37, 20 / 30, 7 / 12 | 45, 45, 50% | no |
| Raise facing a bet, flop / turn / river | 4 / 37, 1 / 30, 0 / 12 | 12, 10, 8% | no |
| Check-raise | 3 / 37 | 8% | no |
| Fold to a check-raise | 1 / 3 | 45% | no |
| Fold / re-raise when raised | 2 / 6, 0 / 6 | 45%, 8% | no |
| Bet when checked to, flop / turn / river | 21 / 80, 18 / 49, 9 / 28 | 40, 38, 35% | flop rough |
| Bet sizes | 48 bets: 27% under 40% of the pot, 56% 40-70%, 17% 70-110%, none larger | | |

In the calibration framework's finer split (street, size class, heads-up or multiway) one assumption lies outside
the observed 90% interval: **in multiway pots players bet a flop checked to them far less than assumed**, 11 of 47
in the calibration part and 13 of 50 in the held-out part (about 25%, against an assumed 40%). That is the first
assumption contradicted on both halves of a recording. It concerns multiway pots, which version 2 decides, and comes
from one table of twelve players, so it was recorded and not applied; changing a prior needs the acceptance rule of
the data roadmap (step 6).

### Hero's decisions after the flop

24 decisions (15 calibration, 9 evaluation): 10 in large pots, 9 multiway, 4 delayed-aggression opportunities, 3
check-raise opportunities, 2 river bluff-catches, 2 where Hero's bet was raised, 1 unusual opponent size, 1 bet with a
middling made hand. Version 3 applied to the 15 heads-up ones and chose the same class of action as version 2 in 13.
The two differences:

- **Turn, flush draw facing 43% of the pot** (hand 69): version 2 folds, version 3 calls, planning to call or raise
  river bets only with its stronger holdings on the river card. Hero called.
- **Turn, open-ended straight draw on a four-club board, first to act after checking the flop as the preflop raiser**
  (hand 13): version 2 bets small, version 3 checks. Hero bet.

Before the model-uncertainty mixture (section 6), version 3 also recommended an **all-in raise on the river of hand 69
with ten-high** against a 33% pot bet, a play that pays only if the opponent folds as often as the model says. With
the mixture it folds, as version 2 does and as Hero did. Which of these is better cannot be told from one hand; none
of them is judged by its result.

## 8. Solver comparison with independently specified ranges

`sim/bot/solver-spots.ts`, report `reports/solver-spots-2026-11-18.md`. Seven river spots, 40 Hero hands each,
pot 19.5 bb and 90.5 bb behind. Ranges do not come from any engine: each player has a top-X% preflop range; a bettor
Hero faces has an explicitly polar (strongest 15% plus weakest 12%) or condensed (30th to 75th percentile) range; both
are thinned evenly by made-hand strength to at most 150 hands. At the two check-raise spots the river game is solved
from Hero's first action and every adviser decides at the node after "check, bet 75%" with the ranges the equilibrium
has there. Rake: none. Abstraction: bets of 33, 75 and 125% of the pot, one raise of 75%, all-in. Every solution can
be exploited by at most 0.15% of the pot; an independent recomputation agrees to 10⁻¹² chips; the inner-node analysis
is checked against a direct showdown computation (`tests/bot/river-reference.test.ts`).

Loss = value of the best action minus value of the adviser's action, both playing on as well as possible against the
solution's other player (big blinds per decision; 95% intervals over the 40 hands).

| Spot | What it tests | v1 | v2 | v3 | PokerBench model |
|---|---|---|---|---|---|
| Out of position, first to act, dry | bet or check | 0.13 ± 0.07 | 0.11 ± 0.07 | 0.08 ± 0.05 | 0.08 ± 0.04 |
| In position, checked to, dry | value bet and size | 0.23 ± 0.12 | 0.09 ± 0.06 | **0.04 ± 0.02** | 0.46 ± 0.22 |
| In position, checked to, wet | value bet, bluff | 0.68 ± 0.29 | 0.20 ± 0.13 | 0.12 ± 0.08 | 0.62 ± 0.36 |
| Facing a polar lead | bluff-catch, value raise | 0.08 ± 0.11 | 0.08 ± 0.11 | 0.08 ± 0.11 | 3.94 ± 1.00 |
| Facing a condensed lead | value raise, bluff raise | 1.01 ± 0.42 | **0.80 ± 0.36** | 1.06 ± 0.41 | 2.04 ± 0.99 |
| Check-raise node, dry | check-raise / call / fold | 0.18 ± 0.13 | 0.10 ± 0.08 | 0.15 ± 0.11 | 0.38 ± 0.27 |
| Check-raise node, wet | the same | 0.27 ± 0.23 | 0.17 ± 0.14 | 0.17 ± 0.14 | 1.65 ± 0.80 |
| **All 280 decisions** | | 0.37 ± 0.09 | **0.22 ± 0.07** | 0.24 ± 0.08 | 1.31 ± 0.28 |

Version 3 column: the final model (section 9). Before that fix the same run gave version 3 0.31 ± 0.12 overall and
1.59 ± 0.73 facing the condensed bet (`reports/solver-spots-2026-11-18-before-fix.md`).

- Version 3 is the closest to the equilibrium when betting in position, and about equal to version 2 at the
  check-raise nodes and when bluff-catching.
- Facing a condensed bet it still never folds (the equilibrium folds 34%) and raises with 88% of hands (all-in 55%,
  the equilibrium 43%). Before the fix it raised all-in with 63%. This is the main measured weakness of version 3; it
  comes from the opponent model (folds to raises are too high against this range), not from the search.
- Overall versions 2 and 3 are equal within the intervals (0.22 ± 0.07 against 0.24 ± 0.08). The PokerBench model is far behind on every spot where Hero faces
  a bet.
- What this is not: an equilibrium of one street with chosen ranges says how much an equilibrium opponent could take
  from an action. It does not measure play against people, and it is not "GTO" for the hand.

## 9. Benchmark: versions 1, 2, 3 and the PokerBench model

Full tables: [reports/PHASE_2_3_BENCHMARK.md](../../reports/PHASE_2_3_BENCHMARK.md). Same decks for every engine
(duplicate rotation), 2,000 hands per table, bb/100 with 95% intervals, paired differences by deal.

**Development run (seed 12100, 17 tables, model before the fix).** Version 3 was significantly behind version 2 at
three tables: nit -55.2 ± 41.0, range-equity -42.9 ± 36.1, trapper -37.5 ± 34.1. It was ahead at none, and pooled over the 14
heads-up tables it was -10.3 ± 11.8. It check-raised 16 to 39% of its chances against most opponents and 78% against
the nit. The reference evaluation (true opponent policies, enumerated run-outs) found its river raises facing a bet
worse than folding (+15.3 ± 15.1 bb per decision for folding) and its own value estimates for bets and raises
optimistic (+1.6 ± 1.0 bb).

**The fix.** The cause was in the opponent model. It added 0.04 to 0.08 to the opponent's continue threshold when
raised, on top of the deal weights, which already make a raised range strong. The strength was counted twice, so
opponents folded too much to raises. The extra was set to 0 (a player's measured `foldVsRaise` / `foldToCheckRaise`
still moves it). One change, chosen from the diagnosis, not tuned. On the development decks it improved version 3
against the nit by +51.1 ± 28.8 and against range-equity by +23.4 ± 19.4, with no table significantly worse. In the
reference evaluation against the tight-aggressive opponent it moved version 3 from -0.42 ± 0.81 to +0.07 ± 0.62 bb
per decision relative to version 2, and halved its river all-in raises (19% to 10%).

**Held-out run (seed 12300, never used before, model after the fix, 15 tables):**

| | v3 - v2 (bb/100) | v3 - v1 | v2 - v1 |
|---|---|---|---|
| Archetypes (tight/loose, aggressive/passive) | +11.3 ± 19.2 | -33.0 ± 23.8 * | -44.3 ± 21.8 * |
| Simple and independent opponents (8 tables) | -8.1 ± 15.0 | +46.4 ± 22.8 * | +54.4 ± 21.5 * |
| Version 2's model as the opponent | **-114.0 ± 60.2 *** | -79.1 ± 66.4 * | +34.8 ± 33.2 * |
| Six-handed (2 tables) | +7.8 ± 23.8 | +9.1 ± 42.8 | +1.2 ± 42.9 |
| **All 13 heads-up tables** | **-10.3 ± 11.9** | +12.3 ± 16.6 | +22.6 ± 15.0 * |

- Significantly behind version 2 at the nit (-30.9 ± 30.8), range-equity (-22.4 ± 21.4) and version 2's own model
  (-114.0 ± 60.2). Ahead at no table.
- Against version 2's own model version 3 folds to only 13% of bets and raises 76% (version 2: 75% and 12%). This is
  a feedback loop between version 3's learned knobs and that opponent; it is found, not fixed.
- Version 2 is ahead of version 1 on the held-out seed (+22.6 ± 15.0 heads-up), ahead against the independent
  opponents and behind against the version 1 archetypes (which are built from version 1's model).
- The PokerBench model (development run only) was behind version 2 at 16 of 17 tables, significantly at 13.
- Multiway pots: version 3 does not decide them, so six-handed differences come only from heads-up pots after the
  flop; they are within the intervals.
- Latency in the simulator: median 74 ms, 95th percentile at most 143 ms per postflop decision (400 deals).

**Model improvement or overfitting?** The fix was chosen from a diagnosis on the development seed and was then measured on a
seed not used before. On that seed version 3 is no longer behind on the archetype tables, but it is still behind
overall. The benefit at the nit and range-equity tables was measured only on the development decks.

## 10. Decision on integration

The brief requires statistically and strategically credible evidence before version 3 is activated. There is none:
version 3 is significantly ahead of version 2 on no table of the held-out run, it is behind on three, and it has a known
over-raising failure. So:

- the default engine stays version 2; the extension's Settings still offers versions 1 and 2 only (`sanitizeSettings`
  maps anything else, including `v3`, to version 2);
- version 3 is kept, tested and documented as an offline engine (`engine: 'v3'` in `BotAgent`, the simulator and all
  Phase 2.3 tools). If it cannot run (multiway pot, preflop, tree build failure), the agent falls back to version 2
  and says why in the explanation;
- nothing in tracking, the interface, storage, action recognition or permission handling changed. Automatic play
  stays disabled; all computation is local.

## 11. Remaining weaknesses

1. Version 3's opponent model folds too much to large raises against condensed ranges (solver spot) and lets
   version 3 raise into version 2's model three times in four. The next step is to calibrate fold-to-raise
   responses from data, not by hand.
2. Two streets only, with a heuristic realization factor at the leaves, discrete sizes and four strength buckets.
3. The values of lines with later choices are biased upward (choice and value on the same deals); the cross-fitting
   option fixes the bias but picks worse actions at the deal counts that fit the time budget.
4. Cash-game data: one session, 12 opponents, no postflop statistic with 30 opportunities for any player. Nothing
   was calibrated from it. The multiway flop betting frequency (about 25% against 40% assumed) is the first
   assumption contradicted on two halves of a recording.
5. All benchmark opponents are programs. None of the numbers says anything about profit against people.
