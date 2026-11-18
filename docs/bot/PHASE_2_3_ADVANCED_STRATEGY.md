# Phase 2.3: advanced cash-game strategy

Date: 2026-11-18. Version 0.8.0. Branch `autonomous-bot`. Cash games only: nothing here concerns tournaments, and
the tournament recording of 2026-11-18 was not used for anything.

<!-- RESULTS -->

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
