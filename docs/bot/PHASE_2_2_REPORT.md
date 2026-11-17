# Phase 2.2, first part: measuring instruments and what they show

Date: 2026-11-16. Version 0.7.0. Builds on [STRATEGY_V2_DIAGNOSIS.md](STRATEGY_V2_DIAGNOSIS.md) and follows the
order of [POKER_DATA_TRAINING_ROADMAP.md](POKER_DATA_TRAINING_ROADMAP.md).

**No strategy behaviour was changed in this phase.** Six things were built, all offline (under `sim/`, not in
the extension), and four of them produced results. The default engine is still version 2; version 1 can be
chosen under Settings, Strategy experiments.

Terms: "version 1" is the 0.5.1 engine, "version 2" the 0.6.0 engine. bb = big blinds. Intervals are 95%.
An asterisk marks an interval that excludes zero.

## What is new, in one table

| | Built | Result |
|---|---|---|
| A | Reference evaluator: the value of every candidate action under the simulated opponents' true policies and actual cards | Version 2's choices cost 0.64 ± 0.36 bb per decision against version 1's at the tight-aggressive table and gain 0.81 ± 0.70 against the trapper. Almost no single class of alternative is clearly better than what either engine chooses. |
| B | Six opponents that share nothing with either engine's opponent model, several built to punish frequent betting | Version 2 is ahead of version 1 at four of eight such tables and behind at none. |
| C | River reference from the in-repository solver, checked against a closed-form game and recomputed independently | With nothing to call on the river, version 2 checks 62% of the time where the solution checks 30%, and gives up 1.15 ± 0.24 bb more than version 1 against it. |
| D | Offline adapter for the existing PokerBench model | Correctly loaded and correctly masked. No advantage found: worse than version 1 under the true policies and no better than either engine against the river reference. Stays experimental and off. |
| E | Data schema, provenance, validation, importers | Works on synthetic fixtures. No dataset was downloaded; the importers have not seen real files. |
| F | Calibration framework: assumption, population and player kept as separate layers | Works on simulated and synthetic hands. No real-hand frequencies exist yet, so nothing was calibrated. |

## How the picture changed since Phase 2.1

Phase 2.1 said: version 2 has no measured advantage, is significantly behind at several simulated tables, and
those tables are populated by opponents built from version 1's own behaviour model, so version 1 may simply be
playing against players it predicts. That last point was a caveat without evidence. It now has evidence on
both sides:

- Against opponents that are **not** built from either engine's model, version 2 is not behind anywhere and is
  significantly ahead where the opponent calls down light, traps or adapts to frequent betting (B).
- Version 2's deficit at the tight-aggressive table is real at the level of single decisions, not an artefact of
  variance (A), and it is concentrated on the river.
- On the river, measured against a solver for the ranges version 2 itself believes in, version 2 is too
  passive when nothing has been bet (C). Version 1 bets far more often there (85% against the solution's 70%)
  and loses less.

So the earlier single statement "version 2 is too passive" splits in two. Checking more often is what protects
version 2 against opponents who punish betting, and it is what costs it against opponents who fold. Neither
engine is shown to be better overall, and nothing here says anything about real opponents.

## A. Reference evaluation of single decisions

`sim/bot/reference.ts`, `sim/bot/reference-eval.ts` (`npm run bot:reference`).

At a decision point reached in simulated play, each candidate action is played out with everyone's actual
cards and the opponents' real policies: every remaining river is enumerated on the turn, run-outs are sampled
on the flop, and the same cards and random seeds are used for every action. The value is the measured seat's
change in stack from that point (folding is zero), which is the same definition as the engine's own EV column.
After the action the seat continues with version 2 in every case, so only the one decision differs.

One value uses hidden cards and is therefore not something a player could have known. Only averages over many
decisions are reported.

Tests: exact values against an always-calling opponent, full enumeration on the turn against brute-force
equity, pairing on the flop, and that the continuation policy only ever sees its own cards
(`tests/bot/reference.test.ts`). A test also fails if anything under `src/` imports the evaluator, or if the
extension's entry files can reach the simulator at all.

### Version 2's choice against version 1's, same state and cards (bb per decision)

| Table | Decisions | All | Flop | Turn | River | Share where the two differ |
|---|---|---|---|---|---|---|
| Heads-up, tight-aggressive (version 1's model family) | 539 | −0.64 ± 0.36 * | −0.21 ± 0.40 | −0.49 ± 0.46 * | −2.35 ± 1.55 * | 39% |
| Heads-up, trapper (independent) | 699 | +0.81 ± 0.70 * | +0.24 ± 0.70 | +1.64 ± 1.18 * | +0.77 ± 1.98 | 63% |
| Heads-up, minimum-defence defender (independent) | 487 | +0.07 ± 0.65 | +0.17 ± 0.53 | +0.22 ± 1.15 | −0.27 ± 1.91 | 65% |
| Six-handed mixed (Phase 2.1 table) | 274 | −0.96 ± 1.15 | −0.55 ± 1.10 | −1.57 ± 3.05 | −1.38 ± 3.04 | 46% |
| Six-handed independent | 313 | −1.06 ± 1.80 | −1.08 ± 1.81 | −0.05 ± 3.42 | −2.97 ± 9.64 | 40% |

Seeds 7100 (heads-up, 800 hands) and 7200 (six-handed, 900 hands). The states are those version 2 visits.

### Is some class of action systematically ranked too low?

For each engine and each kind of spot, the value of every alternative class minus the value of the action the
engine chose was averaged. A clearly positive number would mean "that alternative should have been chosen more".

Across five tables, two engines, six kinds of spot and up to eleven classes, **two** cells are positive with an
interval that excludes zero, both at the trapper table on the flop when checked to: a medium bet beats what
version 2 chose by 0.63 ± 0.52 bb (it checked 41% of the time there) and what version 1 chose by 0.50 ± 0.48.
With that many cells, two is no more than chance alone would produce.

Read plainly: at the resolution of a few hundred decisions per table, neither engine is making a mistake that a
simple rule ("bet medium more on the flop") would fix. The gap between the engines comes from many small
differences, largest on the river. Larger samples per kind of spot are needed to say more.

### Are the engine's own EV estimates right?

Version 2's EV estimate minus the reference value, bb per candidate (positive = optimistic).

| Table | Check | Call | Bets and raises | Bets and raises, river |
|---|---|---|---|---|
| Heads-up, tight-aggressive | −0.97 ± 1.07 | +1.14 ± 3.73 | −0.87 ± 0.71 * | −3.32 ± 2.09 * |
| Heads-up, trapper | +0.44 ± 0.85 | +5.98 ± 7.14 | +0.52 ± 0.70 | +1.33 ± 1.83 |
| Heads-up, minimum-defence defender | +0.49 ± 0.84 | +4.57 ± 6.46 | −0.01 ± 0.69 | −1.04 ± 1.62 |
| Six-handed mixed | −5.47 ± 3.32 * | −9.64 ± 5.39 * | −8.17 ± 1.77 * | −5.70 ± 5.21 * |
| Six-handed independent | −6.78 ± 3.01 * | −11.50 ± 5.85 * | −7.21 ± 1.82 * | −3.54 ± 5.88 |

- Heads-up the estimates are close to unbiased, with one exception that matches the rest of the evidence:
  against the tight-aggressive opponent version 2 values river bets 3.3 bb too low.
- Six-handed, every action is valued 5 to 11 bb too low. The bias is about the same for checking, calling and
  betting, so it moves the ranking less than its size suggests, but it means the EV numbers shown for multiway
  pots at these tables are pessimistic. The opponents there are weak (the bot wins well over 100 bb/100), and the
  engine does not expect that.

## B. Independent opponents

`src/bot/sim/independent.ts`, `sim/bot/independent-bench.ts` (`npm run bot:independent-bench`).

Six players written from raw equity against random hands, pot odds and their own fixed frequencies. None calls
the bot's behaviour or range models (a test checks the imports).

| Opponent | What it does |
|---|---|
| pot-odds caller | Calls whenever its equity beats the price; never bluffs |
| minimum-defence defender | Continues with the share of hands that makes a bluff break even; polar betting range |
| trapper | Checks strong hands and raises when bet into; calls down light |
| maniac | Bets and raises most of the time with anything |
| nit | Continues only when clearly ahead |
| adaptive punisher | Counts how often the others bet when they could check; the more they bet, the lighter it calls and the more it raises |

They are stand-ins for styles, not models of people, and none is a good strategy: the bot beats all of them.

### Version 2 against version 1 (bb/100; seed 8800, never used before; about 2,400 hands per table and engine; paired by deal)

| Table | Version 1 | Version 2 | Version 2 minus version 1 | Bets when checked to (v1 / v2) |
|---|---|---|---|---|
| Heads-up, pot-odds caller | +219.5 ± 74.8 | +239.9 ± 63.4 | +20.4 ± 48.6 | 75% / 49% |
| Heads-up, minimum-defence defender | +18.9 ± 58.0 | +74.9 ± 43.7 | +56.0 ± 42.8 * | 85% / 48% |
| Heads-up, trapper | +19.1 ± 64.9 | +105.5 ± 46.4 | +86.4 ± 54.7 * | 83% / 49% |
| Heads-up, maniac | +358.4 ± 106.4 | +378.7 ± 102.1 | +20.2 ± 79.3 | 74% / 58% |
| Heads-up, nit | +60.8 ± 29.8 | +43.3 ± 31.3 | −17.4 ± 24.7 | 91% / 89% |
| Heads-up, adaptive punisher | +31.2 ± 93.6 | +119.0 ± 52.7 | +87.8 ± 77.9 * | 78% / 49% |
| Six-handed: caller, defender, trapper, maniac, nit | +148.3 ± 85.1 | +164.4 ± 75.6 | +16.1 ± 62.7 | 71% / 48% |
| Six-handed: two punishers, two trappers, defender | −12.6 ± 78.3 | +56.4 ± 59.7 | +69.1 ± 58.0 * | 74% / 48% |

Four of eight favour version 2 with intervals that exclude zero; none favours version 1. The only table that
leans to version 1 is the nit, the one opponent here that folds a great deal, which is the same direction as
the Phase 2.1 results against the tight-aggressive program.

Limits: one seed; opponents that the bot beats by large margins; a difference of 56 bb/100 against a crude
program is not a forecast of anything against people. What it does establish is that the Phase 2.1 ranking of
the two engines depended on who was at the table.

## C. River reference from the solver

`sim/bot/river-reference.ts`, `sim/bot/river-compare.ts` (`npm run bot:river`).

A heads-up river decision with both ranges, the pot, the stacks and the allowed bet sizes fixed is a small
zero-sum game. The repository's range-versus-range solver finds an approximate equilibrium of it, and how far
that is from exact can be measured.

**What was validated before using it**

- A game with a known answer: aces or air against a hand that beats only the air, one pot-sized bet. Theory:
  the caller calls half the time, Hero bets every ace and bluffs three hands for its six aces, aces are worth
  150 and bluffs 0. The solver reproduces each of these (`tests/bot/river-reference.test.ts`).
- Every value is recomputed by separate code that enumerates each pair of hands directly. On the 1,455 spots
  below the largest difference from the solver's own numbers is 3 × 10⁻¹¹ chips.
- Every solution used can be beaten by a best-responding opponent for at most 0.30% of the pot (median 0.16%).

**What it is not.** It is the equilibrium of the one-street game with the ranges given, here the ranges
version 2 itself assigns from the action so far. It is not a solution of the whole hand and is never called
GTO. The comparison therefore asks: given what the engine believes about both ranges, is its action one an
equilibrium player would take, and what does it give up to an opponent who plays that equilibrium?

### Results (1,455 river decisions from four heads-up tables, 3,000 hands each, seed 9350)

Nothing to call (1,279 spots):

| | Checks | Bets small | Bets medium | Bets large or more | Loss against the solution (bb) |
|---|---|---|---|---|---|
| Solution, for Hero's actual hand | 30% | 16% | 12% | 41% | 0 |
| Version 1 | 15% | 25% | 18% | 42% | 1.30 ± 0.19 |
| Version 2 | 62% | 13% | 10% | 16% | 2.45 ± 0.25 |
| Existing model | 43% | 1% | 32% | 24% | 1.83 ± 0.23 |

Version 2 loses 1.15 ± 0.24 bb more than version 1 here. It checks twice as often as the solution and bets
large less than half as often.

Facing a bet (176 spots):

| | Folds | Calls | Raises | Loss against the solution (bb) |
|---|---|---|---|---|
| Solution, for Hero's actual hand | 66% | 7% | 27% | 0 |
| Version 1 | 38% | 31% | 32% | 6.48 ± 1.60 |
| Version 2 | 65% | 24% | 11% | 5.58 ± 1.66 |
| Existing model | 49% | 18% | 34% | 7.70 ± 2.21 |

No significant difference between the engines (version 2 minus version 1: −0.89 ± 1.57). Both lose much more
here than when nothing has been bet. The solution almost never just calls; both engines call a quarter to a
third of the time. That may be a real weakness or may reflect ranges that are too wide for the bettor, which
this comparison cannot tell apart.

**Why this matters.** This is the first comparison in the project against something that is not another
hand-written program. It points at one specific place: version 2's river play when checked to or first to act.
It agrees with A (river bets valued 3.3 bb too low against the tight-aggressive opponent; the largest
per-decision deficit on the river) and with Phase 2.1 (river bet frequency 36 to 48% against version 1's 70 to
77%).

## D. The existing PokerBench model

`sim/bot/ml-adapter.ts`, `sim/bot/ml-compare.ts` (`npm run bot:ml-compare`). Experimental and disabled: the
active bot does not import the model or the adapter, and a test fails if it ever does.

| Question | Answer |
|---|---|
| Is it loaded correctly? | Yes. Agreement with the 2,000 held-out PokerBench rows in the repository: 84.5%, the figure recorded when it was trained. |
| Are its inputs built correctly? | The action mask it applies equals the rules engine's legal actions on 770 of 770 simulated decisions; its action was legal in 770 of 770. Inputs follow the training definitions (pot including the current street; the bet faced as a raise-to total). |
| Is it asked familiar questions? | Often not. 23% of postflop decisions had more than two players in and were not given to it. Of the 770 heads-up ones, 313 were inside its training setting (six-handed table, raised pot, about 100 bb, nobody all-in). The rest were limped pots or heads-up tables. |
| How does the mix differ from its training data? | Its held-out rows are 6% flop and 54% river; simulated play is 55% flop and 16% river. It was trained mostly facing a bet (64%); in play it faces one 30% of the time. Stack depth, number of players, earlier bet sizes and the opponent are not inputs at all. |

Actions and results:

| | Same class as version 2 | Same class as version 1 | Bets or raises |
|---|---|---|---|
| Model, all 770 decisions | 51% | 47% | 35% (version 2: 47%, version 1: 62%) |

| Value under the true policies, bb per decision | Model minus version 2 | Model minus version 1 |
|---|---|---|
| All (386 priced) | −1.27 ± 1.65 | −1.80 ± 1.77 * |
| Inside its training setting (158) | −3.35 ± 3.07 * | −3.42 ± 3.50 |
| Outside it (228) | +0.17 ± 1.80 | −0.68 ± 1.75 |
| River (59) | −5.25 ± 7.33 | −5.65 ± 5.58 * |

Against the river reference it sits between the two engines when nothing has been bet (1.83 bb) and is the
worst of the three facing a bet (7.70 bb); all of those river spots are outside its training setting.

**Conclusion.** Nothing here supports using the model for decisions. It is not worse because it is "wrong
about equilibrium": it was fitted to equilibrium labels for one format and is being priced against exploitable
simulated opponents and on spots it never saw. Its sensible remaining use is the one the roadmap already
names: a reference signal for agreement checks on PokerBench-like spots, once real rows are available.

## E. Data pipeline

`sim/bot/data/` (schema, validate, importers, manifest). `data/` at the repository root is git-ignored.

- **One schema** for solver-labelled decisions and hand histories. Every record carries the id of its source.
- **Provenance is required**: origin, licence as stated, a note on what is and is not known about the right to
  use the data, date, and the SHA-256 and size of every file. Data from elsewhere must be marked as needing
  approval and cannot be imported until `approvedBy` and `approvedOn` are filled in. A file that no longer
  matches its hash blocks its source.
- **What a label means is part of the schema.** People's hands are `human-action`, other programs' hands are
  `program-action`, and the validator rejects a source that tries to present either as solver output. Only
  `solver-dominant-action` may be used as a target for what to do; the others may be used to count how often
  players do things.
- **Every hand is replayed** through the bot's own rules engine: cards real and distinct, each action legal and
  in turn, chips conserved. A hand that fails is left out and reported with the reason; nothing is repaired.
- **Importers**: the PokerBench postflop column layout, PHH hand files, and own PokerNow logs (the same reader
  the dashboard uses).

Status, stated exactly: the importers were written from the published format descriptions and run only on four
small synthetic fixtures written by hand for this project. **No dataset was downloaded and none is on this
machine.** PokerBench rows are imported as "partial" records: cards, pot, position, legal moves and label are
read, the preflop line is kept verbatim, and rebuilding the full hand from it waits for real rows to check the
format against.

## F. Opponent-response calibration

`sim/bot/data/calibration.ts`. Not read by the engines.

Three layers that cannot be mixed up, each with its own counts and source:

1. **Assumption**: a chosen number with where it is written down. The engine's present priors are exposed
   this way (for example "fold to a river bet 50%, strength 10, `PRIORS.foldVsBetRiver`").
2. **Population**: counts from a named set of recorded hands, with an estimate and interval.
3. **Player**: one player's own counts, shrunk toward the population, or toward the assumption when there is no
   population data.

Every estimate says which layer it rests on and how many real observations are behind it. With none, the
answer is the assumption, labelled "ASSUMED, not measured". Counts are per street, bet size class and
heads-up or multiway, for "facing a bet" (fold, call, raise) and "checked to or first" (bet, check).

Tested on simulated hands with known behaviour (a player who never folds is recovered as such) and on the
synthetic fixtures. **There are no real-hand frequencies yet**, so no prior has been changed and no calibrated
number exists. That needs your PokerNow logs or an approved external source.

## What the evidence now supports doing next

In order, each gated by the same acceptance rule as before (no significant loss across opponent families and
seeds, scenario properties still holding):

1. **River betting when nothing has been bet.** The one place where three independent instruments agree.
   The work is to find why version 2 values river bets too low (candidates from Phase 2.1: the range-relative
   response model and the pessimistic scenario), using the river reference as the test, then check that the
   independent-opponent results in B do not get worse.
2. **Multiway EV scale.** Version 2's estimates are 5 to 11 bb too low six-handed at these tables. Find whether
   that is the equity-realisation assumption or the response model before it distorts sizing.
3. **Real response frequencies** into the calibration framework: your own logs first.
4. **Larger reference samples per kind of spot**, to see whether the two flop cells at the trapper table are
   real.

Not supported by anything here: switching the default engine, using the PokerBench model for decisions, or any
claim about play against people.

## Reproducing

```
npm run bot:reference -- --table hu-tag --hands 800 --seed 7100
npm run bot:independent-bench -- --hands 2400 --seed 8800
npm run bot:river -- --tables hu-re,hu-trapper,hu-tag,hu-mdf --hands 3000 --seed 9350
npm run bot:ml-compare -- --tables six-independent,hu-re --hands 1500 --seed 9300
npx tsx sim/bot/data/manifest.ts check <manifest.json>
```

Raw reports: `reports/reference-eval-2026-11-16-*.md`, `reports/independent-bench-2026-11-16.md`,
`reports/ml-compare-2026-11-16.md`.
