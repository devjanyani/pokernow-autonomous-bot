# Local data storage

Everything is stored in the browser profile, in the extension's own origin. Nothing is uploaded. Types are in `src/bot/ext/records.ts` and `src/bot/opponents/profile.ts`; the database code is `src/bot/ext/storage.ts`.

## IndexedDB database `poker-bot`, version 2

| Store | Key | Indexes | Value | Cap |
|---|---|---|---|---|
| `profiles` | `playerId` | none | `PlayerProfile` | none |
| `hands` | `handId` | `ts` | `HandRecord` | 5,000 (oldest pruned) |
| `decisions` | auto-increment | `handId`, `ts` | `DecisionRecord` | 20,000 |
| `diagnostics` | auto-increment | `ts` | `DiagnosticRecord` | 2,000 |
| `frames` (v2) | auto-increment | `ts` (wall clock), `handKey` | `DebugFrame` (`src/bot/diag/recorder.ts`) | 6,000 (oldest pruned and counted) |
| `meta` (v2) | `key` | none | counters, currently `framesPruned` | none |

Version 2 only adds stores; existing data is kept. `frames` holds the diagnostic recording described in [TRACKING.md](TRACKING.md): what the table showed and what the reconstruction made of it. It contains player names and Hero's own cards, no credentials and no hidden cards.

A completed hand and the profiles it changed are written in **one transaction**, and only if the hand id is not already stored. A repeated message therefore cannot double-count.

### `PlayerProfile`

```
version: 1
playerId, name, hands, firstSeen, lastSeen
stats: { [statKey]: { n, d } }      n = times done, d = real opportunities
betSizes: [4]                        postflop bets by size bucket (<40%, 40-70%, 70-110%, >110% pot)
shownStrengthSum: [4], shownStrengthN: [4]   strength of bets later shown down, by bucket
showdowns: [{ handId, cards, line }]         last 20
appliedHands: [handId]                       last 400, for dedupe
```

Stat keys: `vpip pfr rfi limp threeBet coldCall foldTo3Bet fourBet cbetFlop cbetTurn foldToCbetFlop foldToCbetTurn checkRaise aggFreq aggVsCall wtsd wsd`, `foldVsBet{Flop,Turn,River}`, `callVsBet{Flop,Turn,River}`, `raiseVsBet{Flop,Turn,River}`, `betWhenCheckedTo{Flop,Turn,River}`, `foldVsBetHeadsUp foldVsBetMultiway`, `vpip{Early,Late,Blinds}`, `rfi{Early,Late,Blinds}`.

Profiles are repaired on every read (`sanitizeProfile`): missing keys added, `n` clamped to `d`, bad numbers zeroed.

**Player identity.** If the page supplies a stable player id it is the key. The current DOM adapter does not find one, so in practice the key is `name:<tableId>:<display name>`: the same name at another table is a separate profile. Two seats with the same name at one table get throw-away `ambiguous:` ids that are never stored. A player who changes display name becomes a new profile. Profiles imported from a PokerNow log are keyed by the log's player id and therefore do not merge with live, name-keyed profiles.

### `HandRecord`

```
handId, tableId, ts, smallBlind, bigBlind, ante, board: ["Ah", ...]
seats: [{ seat, name, playerId, position, startStack, endStack, folded, dealtIn, shown }]
events: [{ seq, seat, street, kind, amount, to, allIn, potBefore }]
heroSeat, heroCards, heroNet, wentToShowdown
valid            reconstruction was consistent and the ending was observed
observedToEnd    false when the next hand began before the last action was seen
```

Hands with `valid: false` are kept for review and never applied to profiles.

### `DecisionRecord`

```
handId, tableId, ts, eventCount        eventCount = index of Hero's action in the hand's events
heroCards, board, pot
decision: Decision                      action, candidates (EV, SE, frequency), equity, ranges,
                                        basis, adjustments, uncertainty, counts, mode, samples, computeMs
execution: { status, reason, ms } | null     null = shown only
```

### `DiagnosticRecord`

`{ ts, level: info|warn|error, source, message, data? }`

## `chrome.storage.local`

`settings`: `Settings` (sanitised on every read).

```
mode: manual | recommend | autonomous        default recommend
estop: boolean
authorizationConfirmed: boolean, authorizedTables: [tableId]
exploitWeight (0..1), minThinkMs, maxThinkMs, assumedClockMs, minConfidence
showPanel, timeoutAction: check-fold | nothing
selectorOverrides: { selectorName: cssSelector }
```

## `chrome.storage.session`

`live`: the latest `LiveState` snapshot for the dashboard. Cleared when the browser closes.

## Bundled strategy data

Compiled into `content-script.js` at build time; nothing is fetched at run time.

| Data | Source file |
|---|---|
| Seven-card evaluator tables | `src/core/equity/eval-tables.ts` |
| Hand-strength ordering | `src/core/ranges/preflop-strength.ts` |
| 6-max charts | `src/core/ranges/greenline-gto.ts`, `pekarstas-gto.ts` |
| Heads-up charts | `src/core/ranges/preflop-charts.ts` |
| Push/fold Nash | `src/core/ranges/pushfold-nash.ts` |

The charts are plain TypeScript objects under version control, so every range can be read and diffed.

## Export and deletion

Dashboard, Settings: **Export all local data (JSON)** and **Delete all profiles, hands and logs** (this also deletes recorded frames).

Dashboard, Diagnostics: **Export Debug Bundle** (recent hands' frames, with an option to replace names and the table id by placeholders, and a review box) and **Delete recorded frames**. Recording can be switched off there (`settings.recordDiagnostics`).
