# Poker bot for PokerNow: install and use

A Chrome Manifest V3 extension that watches a PokerNow No-Limit Hold'em table, rebuilds the hand, decides locally, learns opponent statistics and, when you authorise it for a table, clicks for the seat. No external service is used at any point. The only network traffic is the PokerNow page itself.

Use autonomous mode only where the organiser allows bots (a bot-versus-bot competition). Everywhere else keep it in manual or recommend mode, or off.

**Status in one line:** the engine, simulator, state tracker and executor are tested offline; the extension has never been loaded in Chrome or run on a live PokerNow table in this work. See [LIMITATIONS.md](LIMITATIONS.md) before relying on it.

## Build

```bash
npm install
npm run build        # type-checks, then writes the unpacked extension to dist/
```

`dist/` is the compiled unpacked extension: `manifest.json`, `content-script.js`, `background.js`, `popup.html/js`, `dashboard.html/js`.

## Load in Chrome

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `dist` folder.
3. If the earlier "GTO Poker Overlay" extension is installed, remove it first. It auto-plays by default and would fight this one.
4. Open a PokerNow game (`https://www.pokernow.club/games/...`). A small "Poker bot" panel appears top-left.

After rebuilding, press the reload icon on the extension card and reload the PokerNow tab.

## Modes

Set in the toolbar popup.

| Mode | Observes and profiles | Shows decisions | Clicks |
|---|---|---|---|
| Manual | yes | no | never |
| Recommend (default) | yes | yes | never |
| Autonomous | yes | yes | only on an authorised table |

To let it act: tick the authorisation box in the popup, open the table, click **Authorise this table**, and choose Autonomous. All three are required, per table. Unticking the box clears every authorised table.

**Emergency stop** is the red button in the in-page panel, the popup and the dashboard. It disarms the executor immediately and stays on until you clear it in the popup or dashboard.

## Dashboard

Popup, then **Open dashboard**.

- **Live**: one status pill (Ready, Waiting, Reconnecting, Needs attention, Paused); your cards, position and stack; the board; the recommended action or a plain statement of why there is none; whose turn it is; pot, price, blinds and opponents; the players list; recent actions. EV per option, the full reasoning and opponent ranges open under the recommendation.
- **Opponents**: every profile with counts, opportunities, shrunk estimates and intervals, style probabilities, evidence-gated observations, bet sizes, showdowns.
- **Hand review**: stored hands with the full action and the bot's decision at each of its turns.
- **Diagnostics** (collapsible sections): six separate state checks, observed versus predicted actor, the action timeline of the current hand, player participation, discrepancies, **Export Debug Bundle**, which page elements were found, the event log. See [TRACKING.md](TRACKING.md).
- **Settings**: think time, confidence threshold, assumed clock, selector overrides, PokerNow log import, export, delete.

## Checking a strategic decision

In recommend mode, on your turn, the Live page (and the overlay) shows the action and a **Why** list. From 0.6.0 that list reads, in order:

1. `Spot:` who raised last before the flop, who holds the betting lead, whether you are in or out of position, opponents left, stack-to-pot ratio.
2. `Calculated approximation:` how many deals and ranges the EV comparison used.
3. For a bet or raise: `Bet type:` (continuation bet, lead (donk bet), probe bet, delayed continuation bet, raise) and its `purpose` (value bet, protection or thin value, thin bet, bluff or semi-bluff); then `Modelled responses:` how often everyone folds, someone calls, someone raises, how often you win against the hands that call, and the plan if raised.
   For a check: how often an opponent is expected to bet behind you and whether the plan is to call or fold.
4. Warnings, when they apply: `Out-of-distribution` (your hand is not one the line you took normally contains, for example after calling against advice), `Model-dependent` (the bet only pays if opponents fold as often as assumed, or an opponent's line fits the model poorly). Any of these adds "Lower confidence" to the last line.
5. From 0.6.1, for a bet or raise: `Opponent-model sensitivity:` the bet's value if opponents respond as modelled and its value if they fold less often. The lower one is used. If the two disagree about the best action, a `Model-dependent` line names the other action. The "±" figure elsewhere is sampling noise only and does not cover this difference.

The engine's EV numbers come from a hand-set opponent model. Against simulated opponents the current engine (v2) bets less than the previous one (v1) and does not win more; see [STRATEGY_V2_DIAGNOSIS.md](STRATEGY_V2_DIAGNOSIS.md). Treat close decisions as close.

Open **All options considered, full reasoning and opponent ranges** under the recommendation to see every candidate with its EV and the range assumed for each opponent. Preflop, the Why list names the strategy pack used, says "source not verified" where that is the case, and lists every way the situation departs from what the pack was made for.

To look at a hand afterwards: **Hand review** shows each stored decision. To re-run the current engine on recorded hands outside the browser, export a debug bundle (Diagnostics) and run

```bash
npm run bot:decisions -- debug_bundles/<file>.json --recorded            # every point where you were to act: advice then, advice now
npm run bot:decisions -- debug_bundles/<file>.json --hand 12 --street flop --samples 8000
npm run bot:scenarios -- --verbose                                       # the built-in decision scenarios, old engine against new
```

The re-run uses neutral opponent statistics (a bundle holds no profiles), so its numbers can differ a little from what you saw live.

## Run simulated games (no browser)

```bash
npm run bot:sim -- --players bot,tight-aggressive,loose-passive,range-equity --hands 3000 --duplicate
npm run bot:sim -- --players bot,legacy-engine --hands 4000 --duplicate      # versus the original engine
npm run bot:sim -- --players bot,random,calling-station --hands 60 --log reports/decisions.jsonl
npm run bot:sim -- --players bot,loose-aggressive,tight-passive,random --tournament --hands 2000
```

Players: `bot` (current engine), `bot-v1` (the 0.5.1 strategy engine, kept as a baseline), `bot-noexploit`, `bot-deviating` (calls half the cheap preflop bets the engine wanted to fold), `range-aware`, `legacy-engine` (2 to 6 players only), `random`, `calling-station`, `tight-passive`, `loose-passive`, `tight-aggressive`, `loose-aggressive`, `range-equity`. Give 2 to 10 names.

Options: `--hands N`, `--seed N`, `--stack BB`, `--samples N` (Monte Carlo deals per bot decision), `--duplicate`, `--ante CHIPS`, `--straddle CHIPS`, `--tournament`, `--log FILE`.

### Inspect decision logs

`--log FILE` writes one JSON object per bot decision: hand id, board, street, chosen action, heads-up/multiway branch, equity, every candidate with EV, standard error and frequency, the basis lines (chart, computed, heuristic, learned), opponent adjustments, the uncertainty statement, each opponent's estimated range, the player counts and compute time.

```bash
node -e "const l=require('fs').readFileSync('reports/decisions.jsonl','utf8').split('\n');console.log(JSON.stringify(JSON.parse(l[0]),null,2))"
grep '"street":"river"' reports/decisions.jsonl | head
```

In the extension the same record is stored per decision and shown in **Hand review**.

## Benchmarks and tests

```bash
npm run bot:bench            # full report into reports/bench-<date>.md and .json (several minutes)
npm run bot:bench -- --quick # small smoke run
npm run bot:strategy-bench  # current strategy engine against the 0.5.1 baseline on identical deals (about an hour)
npm run bot:scenarios       # decision scenarios with property checks
npm run bot:ranges -- coverage  # which preflop situations have strategy data
npm run test:bot             # the bot's own test suite (about 30 s)
npm test                     # everything, including the original repository's suite (about 11 minutes)
```

## Documents

- [ARCHITECTURE.md](ARCHITECTURE.md): modules, data flow, Manifest V3 lifecycle, security.
- [STRATEGY.md](STRATEGY.md): the mathematics, how heads-up and multiway are chosen, and where every piece of strategic knowledge comes from.
- [STRATEGY_AUDIT.md](STRATEGY_AUDIT.md): the audit of the strategy engine against recorded hands, the confirmed defects and what replaced them.
- [STRATEGY_LIBRARY.md](STRATEGY_LIBRARY.md): strategy packs, import formats, and the strategy data that is missing.
- [TRACKING.md](TRACKING.md): state reconstruction, turn tracking, the debug bundle, replay, and the steps for the next live test.
- [STORAGE.md](STORAGE.md): the local data schema.
- [LIMITATIONS.md](LIMITATIONS.md): what is tested, what is not, failure modes, and the prioritised to-do list.
- [STORAGE.md](STORAGE.md): what is stored locally, and exactly what each kind of deletion removes.
- [LONG_SESSION_DIAGNOSTIC_AUDIT.md](LONG_SESSION_DIAGNOSTIC_AUDIT.md): the audit of the 2026-11-16 recording and the tracking fixes that came from it.
- [PHASE_2_2_REPORT.md](PHASE_2_2_REPORT.md): reference evaluation, independent opponents, river solver reference, the PokerBench model, data pipeline.
