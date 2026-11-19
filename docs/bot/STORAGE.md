# Local data storage

Everything is stored in the browser profile, in the extension's own origin. Nothing is uploaded. Types are in `src/bot/ext/records.ts` and `src/bot/opponents/profile.ts`; the database code is `src/bot/ext/storage.ts`.

## IndexedDB database `poker-bot`, version 3

| Store | Key | Indexes | Value | Cap |
|---|---|---|---|---|
| `profiles` | `playerId` | none | `PlayerProfile` | none |
| `hands` | `handId` | `ts`, `tableId` (v3) | `HandRecord` | 5,000 (oldest pruned) |
| `decisions` | auto-increment | `handId`, `ts`, `tableId` (v3) | `DecisionRecord` | 20,000 |
| `diagnostics` | auto-increment | `ts`, `tableId` (v3) | `DiagnosticRecord` | 2,000 |
| `frames` (v2) | auto-increment | `ts` (wall clock), `handKey`, `tableId` (v3, on `obs.tableId`), `session` (v3) | `DebugFrame` (`src/bot/diag/recorder.ts`) | 6,000 (oldest pruned and counted) |
| `meta` (v2) | `key` | none | `framesPruned`; one tombstone per deleted profile | none |
| `tables` (v3) | `tableId` | none | `{ tableId, nickname, firstSeen, lastSeen }` | none |
| `sessions` (v3) | `session` | none | `{ session, tableId, firstWall, lastWall }`: one visit to a table with recording on | none |

**Upgrades only add.** Version 2 added `frames` and `meta`. Version 3 adds the indexes and the two registry stores and fills the registries from the rows already stored. No stored row is rewritten or removed by an upgrade (`tests/bot/storage-v3.test.ts` builds a version 2 database and checks every row afterwards).

`frames` holds the diagnostic recording described in [TRACKING.md](TRACKING.md): what the table showed and what the reconstruction made of it. It contains player names and the table id, never cookies, tokens or hidden cards.

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

`{ ts, level: info|warn|error, source, message, data?, tableId? }` (`tableId` from 0.7.0; older lines have none)

## `chrome.storage.local`

`settings`: `Settings` (sanitised on every read).

```
mode: manual | recommend | autonomous        default recommend
estop: boolean
authorizationConfirmed: boolean, authorizedTables: [tableId]
exploitWeight (0..1), minThinkMs, maxThinkMs, assumedClockMs, minConfidence
showPanel, timeoutAction: check-fold | nothing
selectorOverrides: { selectorName: cssSelector }
recordDiagnostics: boolean
strategyEngine: v2 | v1 | v3                 default v2. v3 (0.9.0) is experimental and recommendation-only:
                                             mayAct() is false while it is selected, whatever mode and authorisation.
                                             An unknown or missing value reads as v2 (no silent switch).
shadowV3: boolean                            default false. Diagnostic only: with v2 selected, also compute version 3's
                                             recommendation after version 2's and show both; never executed, never
                                             stored as a decision.
```

`profilesDeleted`: `{ ids, at }`, written when profiles are deleted so that open table tabs drop their copies.

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

## Deleting

Two different things can be removed, and the dashboard keeps them apart everywhere:

- **Authorisation**: the permission for automatic play on a table. It is a setting (`settings.authorizedTables`). Revoking it deletes nothing that was recorded.
- **History**: what was recorded: hands, recommendations, frames, log lines. It lives in the database above. Deleting it does not revoke anything.

| Action | Where | Removes | Does not touch |
|---|---|---|---|
| Delete hand(s) | Hand review | the hand, its recommendations, its recorded frames | profiles, other hands |
| Delete recording only | Hand review, one hand | that hand's frames | the hand summary, recommendations, profiles |
| Delete recording session(s) | Diagnostics | the frames of one visit to a table | hand summaries, recommendations, profiles |
| Delete log line(s) / the whole log | Diagnostics | log lines | everything else |
| Revoke authorisation | Tables, popup | the table's entry in `authorizedTables` | all history |
| Delete history of table(s) | Tables | every hand, recommendation, frame, log line and session of those tables | authorisations; profiles (unless you tick the box) |
| Remove all inactive tables | Tables | both of the above for every table except the open one | the open table; profiles (unless ticked) |
| Delete profile(s) | Opponents | the profile | hands and recordings |
| Delete all local data | Settings, Advanced | every store above | settings and authorisations |

Rules that hold for every deletion (`src/bot/ext/storage.ts`, tested in `tests/bot/storage-v3.test.ts` and in the browser by `npm run bot:e2e:dashboard`):

- **One transaction.** A hand never loses its recommendations or frames half way.
- **The open table is never included in a bulk action.** The storage call takes the open table as `protect` and skips it even if it is in the list.
- **Profiles keep what deleted hands contributed.** A profile is a running total, not a view over stored hands; deleting hands does not recompute it and its numbers keep their meaning ("hands observed"). Profiles are removed only when you delete them, or tick "also delete the profiles of players whose every stored hand is at these tables" in the table dialog.
- **A deleted profile does not come back.** An open table tab still holds the old totals in memory. Deleting writes a tombstone; a profile whose `firstSeen` is not later than the tombstone is not written back, and the tab is told to drop its copy, so the player restarts from nothing.
- **Revoked authorisations do not come back.** Settings are changed by reading the stored value first (`patchSettings`), so a popup or dashboard page that was opened earlier cannot write an old table list back.
- **Recording continues.** After a table's history is deleted, new hands at that table are stored and counted from zero.
- **Optional export first.** The table dialog can save everything it is about to delete to a file (`poker-bot-table-export`, version 1).

A hand that never completed (the tab was closed mid-hand) leaves recommendations and frames with no hand summary. They are removed when the table's history is deleted, and by the caps.

### Result check on a stored hand

`HandRecord.stackCheck` (0.7.0 on) holds the comparison of the settled stacks with the stacks the next hand started with: `{ status, heroDiff, note }`, status one of `confirmed`, `top-up`, `awarded-differently`, `unexplained`, `unavailable`. `heroNet` is always the result settled from the cards shown; when the status is `awarded-differently` (for example a board run twice) the table's result is `heroNet + heroDiff`, and that is what Hand review shows and sums. See [LONG_SESSION_DIAGNOSTIC_AUDIT.md](LONG_SESSION_DIAGNOSTIC_AUDIT.md).

## Export and deletion

Dashboard, Settings: **Export all local data (JSON)** and, under Advanced, **Delete all local data** (typed confirmation).

Dashboard, Diagnostics: **Export Debug Bundle** (recent hands' frames, with an option to replace names and the table id by placeholders, and a review box) and **Delete recorded frames**. Recording can be switched off there (`settings.recordDiagnostics`).
