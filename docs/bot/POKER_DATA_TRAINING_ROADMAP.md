# Data-driven strategy: sources, what each can and cannot do, and a plan (Phase 2.2 proposal)

Dated 2026-11-16. This is a plan. Nothing here has been downloaded, trained or wired into the engine. Facts about the datasets come from their public pages, read on this date; anything I could not confirm from those pages is marked "to verify on a sample".

Starting point, from [STRATEGY_V2_DIAGNOSIS.md](STRATEGY_V2_DIAGNOSIS.md): the engine's equity and pot arithmetic are calculated, but every number describing how opponents behave is hand-set, and there is no solver reference in the repository. Those are the two gaps data can close.

Division of labour used throughout:

| Kind of data | Used for | Not used for |
|---|---|---|
| Solver-derived decisions | A reference to validate decisions against; a training target for a prior | Profit claims; spots outside the solved format |
| Real hand histories | Measuring how players respond (fold, call, raise, bet when checked to); opponent-model priors | Deciding what Hero should do |
| Elite and Pluribus hands | Descriptive comparison, a sanity anchor, a replay test for the rules engine | Labels to imitate |

## 1. The three sources

### 1.1 PokerBench (solver-derived decisions)

| | |
|---|---|
| Where | Hugging Face dataset `RZ412/PokerBench`; paper: Zhuang et al., "PokerBench", AAAI 2025, arXiv 2501.08328 |
| Licence | The dataset card says Apache-2.0. The preflop labels are described in the paper as taken from GTO Wizard's strategies, a commercial product; whether that product's terms allow this reuse is not something I can confirm. Treat as: local research use, no redistribution, your decision. |
| Size | Preflop: 60,000 training rows and 1,000 test rows. Postflop: 500,000 training rows and 10,000 test rows. (The paper's "11,000 scenarios" is the two test sets.) |
| Format | CSV with structured fields, plus JSON with the same spots as English prompts. |
| Game | Six-handed no-limit hold'em cash, 100bb. At most two preflop raises (single-raised and 3-bet pots). Postflop was solved with WASM-Postflop, which is a heads-up solver, so every postflop spot is heads-up. |
| Fields, preflop | previous action line, Hero position, Hero cards, legal moves, pot, players left, label |
| Fields, postflop | preflop action, flop, turn, river, who was the last aggressor, postflop action line, street of the decision, legal moves, pot, Hero position, Hero cards, label |
| Stacks | Not a column; 100bb starting stacks are implied. To verify on a sample. |
| Targets | One action per row (with a size for bets and raises). No EV. No action frequencies. |
| How rows were chosen | Only holdings where one action has more than 50% frequency in the solution; then resampled so the four action classes are equally common. |

What that means:

- It is a genuine solver reference for heads-up postflop spots in six-max 100bb pots, the first one this project would have. It includes out-of-position decisions when first to act, which is exactly where the open weak-lead question sits.
- It cannot calibrate frequencies. Mixed spots were removed and the classes were balanced, so "the label is Bet in 25% of rows" says nothing about how often a solver bets.
- Agreement with it is not profit. It measures closeness to an equilibrium for one format, against opponents who also play it.
- The implied ranges are the solver's preflop ranges. The bot uses chart ranges, so some disagreement will come from the ranges, not from the postflop logic.
- Nothing in it is multiway after the flop, and nothing is deeper or shallower than 100bb.

### 1.2 PHH dataset (real hand histories)

| | |
|---|---|
| Where | GitHub `uoftcprg/phh-dataset`; archive on Zenodo (record 17136841, one 20.3 GB zip). Format paper: Kim, "Recording and Describing Poker Hands", arXiv 2312.11753 |
| Licence | The repository is MIT. The large real-money part is described as "anonymized hand history logs scraped ... uploaded by HandHQ". The original collection was third-party scraping of poker sites in 2009; I cannot confirm its legal status. Treat as: local analysis only, no redistribution, your decision. |
| Size | 21,605,687 no-limit hold'em hands from 1 to 23 July 2009, stakes 25NL to 1000NL, from several networks (the lists on GitHub and Zenodo differ slightly). The Zenodo archive also holds hundreds of millions of bot-versus-bot hands from the Annual Computer Poker Competition; the GitHub page shows those struck out. |
| Format | PHH: one small TOML-style text file per hand: variant, antes, blinds or straddles, minimum bet, starting stacks, and an action list such as `d dh p1 AsKs`, `p3 cbr 300`, `p1 f`, `d db Jc3d5c`. The Python library `pokerkit` reads it. |
| Game | Cash. Table sizes vary. |
| Cards | Board cards and bets: yes. Positions and stacks: yes (seat order and starting stacks). Hole cards: these are observer logs, so I expect only shown hands to have cards. To verify on a sample. |
| Targets | None. These are human actions. |

What that means:

- It is the right material for the thing the diagnosis found weakest: how often players fold, call and raise by street and size, how often the preflop raiser bets when checked to, how often a player bets the turn after calling a lead. Those can become measured priors with a stated source instead of round numbers.
- The players are 2009 online regulars and recreational players at real-money tables. A PokerNow private game is a different population. The measurements replace invented numbers with real ones from a different pool; they are still not your opponents. Your own PokerNow logs are the better source as soon as there are enough of them.
- Showdown-only hole cards bias anything that conditions on a hand's strength: hands that fold are never seen. Frequencies of actions are unaffected; "what does a turn raise contain" is affected.

### 1.3 Pluribus and elite tournament hands

| | |
|---|---|
| Where | Inside the PHH dataset: "All 10,000 hands played by Pluribus, published in the supplementary of Brown and Sandholm (2019)", and all 83 televised hands of the 2023 WSOP $50,000 Poker Players Championship final table. |
| Licence | Redistributed in the MIT repository; originally the supplementary material of the Science paper. Local use. |
| Size | 10,000 Pluribus hands; 83 WSOP hands; four small historical selections. |
| Game, Pluribus | Six-handed no-limit hold'em, 100bb, stacks reset every hand: cash-like. Opponents were elite professionals. |
| Game, WSOP | A mixed-game tournament final table: several variants, tournament stacks and payout pressure. Little of it is no-limit hold'em. |
| Cards | Board, positions, bets, stacks: yes. Hole cards: the published Pluribus logs record them for the players; to verify on a sample how completely. |
| Targets | None. No EVs, no frequencies. |

What that means:

- 10,000 hands is about 1,700 hands per seat. That is enough for coarse frequencies (how often does anyone lead into the raiser in a six-max 100bb game between very strong players?) and far too few to learn a strategy from.
- Pluribus played mixed strategies against specific opponents. A single action it took is one draw from a mix, not "the right play".
- The format matches the bot's rules engine exactly, with full information, so it is a good replay test: 10,000 complete hands through the engine with every pot checked.
- The WSOP hands are not relevant unless your competition is a tournament, and then only the hold'em hands, as reading material.

## 2. The machine-learning code already in the repository

Inspected: `ml/prep.ts`, `ml/train.py`, `ml/verify.ts`, `src/core/ml/features.ts`, `policy.ts`, `model.ts`.

- **It is already a PokerBench pipeline.** `ml/prep.ts` reads the PokerBench postflop CSVs and maps `correct_decision` to five classes (fold, check, call, bet, raise) plus a bet-size bucket. `ml/train.py` trains a two-hidden-layer network (51 inputs, 512 and 256 units) in plain numpy and writes the weights into `src/core/ml/model.ts`. The file records 84.5% action agreement on PokerBench's test set and 92.4% validation accuracy for the size bucket.
- **Inputs:** hand category, equity against a random hand, a few card and board-texture flags, street, in or out of position, facing a bet, price, 3-bet pot, preflop aggressor, bets this street. No ranges, no stack depth, no number of opponents, no opponent statistics.
- **Who uses it:** the original repository's `DecisionEngine` (`src/core/engine.ts`). The active `BotAgent` does not import it.

Is it applicable to `BotAgent`? Not as it stands:

1. It only knows heads-up postflop spots in six-max 100bb pots. The recorded PokerNow hands are mostly multiway and limped.
2. Its training rows were filtered to clear decisions and balanced by class, so its output probabilities are not solver frequencies and it has never seen a close decision.
3. 84.5% is agreement on rows drawn the same way as the training rows. It is not a win rate and says nothing about the 15% it gets wrong, which may be the expensive ones.
4. In the 2026-11-14 benchmark both bot engines were within noise of the original engine heads-up (v2 −4.0 ± 23.6, v1 −11.1 ± 35.1 bb/100). I have not checked whether that seat used the network or another branch of the old engine, so this is not evidence for or against the model.

Validation it would need before any role in `BotAgent`:

- An adapter from the bot's `HandState` to the model's `Spot`, with a parity test against `ml/prep.ts` on the same rows.
- Its agreement with the reference broken down by spot type, next to the same number for v1 and v2 (section 4, E1), so the three can be compared on equal terms.
- A paired simulation of `BotAgent` with and without the model as a tie-breaker in heads-up pots only, on at least three opponent families and two seeds.
- A measure that does not depend on PokerBench: regret on river spots against the in-repository river solver (`src/core/solver/postflop-cfr.ts`), which is exact for the ranges it is given.

The reasonable role for it, if it passes: a second opinion in heads-up pots that flags disagreement, and a tie-breaker when the engine's own margin is inside its model error. Not the decision maker.

## 3. What each source would change in the bot

| Gap found in the diagnosis | Data that addresses it | Mechanism |
|---|---|---|
| No reference for any postflop decision | PokerBench postflop test set | Agreement report by spot type; the first external check on out-of-position leads |
| Preflop charts of unverified origin | PokerBench preflop | Agreement of the chart packs with 61,000 labelled six-max decisions; disagreements listed by scenario |
| Opponent frequencies are round numbers | PHH real hands; your PokerNow logs | Measured priors with source and sample size; the response-calibration tool from Phase 2.1 run on real hands |
| Turn behaviour after a called lead versus after a continuation bet (the weak-lead cause) | PHH real hands | Two measured frequencies replace two modelled ones |
| Close decisions settled by constants | PokerBench as a prior; the existing network | Tie-breaker only inside the model-error band |
| Rules engine tested on few complete real hands | Pluribus hands | Replay test |

What no listed source provides: multiway postflop references, limped-pot strategy, anything at stack depths other than 100bb, full-ring preflop ranges, PokerNow-specific player tendencies. Those still need your own solver runs and your own logs.

## 4. Proposed first step: a small dataset and a fixed evaluation

**Dataset (small; a few megabytes plus one slice):**

1. PokerBench test sets only: 1,000 preflop and 10,000 postflop rows.
2. The 10,000 Pluribus hands.
3. One slice of the real-money hands: six-handed tables at one stake, about 200,000 hands, taken from the repository's per-site files rather than the 20 GB archive.

Stored under a git-ignored `data/external/` with a manifest: source address, licence text, download date, SHA-256 of every file. Nothing committed.

**Evaluation, fixed before anything is fitted:**

- **E1, reference agreement.** Each PokerBench test row is rebuilt as a `HandState` and given to v1 and to v2 with a fixed seed and sample count. Reported: how often the engine's most likely action class matches the label, and the probability the engine gives the labelled action, with confidence intervals, split by street, position, facing a bet or not, and pot type. Baselines on the same rows: the most common label, and the existing network. This is a measure of closeness to a heads-up equilibrium, reported as that.
- **E2, response calibration on real hands.** For every bet in the real-hand slice the model's predicted fold, call and raise probabilities are compared with what happened; the same for "checked to, did they bet". Reported as predicted-versus-observed tables and log-loss, split by street, size and pot type. The slice is split by date into a fitting part and a held-out part before looking at it.
- **E3, profit check.** Unchanged: the paired simulator and the preflop-by-postflop factorial from Phase 2.1.
- **E4, replay.** All Pluribus hands through the rules engine; every final pot must match.

**Acceptance rule for any later change** (a refitted prior, a tie-breaker): better held-out log-loss in E2 or better agreement in E1, no significant loss in E3 across three opponent families and two seeds, and all scenario properties still holding. A change that improves E1 or E2 and loses in E3 is reported as exactly that and not shipped.

## 5. Roadmap

| Step | Work | Output | Needs |
|---|---|---|---|
| 1 | Download the small dataset; manifest; licence notes | `data/external/` (ignored), `docs/bot/DATA_SOURCES.md` | Your approval of the three sources |
| 2 | Parsers: PokerBench row to `HandState`; PHH file to `HandState` | Tests on samples; E4 replay result | Step 1 |
| 3 | E1 baseline for v1, v2 and the existing network | Report; list of largest disagreements by spot type | Step 2 |
| 4 | E2 baseline: current model against real hands | Report; which modelled frequencies are furthest from observed | Step 2 |
| 5 | Measured priors: replace `PRIORS` and the lead and bet-frequency constants with fitted values, each tagged "observed" with source and sample size | A candidate parameter set, not yet active | Step 4 |
| 6 | Evaluate the candidate by the acceptance rule; ship only if it passes | Benchmark report | Step 5 |
| 7 | Only then: decide whether a learned prior (the existing network, retrained with frequency targets from own solves) is worth adding | A separate proposal | Steps 3 and 6; solver access |

Steps 1 to 4 change no strategy code. Step 5 is the first that could, and it is gated by step 6.

Risks to keep in view:

- Tuning to PokerBench moves the bot toward a six-max 100bb heads-up equilibrium; your tables are 7 to 10 handed and limp-heavy. E3 and your own logs are the guard.
- Real-hand priors from 2009 online games may be further from PokerNow home games than the current round numbers in some respects. Each replaced constant keeps its old value as a switchable baseline.
- More parameters fitted to simulated opponents is not progress. Fitting happens on real hands only.

## 6. What I need from you before starting Phase 2.2

1. **Go-ahead on each source**, given the licence notes: PokerBench (Apache-2.0 card; preflop labels derived from a commercial tool), the 2009 real-money hands (scraped by a third party), the Pluribus hands.
2. **Your target game**: table size, stack depth in big blinds, cash or tournament, antes or straddles. It decides how much weight six-max 100bb data deserves.
3. **Your own PokerNow logs** from past sessions, as many as you have, in a git-ignored folder. These are the only data about your actual opponents.
4. **Download and disk limits**: is about 1 GB under `data/external/` acceptable; should the 20 GB archive stay off this machine (my recommendation: yes).
5. **Compute**: may fitting and evaluation run on this laptop (15.7 GB of memory, one job at a time), and is Python with numpy acceptable as the only training dependency, as in the existing pipeline.
6. **Solver access** for step 7 and for multiway or non-100bb references: which solvers you are licensed for, or approval to install the Rust toolchain and build the open-source `postflop-solver` that the repository already has an adapter for.
