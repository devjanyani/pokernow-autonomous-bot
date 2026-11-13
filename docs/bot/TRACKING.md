# Game-state reconstruction, turn tracking and diagnostics

Version 0.5.1. Code: `src/bot/adapter/tracker.ts`, `src/bot/ext/controller.ts`, `src/bot/diag/`. Tests: `tests/bot/tracking.test.ts`.

**Status.** 0.5.0 reconstructs one real recording (5 hands) exactly, with no blocker, no warning and no deduced action, and is otherwise tested on synthetic tables. One recording is not a soak: section 0 lists what it did not contain.

## 0. What the first real recording showed (2026-11-13, v0.5.0)

A debug bundle from a recommendation-only session on a no-money PokerNow table (5 hands, 118 frames, extension 0.4.0) was replayed. It is kept, with names and the table id replaced, as `tests/bot/fixtures/live-2026-11-13.json`. Facts read directly from the recorded observations:

| Recorded fact | Consequence |
|---|---|
| PokerNow marks folds with the class `fold` and removes the seat's cards. Every fold in the recording is displayed. | The 0.4.0 hypothesis "the fold class is not recognised" was **wrong for the live site**. The selector works. |
| The acting-seat highlight (`decision-current`) stays on the seat that has just acted for 0.2 to 0.9 s after its chips or fold are drawn, then moves. | 0.4.0 read "highlight is not on the engine's next seat" as "the action passed that seat" and deduced folds for everyone still to act. The hand was declared complete while it was still being played (hands 2, 3, 4, 5). |
| A sitting-out player is drawn with `fold` (and `offline`), no cards and no chips from the first frame of the hand. | 0.3.0 and 0.4.0 counted that seat as dealt in. In hand 3 it was given the big blind, Hero's real big blind was read as a call, and the round was closed when the small blind completed: "table says it is Hero's turn, engine expects no further action", engine pot 12 against 10 on the table, a stack off by exactly one big blind. |
| When the small-blind seat sits out, only a big blind is posted (hand 5: pot 2 at the start, the first dealt seat left of the button has 2 in front). | Dead small blind was not modelled; the engine posted a small blind that did not exist. |
| The pot shown is all chips including current bets (`total N`). | Engine pot and table pot can be compared exactly; after the fix they are equal in every frame of the recording where someone is to act. |
| Seat numbers are relative to the viewer (Hero is seat 1 once seated). | Stable within a session; nothing to change. |
| Hero's turn was shown in six frames: n=57 to 60 (hand 3, big-blind option with QcQd), n=86 (hand 4, small blind facing a raise, 7 to call), n=106 (hand 5, button facing 12). None produced a recommendation live. In hands 4 and 5 the next frame, 80 to 90 ms later, shows Hero folded. | All six now reconstruct with table and engine agreeing and the buttons matching. An 80 ms turn is too short to read a recommendation whatever the software does; that looks like a pre-selected fold (inference, not recorded). |

Fixes in 0.5.0, each covered by a test that failed on 0.4.0 against this recording:

1. **Dealt in means cards or chips.** A seat with neither at the first frame is not in the hand, whatever its classes say.
2. **A lagging highlight is not evidence.** A highlight (or Hero's buttons) on a seat that has nothing to decide is treated as "not moved yet" for up to 1.5 s and only then as a disagreement. Deductions are also withdrawn if they would end the hand while the page still shows someone acting.
3. **Blinds are read from the chips.** The standard layout or a dead small blind is chosen by which one the visible chips and pot support (`noSmallBlind` in the rules engine).

### Second recording (2026-11-13, v0.5.1)

A second bundle (5 hands, 211 frames, nine or ten handed, blinds 2/5, extension 0.5.0) showed 0.5.0 tracking every hand correctly, and one new failure:

| Recorded fact | Consequence |
|---|---|
| With nothing to call, PokerNow shows `[Bet 5] [Bet] [Check] [Fold]`. The "Bet 5" button's class list is `button-1 action-button call with-tip call green`, identical to the Call button's. With a bet to face it shows `[Call 5] [Raise] [Fold]`. Preflop in the big blind it shows `[Raise] [Check] [Fold]`. | The adapter found "the call button" by class and read the number at the end of its text, so "Bet 5" became "Call 5". On the flop, turn and river of one hand (frames 213 to 226) Hero's free check was blocked: "call button shows 5, engine computes 0". |
| The bet form, when opened, has `default-bet-button` helpers: Min Raise, 1/2 Pot, 3/4 Pot, Pot, All In, and a Back button. | Classified as size helpers, not actions. |
| One hand opens with 2 chips already in the middle (pot shown as "2 total 9" with blinds of 2 and 5) and the button's stack 2 lower than before. | Dead money is not modelled: the engine pot is 2 lower than the table for that hand. It is reported as a warning and decisions continue. Not fixed. |
| An all-in player's stack is not a number on the page. | Read as "unknown" and skipped in stack checks; the all-in itself was reconstructed from the chips in front. |

Fix in 0.5.1: buttons are classified by label text only (`pokernow/controls.ts`). "Bet N" is a wager Hero may make (a size shortcut), "Call N" is an outstanding amount; a class name or a single keyboard letter never decides the action. The same classification drives clicking, so "call" can only ever press a button that says Call. With the recorded button texts re-classified, the recording has no blocker on any settled frame and every Hero turn is usable.

Not in the recording, so still unverified: antes, straddles, a dead big blind, run-it-twice, all-in run-outs with side pots, Hero's own bet entry, and tables with fewer than six dealt in.

## 1. Root-cause analysis (as written for 0.4.0, before any real recording)

> Section 0 supersedes this where they differ. Defect 1 below was not the cause on the live site; defects 2 to 4 were real code defects and their fixes stand.

The reports were: PokerNow shows "YOUR TURN" but the bot believes another seat must act and shows nothing; pot off by 1 or 2 chips (19 vs 18, 258 vs 256); a stack off by 2 (98 vs 100); "valid" hands with confidence 0.70 or 0.85.

Four defects were found in the code. Together they produce exactly those symptoms.

| # | Defect in v0.3.0 | What it causes |
|---|---|---|
| 1 | **A fold was recognised only from one CSS class** (`fold` / `folded`), which has never been checked on the live site. When the class did not match, a seat that folded while facing a bet looked like a seat that had not acted. | The engine waited on that seat. When Hero's turn came, the table said Hero and the engine said the folded seat: "table says it is Hero's turn, engine expects seat 4". No recommendation. After 4 seconds the hand was marked invalid for good. |
| 2 | **When the next street appeared and a seat's action was still unknown, the tracker assumed a call** ("call inferred across a street change"). | A player who had folded was charged a call that never happened. The engine pot ran exactly one call too high (1 chip for a small blind completing, 2 for a limp at 1/2) and that player's stack exactly one call too low. This matches 19 vs 18, 258 vs 256 and 98 vs 100. |
| 3 | **Chip contradictions were scored as soft noise.** A stack or pot mismatch only subtracted 0.15 from one confidence number, so a hand with invented chips stayed "valid" at 0.85 or 0.70. | The state looked trustworthy when it was not, and nothing said what was wrong. |
| 4 | **The last recommendation stayed on screen** after Hero's turn ended, until the hand finished. When Hero's turn was shown but not trusted, the panel showed nothing new. | A stale recommendation could be read as current, and a blocked decision looked like a blank panel. |

Also found: a seat marked offline or away was treated as sitting out even when it held cards and a blind, which shifts every position; a player who disappeared from the page was folded immediately; the new hand could start from a snapshot that still showed the previous hand's button.

What could not be determined from code: which class names PokerNow really uses for folded, away and acting seats; whether a folded player's chips stay in front of the seat; how the pot is displayed mid-street; how blinds are posted when a player leaves between hands. The debug bundle records the raw class list of every seat and the text of every action button so these can be read off the next real session.

## 2. What changed

1. **Folds no longer depend on a marker.** A seat that faced a bet, added no chips, kept the same stack, and that the action has moved past, has folded. That is the only action in the rules that costs nothing when facing a bet. The fold is applied, marked as deduced, and shown as such in the timeline.
2. **No call is ever assumed.** Across a street change a call is accepted only when the stack fell by exactly the call amount, a fold only when the stack did not move. Anything else invalidates the hand with the numbers in the message.
3. **Observed actor and predicted actor are separate** and compared on every read (section 3).
4. **Contradictions block decisions and say why** (section 5) instead of lowering a score.
5. **A recommendation belongs to one decision point** and is dropped the moment that point changes (section 6).
6. **Dealt-in is decided by cards and chips**, not by an away marker. A vanished player keeps its last known state.
7. **A hand does not start** until the blinds are where the button says they should be (waits up to 1.2 s, phase `initialising`).
8. **Free-check rule in one place**: `BotAgent.finish` never returns a fold when a check is legal, for every street and position. The legality gate that was already there rejects anything the rules engine does not allow.
9. **Local recorder, debug bundle and replay** (section 7).

## 3. Turn-tracking architecture

```
page ──observe()──> TableObs ──ingest()──> HandTracker ──state──> LiveController ──> panel / dashboard
                                              │                        │
                                              │                        └─> FrameRecorder ──> IndexedDB "frames"
                                              └─ rules engine (table/engine.ts): one HandState per hand
```

- **Observed actor**: what the page shows. The highlighted seat, or Hero when the turn signal and action buttons are present. If the two page indicators point at different seats, the observed actor is "unknown" rather than either of them.
- **Predicted actor**: `hand.toAct` in the rules engine after the reconstructed history.

`TrackerState.turnStatus` is `agree`, `disagree`, `unobserved` (the page shows nobody; the engine's view is unverified) or `none`.

Each observation is explained as a sequence of legal actions. Every action records its evidence in `EventMeta.source`:

| Source | Evidence | Deduced? |
|---|---|---|
| `forced-post` | blinds and antes placed by the rules from the button; checked against the chips shown at hand start | no |
| `bet-display` | the seat's chips in front grew | no |
| `fold-display` | the seat is drawn as folded | no |
| `cards-removed` | the seat's cards disappeared while someone is still acting | no |
| `turn-passed` (check) | the action moved past the seat, checking was free, stack unchanged | no |
| `turn-passed` (fold) | a seat that still has a decision to make is highlighted beyond this one, this one faced a bet, added no chips, its stack is unchanged, the table is settled. Not needed in the real recording (PokerNow displays folds); kept for missed frames | **yes** |
| `stack-change` | next street is out and the stack fell by exactly the call | **yes** |
| `street-advanced` | next street is out and the stack is unchanged (fold), or checking was free (check) | fold: **yes** |
| `showdown-evidence` | opponents' cards are face up on the river | **yes** |
| `hand-ended` | the next hand began before the last action was seen | **yes, unconfirmed** |

Because actions come from the difference between the engine and the table, reading the same table again adds nothing, and several actions between two reads are replayed in order.

**Highlight lag.** On PokerNow the highlight stays on the seat that just acted for 0.2 to 0.9 s. The tracker therefore asks whether the highlighted seat still has something to decide in the reconstructed hand. If not, the highlight is "lagging": it is no evidence about other seats, `turnStatus` is `unobserved`, and only after 1.5 s does it become a disagreement.

**Settling.** An observation counts as settled when nothing relevant changed for 120 ms (two consecutive reads). Deduced folds and all mismatch findings wait for a settled table, so a half-drawn update is not mistaken for a fact. The cost is at most one poll interval.

## 4. Player participation model

`TrackerState.participation` has one entry per seat with independent fields:

| Field | Meaning |
|---|---|
| `present` / `left` | drawn at the table now / was in this hand's seat map but is no longer drawn |
| `disconnected` | marked offline or away by the page |
| `sittingOut` | marked sitting out and not dealt in |
| `dealtIn` | had cards or chips in front when the hand started |
| `waitingForNextHand` | seated, not sitting out, not dealt in (includes anyone who sat down mid-hand) |
| `folded`, `allIn` | from the reconstructed action |
| `eligibleForPot` | dealt in and not folded (all-in players included) |
| `canAct` | dealt in, not folded, not all-in |
| `position`, `stack`, `streetCommit`, `totalCommit` | from the engine |

Rules: the seat map and positions are fixed when the hand starts, from the button and the seats dealt in, never from seat numbers. Someone who sits down mid-hand is never added to the hand. Someone who disappears is not assumed folded; when the action later passes that seat, the one zero-chip action is applied and marked **unconfirmed**, and the hand is kept out of opponent profiles. A table that started with ten players and is down to two is still a ten-handed table with a heads-up pot (`counts.headsUpTable` is true only when two players were dealt in).

## 5. State reconciliation

After explaining an observation the tracker cross-checks it. Findings are either **blockers** (no recommendation until resolved) or **warnings**.

| Check | Level |
|---|---|
| Observed actor differs from predicted actor | blocker |
| Hero's turn shown but Hero is not in the reconstructed hand | blocker |
| Call button amount differs from the engine's call; check button present or absent against the engine | blocker |
| A live player's stack differs from the engine's | blocker |
| The engine has more chips in front of a seat than the table shows (a blind or action attributed to the wrong seat) | blocker |
| Chips left a stack with no bet shown, for more than 4 s | blocker |
| Hero's cards changed mid-hand | blocker |
| A folded player's stack differs | warning |
| Pot differs from both "all chips" and "chips from earlier streets" | warning |
| A seat shows more chips than the engine while the engine waits on an earlier seat | warning |
| A card or element could not be read | warning |

Deductions are provisional. If, after deducing folds, the engine's actor is not the observed actor, or Hero's call button shows a different amount than the engine computes, all deductions from that read are withdrawn and the confirmed state is kept, with a blocker that says so. Engine values are never overwritten to make a warning go away.

The pot check is a warning, not a blocker, because the pot is the sum of the same chips already checked seat by seat; a pot-only difference points to a display convention or dead money, and is recorded for the bundle.

**Six separate indicators** replace the single confidence number (dashboard, Live and Diagnostics tabs):

1. Observation health: were the required elements (seats, hero, button, blinds) read. A missing timer or game-type label is listed but does not block.
2. Game-state consistency: none / consistent / warnings / reconciliation required / invalid.
3. Turn: agree / disagree / not verified.
4. Legal actions: buttons match the engine / mismatch / not verified.
5. Decision readiness: ready, or the reason it is not.
6. Strategy uncertainty: the engine's own statement about EV separation.

`confidence` still exists for the click guard and is labelled as a heuristic score: 1 minus 0.15 per warning, 0.3 when blocked, 0 when invalid. It is not a probability.

## 6. Recommendation lifecycle

A recommendation is tied to `RecommendationContext`: hand id, street, state version (number of reconstructed events), Hero's seat, amount to call, whether a check is free, raise bounds, number of opponents. The key is `handId|street|version`.

- It is requested every time Hero's turn is shown by the table **and** predicted by the engine with no blocker. That includes a second or third turn on the same street: a raise behind Hero adds events, so the version and the key change.
- It is dropped as soon as Hero's turn ends, the key changes, or a blocker appears. `LiveState.decision` is non-null only for the current key.
- Statuses are explicit: "Hero all-in — no further betting decisions.", "Hero folded — waiting for next hand.", "Waiting for opponent.", "Decision unavailable — state reconciliation required." followed by the reason, plus statuses for waiting for a hand, hand starting, next card, showdown, hand complete, not dealt in.
- A suppressed recommendation writes one warning to the diagnostics log with both actors, the blockers and the buttons that were visible.

## 7. Diagnostic recorder, debug bundle, replay

**Recording.** On by default (Diagnostics tab, "Record while a table is open"). One frame per meaningful change: the normalised observation (seats, names, stacks, bets, fold and away flags, raw seat class list, board, Hero's cards, pot, button, blinds, highlighted seat, action buttons and their text, clock), the tracker's view (hand id, street, observed and predicted actor, button and blind seats, participation, legal actions, blockers, warnings), the actions added by that read with their evidence, and the recommendation state or the reason it was withheld. Unchanged reads are not recorded.

Frames hold only what the player can see. No cookies, tokens, passwords, network data or opponent hole cards (other than cards shown at showdown). They are stored in the extension's IndexedDB (`frames`, capped at 6,000, oldest pruned and counted) and leave the browser only through the export button.

**Export.** Dashboard, Diagnostics, **Debug bundle**: choose most recent hand, last 5, last 20 or everything; optionally replace player names and the table id with placeholders; **Review before export** shows the JSON in an editable box (whatever is in the box is what gets exported); **Export Debug Bundle** downloads `poker-bot-debug-<time>.json`. The bundle states the extension version, what was pruned or dropped, and which hands do not start at their first observation.

**Replay.**

```bash
npm run bot:replay -- path/to/poker-bot-debug-....json            # timeline per hand, first divergence
npm run bot:replay -- bundle.json --hand 3 --frames               # every frame of the third hand
npm run bot:replay -- bundle.json --json result.json              # machine-readable result
```

The replay feeds the recorded observations through the same `HandTracker` and prints, per hand, the action timeline with deduced entries marked, the first frame where table and reconstruction disagreed, how many Hero-turn frames were usable, and any frame that replays differently from what was recorded live (which shows the effect of a code change on a real recording). It ends with the seat class lists and button texts seen, which is what is needed to correct selectors.

**Timeline.** Diagnostics tab, "Action timeline (current hand)": actions by street as `CO: Raise to 8`, deduced entries marked with their reason, then "Next:" with the predicted actor and whether the table confirms it. The Turn tracking card shows observed actor, predicted actor, whether they agree, the last confirmed action and open blockers.

## 8. Next live test (recommendation-only)

1. `npm run build`, then in `chrome://extensions` press the reload arrow on the extension (or Load unpacked → `dist/`). The version should read 0.5.1. Reload the PokerNow tab.
2. Popup: mode **Recommend**. Leave authorisation off. Nothing is clicked in this mode.
3. Open the dashboard, Diagnostics tab, and confirm "Record while a table is open" is ticked.
4. Play 20 to 30 hands of a no-money game, including hands where you limp, are raised behind and act again, and hands in each blind.
5. Watch the in-page panel. The **Turn** row shows `SB ✓` when table and engine agree and `table X ≠ engine Y` when they do not.
6. **If the bot believes the wrong player is acting, or shows "Decision unavailable":** do not reload the page. Note the wall-clock time and what PokerNow showed. Finish the hand. Then dashboard → Diagnostics → Debug bundle → "Last 5 hands" → Export Debug Bundle. If you plan to share it, tick the placeholder option first or use Review before export.
7. Also download PokerNow's own log for the session (the game's log → download). It is the independent record to compare against.
8. Put both files where the next session can read them, for example `diagnostics/` in the repository folder (git-ignored), and run `npm run bot:replay -- <bundle> --frames`.

What the first real bundle will settle: the real class names (fold, away, acting seat), whether bets stay in front of folded seats, how the pot is displayed, how the button and blinds are drawn at hand start, and whether deduced folds agree with PokerNow's log.

## 9. Known limits of this work

- Not verified on the live site. Synthetic fixtures show the logic is right for the situations they model, not that PokerNow presents those situations the way the fixtures assume.
- The fold deduction relies on bets and stacks being read correctly. If stacks are displayed with a convention the adapter does not expect, deduced folds will be withheld and the reason shown.
- A check is still deduced from "the action moved on, no chips, stack unchanged"; a fold with a free check looks the same unless the fold is displayed.
- A dead small blind is handled (0.5.0). A dead big blind, missed-blind posts and straddles are not modelled. The new blind check turns these from silent errors into a visible blocker for that hand; it does not make them playable.
- Two raises by the same players between two reads cannot be told from one; this is detected ("intermediate raises were missed") and invalidates the hand.
- When a hand is blocked or invalid there is no recommendation for it. That is deliberate.
- Chip amounts are compared with a tolerance of 0.011 (tables with cent chips); arithmetic is floating point rounded to cents on read, not integer.
- The recorder samples at the poll rate (250 ms plus page-change triggers). Page states shorter than that are not in the bundle.
