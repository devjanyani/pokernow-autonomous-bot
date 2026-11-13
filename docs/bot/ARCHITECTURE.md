# Architecture

All new code is under `src/bot/`. It reuses three verified parts of the original repository as libraries: the seven-card evaluator (`src/core/equity/hand-eval.ts`), the joint deal sampler (`src/core/equity/multiway-equity.ts`) and the preflop chart data (`src/core/ranges/`). The original extension still builds with `npm run build:legacy` into `dist-legacy/`.

## Data flow

```
PokerNow page (DOM)
   │  adapter/pokernow/dom.ts        observe(): TableObs      (only file that knows the markup)
   ▼
adapter/tracker.ts  HandTracker      TableObs -> validated HandState + confidence
   │                                  (every change is a legal action in table/engine.ts)
   ▼
agent.ts  BotAgent                   HandState + hero cards -> Decision (+ explanation)
   │   strategy/villains.ts            opponent ranges (preflop line, postflop narrowing)
   │   strategy/preflop.ts             charts / percentile rules / computed all-in calls
   │   strategy/postflop.ts            Monte Carlo EV of every candidate action
   │   equity/equity.ts                multiway equity, side-pot payouts
   │   opponents/profile.ts            statistics -> tendencies
   │   time/budget.ts                  how long to compute
   ▼
adapter/executor.ts GuardedExecutor  Decision -> at most one click, re-validated first
   │  adapter/pokernow/dom.ts        click(), betOrRaise()
   ▼
PokerNow page
```

`ext/controller.ts` runs this loop in the content script. `ext/background.ts` persists hands, profiles, decisions and diagnostics; `ext/dashboard.ts` and `ext/popup.ts` are the interface.

## Components (specification section 3)

| | Component | Files | Depends on the DOM |
|---|---|---|---|
| A | Table observation | `adapter/observation.ts`, `adapter/pokernow/dom.ts` | yes (dom.ts only) |
| B | Game-state reconstruction | `adapter/tracker.ts`, `table/engine.ts`, `table/positions.ts`, `table/pots.ts` | no |
| C | Decision engine | `agent.ts`, `strategy/*` | no |
| D | Opponent modelling | `opponents/profile.ts`, `ranges/*` | no |
| E | Equity and probability | `equity/equity.ts` + the reused sampler and evaluator | no |
| F | Decision-time controller | `time/budget.ts`, the anytime loop in `agent.ts` | no |
| G | Action execution | `adapter/executor.ts` + the driver half of `dom.ts` | driver only |
| H | Local persistence | `ext/storage.ts`, `ext/records.ts` | no |
| I | Simulation and testing | `sim/table.ts`, `sim/policies.ts`, `sim/bot/*.ts`, `tests/bot/*` | no |

The strategy code cannot reach the page: `BotAgent` receives a `HandState` and returns a plain `Decision`. Only `GuardedExecutor` holds the driver.

## The rules engine is shared

`table/engine.ts` is one state machine (Waiting → Preflop → Flop → Turn → River → Showdown → Complete, with early completion on folds and run-outs when betting is closed). The simulator plays hands through it, the live tracker replays observations through it, the PokerNow log importer replays log lines through it, and the executor validates the chosen action against it. So the legal bounds the bot computes are the same rules the simulator enforces: minimum raise from the last full raise, short all-ins that do not reopen betting, main and side pots, heads-up blind order.

Tracked separately for every hand (`tableCounts`): seats available, seated, dealt in, folded, still contesting, all-in, able to act, opponents contesting, opponents still to act this street, whether it is a heads-up table, and the pot type.

Every action is an `ActionEvent` with a unique id (`handId:seq`), the amount added, the street commitment after it, the pot before it, the amount faced and whether it was voluntary.

## State reconstruction

Described in full in [TRACKING.md](TRACKING.md). In short: the tracker holds one engine hand and explains each observation as legal actions, each tagged with its evidence (chips shown, fold shown, action passed with an unchanged stack, stack change across a street). The seat the page shows acting (observed actor) and the seat the engine expects (predicted actor) are kept apart and compared on every read. Deductions are marked, wait for a settled table, and are withdrawn if they contradict the page. No call is ever assumed. Contradictions become blockers that suspend decisions and state the reason; the hand becomes invalid only when the rules cannot explain an observation at all. A hand with an inferred ending, an unconfirmed deduction or an unexplained stack is stored for review but never applied to profiles.

## Manifest V3 lifecycle

- **All poker computation runs in the content script**, in batches of 150 to 250 Monte Carlo deals with a `MessageChannel` yield between batches, so the page stays responsive and nothing depends on the service worker being alive. No Web Worker is used: a content script cannot start a worker from an extension URL without workarounds, and measured decisions take a few milliseconds (see the benchmark report), so there was nothing to gain.
- **The service worker holds no state.** Each message opens IndexedDB, writes in one transaction and returns. It can be stopped and restarted at any moment.
- **Settings travel through `chrome.storage.local`**; the content script, popup and dashboard all listen to `storage.onChanged`. The emergency stop therefore reaches the page without any message routing, and it also disarms locally and synchronously when pressed in the in-page panel.
- **Live state for the dashboard** goes content script → service worker → `chrome.storage.session`.
- No WebAssembly: the JavaScript evaluator measured at several million seven-card hands per second, which is not the bottleneck.

## Executor guarantees

Before the one click (`adapter/executor.ts`), in order: armed; no other execution in flight (calls are serialised); this decision point (hand, street, event count) not used before; state valid and confident; same hand, same street, no new events since the decision; Hero's turn according to both the engine and the table; action legal in the engine and the amount inside the legal window; the matching control present and agreeing with the engine (call amount, bet bounds). The decision point is marked used before clicking, so an unknown outcome can never produce a second click. A bet is typed, read back from the input, and submitted only if the read-back matches. Afterwards the table is polled until the action shows up; the result is `accepted`, `unverified`, `rejected` or `failed`, and is logged.

If a bet cannot be entered and nothing was submitted, the controller falls back once to check, or to call when the call's EV was positive, otherwise fold. If Hero must act while the state is not trusted and the clock is nearly out, the configurable timeout action is check-or-fold (never a call or raise).

## Security

- Permissions: `storage` only. Content script limited to `pokernow.club/games/*` and `pokernow.com/games/*`. No host permissions, no `tabs`, no remote code, no `eval`; extension pages have `connect-src 'none'`.
- Messages to the service worker are accepted only from this extension, only from PokerNow tabs when they come from a content script, and are structurally validated (`parseBotMessage`).
- Settings and stored profiles are sanitised on every read.
- Player names and all page text are written with `textContent`, never as HTML.
- It reads only what the page renders for the logged-in player. It does not read the site's network traffic or websocket, does not look for hidden cards, and does not work around any site control.
- Data stays in the extension's own IndexedDB and `chrome.storage`. Nothing is sent anywhere. Passwords and tokens are never read.

## Tests

`tests/bot/` (run with `npm run test:bot`):

| File | Covers |
|---|---|
| `engine.test.ts` | positions 2 to 10, heads-up rules, counts for scenarios A to E, min-raise, short all-in, antes, straddle, side pots, split pots, variant rejection, chip-conservation fuzz at every size |
| `equity-profile.test.ts` | card parsing, seven-card ranking, equity benchmarks, side-pot payouts, range model, profile opportunities, dedupe, shrinkage, classification, corrupted storage |
| `strategy-sim.test.ts` | preflop across sizes, chart selection, short and deep stacks, computed all-in calls, exploit gating, postflop EV, multiway vs heads-up, time budget, anytime decide and cancel, simulator sessions, tournaments, duplicate rotation, profiling vs ground truth |
| `adapter.test.ts` | reconstruction of simulated hands from observations at 2, 3, 6, 9, 10 players, repeated and missing observations, mid-hand join, seat changes, Omaha rejection, executor guards, DOM adapter on fixture markup, PokerNow log parsing and replay |
| `ext.test.ts` | settings and message validation, IndexedDB storage, the live controller playing a simulated table in each mode |
