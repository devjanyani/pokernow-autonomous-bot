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

## Run simulated games (no browser)

```bash
npm run bot:sim -- --players bot,tight-aggressive,loose-passive,range-equity --hands 3000 --duplicate
npm run bot:sim -- --players bot,legacy-engine --hands 4000 --duplicate      # versus the original engine
npm run bot:sim -- --players bot,random,calling-station --hands 60 --log reports/decisions.jsonl
npm run bot:sim -- --players bot,loose-aggressive,tight-passive,random --tournament --hands 2000
```

Players: `bot`, `bot-noexploit`, `legacy-engine` (2 to 6 players only), `random`, `calling-station`, `tight-passive`, `loose-passive`, `tight-aggressive`, `loose-aggressive`, `range-equity`. Give 2 to 10 names.

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
npm run test:bot             # the bot's own test suite (about 30 s)
npm test                     # everything, including the original repository's suite (about 11 minutes)
```

## Documents

- [ARCHITECTURE.md](ARCHITECTURE.md): modules, data flow, Manifest V3 lifecycle, security.
- [STRATEGY.md](STRATEGY.md): the mathematics, how heads-up and multiway are chosen, and where every piece of strategic knowledge comes from.
- [TRACKING.md](TRACKING.md): state reconstruction, turn tracking, the debug bundle, replay, and the steps for the next live test.
- [STORAGE.md](STORAGE.md): the local data schema.
- [LIMITATIONS.md](LIMITATIONS.md): what is tested, what is not, failure modes, and the prioritised to-do list.
