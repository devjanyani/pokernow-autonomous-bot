# Strategy audit (version 0.5.1 engine) and what changed in 0.6.0

This document records the audit of the strategy engine as it stood at 0.5.1 ("version 1"), the defects that were confirmed against recorded hands, and the changes made in 0.6.0 ("version 2"). Version 1 is kept in the repository unchanged (`engine: 'v1'`) so that every claim here can be re-run.

Evidence: three debug bundles recorded in recommend-only mode on 2026-11-13 (local, git-ignored). The hand records that could be replayed are kept, anonymised, in `tests/bot/fixtures/live-2026-11-13-hands.json` (17 hands; seats are P1..P10, no names, table ids or timestamps). To re-run the engine on them:

```
npm run bot:decisions -- tests/bot/fixtures/live-2026-11-13-hands.json --samples 4000
```

Words used below. **Recorded**: read directly from a bundle. **Reproduced**: recomputed from the recorded hand by the engine. **Inferred**: a conclusion drawn from those.

## 1. The hand that prompted the audit

Identified from the recorded cards, positions and actions (third bundle; fixture id `c-12`). It is the only recorded hand in which Hero called a preflop raise against advice, flopped bottom pair, and was advised to bet into the raiser.

Recorded:

- Eight players dealt in, blinds 1/2. Hero is under the gun with 5d 3h, stack 337.
- Hero limps (advice: fold). The player two seats to the left (MP, stack 90) raises to 9. Everyone folds to the big blind, who calls. Hero calls 7 more (advice: fold).
- Flop 5h 9d Kh, pot 28. The big blind checks.
- Advice at this point: **bet small (9)**, with check valued at +0.6 chips and the bet at +3.6.
- Hero checked instead. MP bet 28. The big blind folded. Advice: fold. Hero folded.

So the description in the request is accurate, with two details: there were two opponents, not one (the big blind had already checked, the raiser was still to act behind Hero), and the raiser was in middle position.

Reproduced with version 1 (neutral opponent statistics, 6,000 deals): check +3.5, bet small +5.3, bet medium +2.7, bet large −1.0. Same recommendation as recorded.

### Which rule produced it

There was no rule of the form "bet any pair". The recommendation came out of the Monte Carlo comparison of bet against check, and four properties of that calculation each pushed toward the bet:

| # | Reproduced fact | Effect |
|---|---|---|
| 1 | A called bet was valued as: put in 9, then go straight to showdown for a 55-chip pot with 86% of raw equity. No later street was played. Against the raiser's range Hero's raw equity was 42%, against the big blind's modelled range 71%. | Any hand with roughly a quarter of the equity "profited" from a small bet. A bet read as a cheap ticket to showdown. |
| 2 | After a check, the raiser was modelled to bet 70% of the time for 60% of the pot, and Hero then called whenever its hand beat 50% of **all possible hands** (bottom pair beats 64% of them), whether or not the call made money. | Checking was charged for a losing call. In another recorded hand (`c-4`) this made the value of checking negative, which is impossible: Hero can always check and fold for zero. |
| 3 | The big blind's check **to the raiser** was treated like any other check. The model multiplied every top pair or better in its range by about 0.02. Before the check 9% of its range was that strong, after it under 2%. | The big blind was taken to hold almost nothing, so Hero's pair looked strong against it. |
| 4 | The raiser's reply to the 9-chip lead was modelled as fold 3%, call 79%, raise 18%, from thresholds on strength against all possible hands. The engine never looked at who had raised before the flop: `aggressor` was recorded by the rules engine and read by nothing in the strategy code. | A lead into the raiser was treated exactly like any other bet. |

Was the recommendation justified? Under the version 1 model, yes: it followed from the model. As poker, no: properties 1 to 3 are errors of the calculation, not of taste. They are fixed in version 2, which values the recorded spot at check +3.4, bet small +2.6 (8,000 deals) and recommends a check, with the plan "fold if an opponent bets". The margin is narrow: in the model the lead is no longer clearly good, and it is not clearly bad either.

Hero's preflop deviation did **not** cause a wrong lookup. After the flop the engine never looks anything up by "the range Hero should have"; it computes with the two cards Hero holds. What the deviation did do: nothing in the explanation said that 5-3 offsuit is a hand the opponents will not expect, and the opponents' replies were modelled without any view of Hero's range at all.

## 2. Audit: how version 1 chose actions

| Question | Finding |
|---|---|
| Preflop ranges for Hero | Two third-party six-handed chart sets for about 100bb (`greenline-gto.ts`, `pekarstas-gto.ts`), a hand-encoded heads-up table, a heads-up push/fold table. Everything else by "top X% of an equity ordering": seats earlier than six-max UTG, limped pots from the big blind, squeezes, cold 4-bets, short-stack play with several players behind. |
| Validated or heuristic | The charts' solver origin and licence cannot be verified from the repository. They were applied at 16 to 60bb and at 7 to 10 handed tables without saying so. The percentile rules are heuristic. |
| Opponent ranges | Percentile bands of the same equity ordering by betting line, although the repository's own charts describe the opening ranges better (the ordering has no suited connectors in a 9% range, for example). Narrowed after each postflop action by Bayes' rule with a hand-set action model; scaled by four measured tendencies per opponent. |
| Aggressor versus caller | Not distinguished. Confirmed: no strategy code read the aggressor. |
| Position | One number: a realization factor 0.07 (flop) or 0.04 (turn) lower out of position. |
| Made hands and draws | One scalar per holding: percentile of the made hand among all 1,326 holdings, plus a bonus for flush and straight outs. No hand classes, no blockers, no backdoor draws. |
| Equity | Monte Carlo over joint deals of all opponents' ranges with exact side-pot payouts. Sound. |
| Equity realization | A constant factor (0.85 to 0.98) on the showdown payout. |
| Bet versus check | Monte Carlo EV of each candidate, **one betting round deep**. |
| Fold equity and responses | Modelled, but from strength against all possible hands, so a range that had called a raise almost never folded to a small bet and every range folded the same. |
| Streets | The same code on all three streets with different constants. No plan across streets. |
| Multiway | Joint sampling (sound) plus a few constants: thresholds 0.03 to 0.04 tighter per extra opponent. |
| Hero ignores advice | The engine kept working, because it only ever looks at the actual action sequence. It said nothing about the hand being unexpected. |
| Real calculation or arbitrary | Equity, pot odds and side pots are calculated. Every opponent-behaviour number is hand-set. EV figures were real outputs of a model whose inputs were hand-set, and were displayed without that distinction. |

## 3. Confirmed defects, most consequential first

Each has a regression test that fails on version 1 and passes on version 2 (`tests/bot/strategy-v2.test.ts`, `tests/bot/scenarios.test.ts`).

| # | Defect | Evidence | Fixed |
|---|---|---|---|
| D1 | **One-round horizon.** A called bet goes straight to showdown. Thin and weak bets are overvalued because the hand never has to face another bet. | Hand `c-12`; `c-8` (bottom pair bet on flop and turn in a five-way limped pot). | Yes: the next street's betting is played out. |
| D2 | **Checking can be valued below folding.** After a check Hero is made to call by a percentile rule. | Hand `c-4`: check −1.6, bet small −0.7, advice "bet". Scenario suite: two scenarios with EV(check) < 0. | Yes: the follow-up is a plan chosen on the average over all deals. |
| D3 | **No betting lead.** The preflop raiser, a caller and a player in a limped pot are modelled identically; a check to the raiser strips strong hands from a range. | Hand `c-12`, table above, row 3. | Yes. |
| D4 | **Strength is measured against all possible hands**, not against the ranges in play. Ranges barely fold; a hand is as strong in a tight range as in a wide one. | `c-12`: the raiser folds 3% to a third-pot bet. | Yes: strength inside the player's own range and against the others' ranges. |
| D5 | **Range collapse.** A line the model finds unlikely (two checks, then a large bet) leaves a handful of leftover combos, and decisions are made against that. | Three-handed test spot: after check, check, bet three times the pot on A-K-Q-J-4, 6% of the remaining range was a straight and the engine's raise candidates were close to break-even. | Yes: a floor on slow-plays, and a flagged fallback when under 3% of a range survives. |
| D6 | **Raise width read from the seat, not the line.** A big blind raising over limpers was read as a 42% "open". | Hand `c-7`: "vs BB open (est. 42% range) ... continue top 32%". | Yes: the width of the range actually modelled for that line (21% here). |
| D7 | **Realization factor applied to an all-in call.** When an opponent is all-in and Hero's call ends the betting, the payout was still discounted. | Held-out scenario `ho-allin-flop-draw`: EV(call) −2.9 when equity × pot − price is +55; advice "fold". | Yes: no discount when no betting is left. |
| D8 | **Charts used outside their assumptions without saying so**, and unverifiable sources labelled only "precomputed-chart". | Every recorded preflop decision at the 8 to 10 handed tables. | Yes: each use cites the pack, "source not verified", and lists every departure. |
| D9 | **Nothing marks an off-range hand.** | `c-12`, `c-7`. | Yes: labelled out-of-distribution, confidence "lower". |

Not confirmed as defects, and left alone:

- `c-13` (aces, check-raise on J-7-3 two-tone): both engines raise; they differ on size.
- The river raise with nine high in the second bundle (`b-5`: board with four hearts, facing a bet of one fifth of the pot). Version 1 valued the raise at +4.7 chips; version 2 values it at −15 to −21 and folds. There is no reference to say which is right, so it is listed as a changed decision, not a confirmed defect.

## 4. What version 2 does differently

Files: `src/bot/strategy/postflop.ts` (new engine), `postflop-v1.ts` (the old one, frozen), `spot.ts`, `villains.ts`, `src/bot/ranges/range-model.ts`, `src/bot/strategy/library/`.

1. **Spot analysis** (`spot.ts`), read from the actual action sequence: last preflop raiser, who holds the betting lead on this street (the last bettor or raiser of the previous street, if still in the hand; a street checked through passes no lead on), Hero's position against the players left, pot type, stack-to-pot ratio, and the name of a bet made now: continuation bet, lead (donk bet), probe bet, delayed continuation bet. It is the first line of every explanation.
2. **Range-aware strength** (`range-model.ts`). A holding's strength is 35% its place inside the player's own range, 35% its place against the other players' ranges, 30% the old absolute measure. The other players' ranges include Hero's **perceived** range: the range of the line Hero took, which is kept separate from the two cards Hero holds. Range advantage on a board is not hard-coded; it follows from the two ranges.
3. **Betting lead in the behaviour model.** With the lead a range bets more (flop about 55% of the time between equal ranges), without it less (about 40%), and into the lead only 30% of that. A check to the raiser therefore says little about a hand. Calibrated to the population priors in `opponents/profile.ts`, checked by a test.
4. **Plans, not per-deal reactions.** "Check then call" and "check then fold" are each valued over all deals and the better one is the value of checking; likewise "bet then fold to a raise" and "bet then call". Hero cannot see the opponents' cards, so the choice is made on the average.
5. **The next street is played** (flop to turn, turn to river) by every remaining player including Hero, with the lead passing to whoever bet last. Hero's simulated play there bets for value but almost never bluffs, so today's action is not credited with bluffs the engine has not decided to make. Each line is also valued with Hero giving up to any bet on that street, and the better counts.
6. **Pessimistic scenario**: every bet is also valued against opponents who fold about ten points less often, and scored by the lower value.
7. **Explanations.** Bet type and purpose (value bet, protection or thin value, thin bet, bluff or semi-bluff), the modelled replies (all fold, call, raise), equity against the hands that call, the plan, and three explicit warnings: out-of-distribution, model-dependent, poor fit of an opponent's line.
8. **Preflop.** Lookups go through the strategy library, which cites the pack and lists departures. Opponents' opening, isolating, calling and 3-betting ranges come from the same charts where a chart covers the line. The big blind's play over limpers uses the chart instead of "top 14%".

What is **not** claimed: version 2 is not a solver and has not been compared with one. Its opponent model is still hand-set. See section 6.

## 5. Categories

| Label in the explanation | Meaning | Examples |
|---|---|---|
| `solver` | From an imported pack whose source is a solver run | none shipped |
| `precomputed-chart` | From a chart pack | the two six-handed chart sets, marked "source not verified" |
| `computed` / `calculated approximation` | Calculated at decision time from stated assumptions | equity, pot odds, side pots; the two-round EV comparison |
| `learned` | From this opponent's measured statistics | the four tendency knobs |
| `heuristic` | Hand-set | every frequency in the behaviour model, the percentile preflop rules, the realization factor for unsimulated river play |

## 6. Remaining weaknesses, in order of expected cost

1. **No solver reference.** Nothing in the repository says what the right play is in any postflop spot. The scenario suite checks consistency, not correctness.
2. **The opponent model is hand-set** and identical for every unknown player. Its frequencies are anchored to round population figures, not measured ones.
3. **Heads-up, a small lead with a weak pair into a wide button range still comes out ahead of a check** (scenario `oop-caller-bottom-pair-dry`: bet +41.8, check +27.1 at 10/20). The reason in the model: the button folds 30% and raises 10% to a third-pot lead, while after a check it bets 60% and Hero's best plan is to fold. A solver checks this hand. The engine labels the bet "thin bet: marginal against the hands that call". Whether the modelled replies or the solver's assumptions are closer to the players at the table is not known.
4. **No check-raise for Hero, no raise behind a call for opponents, one bet size (half pot) for opponents and for every simulated later bet.**
5. **The river is not simulated from the flop.** A realization factor stands in for it.
6. **Hand classes, blockers and backdoor draws are not modelled** beyond what the equity sampling captures.
7. **Preflop coverage is thin**: no data for squeezes, cold calls with a caller in between, cold 4-bets, antes, straddles, tournaments, or any stack depth other than about 100bb; seats earlier than six-max UTG are played by percentile rules. `npm run bot:ranges -- coverage` prints the table.
8. **No ICM.** Tournament play is chip EV.
9. **Slower.** In the pilot simulations a six-handed session took about four times as long as with version 1, a heads-up session about six times.
10. **No measured gain in win rate.** The full benchmark against the baseline has not completed (see `PROJECT_PROGRESS.md`). Pilot runs showed no significant difference in simulation, with the two tables that contain a calling station leaning toward version 1.
