# Live session forensic audit: debug bundle of 2026-11-21

Recording: `debug_bundles/poker-bot-debug-2026-11-21T20-16-26-506Z.json`. It is git-ignored, stays private and is not
committed. It was exported by extension **0.9.1** in autonomous mode, with strategy v3 selected and shadow v3 off.

Anonymisation:

- Tables are T1–T8, in order of first appearance.
- Players are "Hero" or a seat number. No player names, table ids or raw hand histories appear in this report.
- Frame numbers are the recorder's per-session sequence numbers (`n`).
- A decision is identified by its context key `T8:h:<hand>|<street>|<state version>`. Version = number of events
  before Hero's action.

Scope: diagnosis only. No strategy, execution, permission or timing code was changed for this audit.

- **Branch state.** The brief says to resume from `c256433` "before Phase 3.1". The branch head is `1905518`, which
  already contains Phase 3.1 (0.9.2), committed on the previous instruction. Nothing was reverted.
- **Engine used for re-runs.** The recording is of 0.9.1 behaviour. The decision re-runs below use the current code.
  Its v2 decisions are unchanged from 0.9.1 (Phase 3.1 changed no production default).
- **Re-run agreement.** The re-run reproduced 123 of 125 live recommendations (§2). The other two had no live
  recommendation to compare with.

Tools:

- existing: `sim/bot/audit-bundle.ts`, `sim/bot/audit-hand.ts`, `src/bot/diag/rebuild.ts`;
- throwaway scratch scripts for the re-runs, the timing analysis and the frame-cadence analysis. These are not
  committed and only read the bundle.

Labels used throughout:

- **CONFIRMED** — a defect shown by the recording and the code.
- **STRATEGIC CONCERN** — a decision that follows the code as designed but is open to question.
- **UNVERIFIED** — a hypothesis the recording cannot settle.

---

## 1. Session and table summary

Contents: 6,000 frames, 209 recorded hands, 203 hand summaries, 124 stored decision records and 135 log lines. 2,270
older frames had been pruned from storage, 0 were dropped before storage, and there were 0 sequence gaps.

| Table | Date (UTC) | Minutes | Hands recorded / summaries | Attached as | Hero's role |
|---|---|---|---|---|---|
| T1 | 11-18 04:03 | 32 | 29 / 28 | (earlier recording, recommend) | played by the user, 0.25/0.5 blinds |
| T2, T3, T6 | 11-19 19:00 | <1 | 0–1 / 0 | recommend | page visits only |
| T5 | 11-19 19:02 | 7 | 9 / 8 | recommend | played by the user |
| T7 | 11-19 21:41 | 8 | 9 / 8 | recommend | played by the user |
| T4 | 11-19 22:48 | 143 | 101 / 101 | recommend | Hero not dealt in (observer) in 100 of 101 hands |
| **T8** | **11-21 18:30** | **106** | **59 / 58** | **autonomous** | **main autonomous table**, 1/2 blinds, no ante, 10 seats |

Only T8 was ever attached in autonomous mode (log line "attached to /games/… in autonomous mode" at 18:30:15). Every
other table was attached in recommend mode. Its decisions carry no execution record, so the user's own clicks were
the actions there. Records are kept per table and per session below. Only T8 is used for the autonomous findings.

At T8, Hero was dealt in at 55 of 58 hands. In hands 42–44 Hero was not dealt in (see §5.2). The number of players
dealt in ranged from 5 to 10: 5 (2 hands), 6 (6), 7 (7), 8 (15), 9 (18) and 10 (7). The user's notes call these hands
"ten-handed"; the table has 10 seats, but QJs (hand 25) was played 8-handed and KQo (hand 58) 10-handed.

## 2. Recording completeness and reconstruction reliability

**Hand summaries**

- Status at all tables: verified 177, ending not observed 21, invalid 5.
- Rebuilding with the current tracker gives exactly the same split.
- Recorded hands with frames but no summary (6): T1:h:101, T4:h:1, T6:h:1, T5:h:9, T7:h:9, T8:h:59. These are a hand
  cut off by the export and hands started before recording began.

**T8 in detail**

- 58 summaries: 56 valid, 2 not valid.
  - h:45 is invalid (a missed post, §5.2).
  - h:49 is "ending not observed".
- 3 valid hands have no Hero result because Hero was not dealt in (h:42–44).
- That leaves **53 valid hands with a Hero result**.
- Next-hand stack check: 40 confirmed, 13 top-ups, 3 "awarded differently" (h:2, h:4, h:26), 1 unavailable.
  - The three "awarded differently" hands were probably boards run twice between opponents.
  - Hero's chips were not involved in any of them: Hero folded preflop, net 0 or −1 bb.

**Decision reconstruction**

- Re-running the engine on every recorded Hero decision point (all tables) reproduced the live recommendation's
  action at **123 of 125** points that had one.
- The 2 others (T1:h:73, T1:h:90) have no live recommendation: Hero acted between two reads.
- Preflop reconstructions are therefore reliable. Opponent profiles are not in the bundle, so re-runs use neutral
  profiles; this did not change any preflop action here.

**Who acted: recommended versus executed (T8)**

| | Count |
|---|---|
| Hero actions in T8 summaries (excluding blind posts) | 73 |
| executed by the bot (stored decision, executor `accepted`) | **61** |
| not executed by the bot (no executor record) | **12** |
| executor `rejected` (duplicate request, §5.1) | 1 |
| safe fold on an untrusted state at the deadline (h:45) | 1 (logged; no decision record by design) |

The 12 actions the bot did not execute:

| Hand · version | Hero's cards | Live recommendation | What the table shows | Time from Hero's turn starting |
|---|---|---|---|---|
| h:1 · 2 | T3s | fold (execution not yet permitted; stored as a recommendation) | fold | 7.0 s |
| h:2 · 10 | K7o | fold | fold | 5.8 s |
| h:5 · 13 | 56s | **fold** | **call** to 22 | **1.3 s** |
| h:7 · 4 | J9o | fold | fold | 5.1 s |
| h:8 · 4 | 64o | fold | fold | 1.6 s |
| h:9 · 3 | 93o | fold | fold | 2.6 s |
| h:10 · 2 | J7s | fold | fold | 3.1 s |
| h:11 · 11 | T3o | fold | fold | 1.9 s |
| h:25 · 2 | QJs | **fold** | **call** 2 (limp) | 7.3 s |
| h:25 · 10 | QJs | **fold** | **call** 2 more | **3.7 s** |
| h:41 · 2 | A5o | fold | fold | **31.0 s** (§5.3) |
| h:58 · 4 | KQo | **fold** | **call** 2 (limp) | **3.4 s** |

How we know the bot did not make these actions:

- The executor always produces a decision record, whether accepted, rejected or failed. In autonomous mode the
  controller writes that record only after the executor returns (`src/bot/ext/controller.ts:406-431`). When the hand
  moves on while the bot is still waiting, the action is cancelled and **nothing is recorded**.
- Most of these actions came sooner than the bot could act. The scheduler never fires before the minimum delay, and
  the 61 executed actions had drawn delays of 4.23–19.90 s, consistent with the default 4–20 s.
- Four of the actions are calls the bot had recommended against.

**Conclusion (CONFIRMED):** 11 of the 12 were clicked by someone other than the bot, most likely the user. The
exception is h:41 (§5.3). The bundle cannot say who made them. Recording completeness:

- 11 of these actions (all but h:1) have **no decision record at all**, because cancelled recommendations are not
  stored;
- nothing in the log says "Hero acted while an action was pending";
- this is a diagnostic defect (D5 in §5).

**Legal actions:** in all 175 frames where it was Hero's turn on T8, the reconstructed legal actions either matched
the visible buttons (158) or there was no turn to check (17 post-action frames). Every bot bet and raise (10) was
inside the reconstructed legal range and confirmed on the table.

**Clock:** no T8 frame shows a visible countdown (0 of 2,152; raw timer text is always empty). Every scheduled
action therefore used the assumed 20 s clock, with the 3 s margin giving a 17 s latest safe moment. Whether PokerNow
displayed a timer the reader missed is **UNVERIFIED**. The page offers "Activate Extra Time (10s)", so a turn clock
exists.

## 3. QJs and KQo hand reconstructions

Every QJs and KQo hand in the bundle was searched by Hero's cards in the frames. Found: **QJs ×1** (T8:h:25),
**KQo ×2** (T8:h:58, T1:h:93), and QJo ×2 (T8:h:57, T5:h:6) as a near case.

### 3.1 T8:h:25, Q♦J♦: played, won 157 chips (+78.5 bb). Preflop played by hand against the bot's fold

Setup:

- 8 dealt in, 10 seats, blinds 1/2, no ante.
- Hero UTG with 69 chips, effective about 35 bb.
- Engine requested v3; v2 decided preflop.

| Point | Frames | Situation | Price | Recommendation (source) | What happened |
|---|---|---|---|---|---|
| `T8:h:25\|preflop\|2` | 860 thinking, 861 ready (fold) | unopened, 7 behind | call 2 into 3 | **fold** (heuristic: "UTG opens top 12.5% with 7 players behind") | 863: Hero **calls 2** at 7.3 s; no executor record |
| `T8:h:25\|preflop\|10` | 878 thinking, 879 ready (fold) | Hero limped; MP limp, HJ raise to 4, CO call, BB call | **call 2 into 17 (needs 10.5%)** | **fold** (heuristic: "vs HJ raise over limpers (est. 17%) + 2 callers: continue top 9%") | 881: Hero **calls 2** at 3.7 s (below the 4 s minimum); no executor record |
| `T8:h:25\|flop\|13` | 886–889 | Jh6s5s, BB bets 5 into 21, 4 opponents | call 5 into 26 | call, **v2** ("4 opponents: v3 heads-up only") | bot, accepted, 10.0 s |
| `T8:h:25\|turn\|18` | 898–901 | Qh, BB bets 10 | — | raise all-in 60, **v2** | bot, accepted, 10.1 s; won at showdown (top two pair against J6o) |

Verdict:

- **The user's observation is correct:** QJs was played, not folded, and won 157 chips.
- **But the bot would have folded it twice.** The two preflop calls were not the bot's actions.
- Fold 1 (UTG open) is a **STRATEGIC CONCERN**. QJs is outside UTG's heuristic top 12.5% because of how hands are
  ranked (§6.1).
- Fold 2 is a **CONFIRMED internal inconsistency**:
  - Against the engine's *own* opponent ranges (limp 37%, iso 17%, call 11%, BB 18%), QJs has **21.4%** equity
    (20,000 samples). The price needs 10.5%.
  - The heuristic never looks at the price (`src/bot/strategy/preflop.ts:309-315`).
- The +157 chips must not be credited to the bot's preflop strategy.

### 3.2 T8:h:58, K♦Q♠: limped by hand for 1 bb, then folded by the bot against a 9 bb increase

Setup: 10 dealt in, Hero UTG+2 with 224 chips (112 bb).

| Point | Frames | Situation | Price | Recommendation (source) | What happened |
|---|---|---|---|---|---|
| `T8:h:58\|preflop\|4` | 2082 thinking, 2083 ready (fold) | 1 limper (UTG+1), 7 behind | call 2 into 5 | **fold** (heuristic: "isolate top 7.5% over 1 limper"; KQo sits at 10.3–11.2%) | 2084: Hero **calls 2** at 3.4 s; no executor record |
| `T8:h:58\|preflop\|13` | 2099 ready (fold) | after LJ and HJ limps, CO raises to 20; SB and UTG+1 call | **call 18 into 68 (needs 20.9%)** | fold 34% / call 66% mix, sampled **fold** (heuristic) | bot, accepted (12.4 s target, 12.44 s actual) |

Verdict:

- **The user's observation is correct:** 1 bb went in, then Hero folded facing 18 more chips.
- The 1 bb limp was not the bot's action.
- The fold is **justified by the engine's own numbers**: equity against the five modelled ranges is 17.5%, below the
  20.9% needed. The heuristic's own mix gave the fold 34%.
- The questionable decision is the first one (fold KQo over one limper at a 10-handed table), a **STRATEGIC CONCERN**
  (§6.2).

### 3.3 Other KQo and QJo hands

- **T1:h:93, K♠Q♥.** MP, 8 dealt in, 101 bb, recommend mode. The bot recommended raise to 2.5 bb (`chart-approx`). The
  user raised to 4 bb by hand. This is the "another KQo hand was raised preflop" observation: correct, but a raise by
  the user, not the bot.
- **T8:h:57, Q♣J♦.** MP, 10 dealt in, 112 bb, facing 1 limper. Bot fold (heuristic iso top 8.7%), executed. QJo is
  outside most iso ranges from that seat; not a clear mistake.
- **T5:h:6, Q♦J♣.** SB vs an open, recommend mode. The bot recommended 3-bet to 10 bb, and the user played the same.

### 3.4 Answer: were the suspicious folds genuine mistakes?

| Fold | Cause | Classification |
|---|---|---|
| QJs UTG unopened, 35 bb (h:25 ·2) | equity-ordering heuristic ranks QJs at 16% (UTG opens 12.5%) | strategic concern: wrong hand selection, roughly right frequency |
| QJs after limping, 2 into 17 (h:25 ·10) | heuristic ignores price | **genuine mistake** by the engine's own ranges (21.4% equity vs 10.5% needed) |
| KQo over one limper, 112 bb (h:58 ·4) | iso threshold 0.6 × open = 7.5%, no limp-behind option outside late seats | strategic concern |
| KQo vs a 10 bb iso with 3 callers (h:58 ·13) | modelled equity 17.5% vs 20.9% needed | justified |

None of these folds came from a wrong position, missing betting history or a wrong pot. Position, betting sequence,
pot and price were reconstructed correctly at every QJs and KQo point.

## 4. Ten most questionable decisions (ranked by evidence × potential EV impact)

Every one of the ten was made by the bot on T8 unless marked. "Own-model equity" is Hero's equity against the
opponent ranges v2 itself built for that point (re-run, 20,000 samples).

1. **T8:h:35 `preflop|10`, QQ folds to a 91.5 bb re-jam plus an all-in caller.** Frames 1280–1300.
   - Executed, accepted. Call 147 into 286; needs 33.9%.
   - Own-model equity is 22.2%, because v2 models the re-jam as **the top 1.5% (floor): with Hero holding two queens, essentially AA and KK plus part of
     AKs**
     (`src/bot/ranges/preflop-model.ts:117`) and the caller at 4.6%.
   - Showdown: the jammer had JJ, the caller JTo.
   - **STRATEGIC CONCERN, highest impact** (pot 433 chips). The fold follows the model, but the model's re-jam range
     is narrower than any published equilibrium 4-bet-jam range at this depth.
   - This is a range-model problem (opponent jam widths), not a tracking problem.
2. **T8:h:5 `preflop|13`, 56s folds to a 1.8× 3-bet with nobody behind.** Frames 183–185.
   - Call 10 into 41; needs 19.6%. Own-model equity is **34.8%** against the modelled 11.8% 3-bet range.
   - Heuristic: "vs 3-bet without a chart". The price only *enables* a fixed calling band (top 14% from CO) and
     never widens it (`preflop.ts:337-343`).
   - **CONFIRMED internal inconsistency.** The user called by hand at 1.3 s; the flop was then a v3 fold.
3. **T8:h:25 `preflop|10`, QJs folds getting 8.5 : 1.** Frames 878–881; 21.4% vs 10.5%.
   - **CONFIRMED internal inconsistency** (§3.1).
   - Reachable only after Hero limps. The bot limps only by over-limping at a late seat; here it came from a manual
     limp.
4. **T8:h:46 `preflop|12`, 99 folds to a 39 bb squeeze-jam with two callers already in.**
   - Call 68 into 198; needs 25.6%. Own-model equity is 14.5%: the re-jam is modelled at 3.5%, the call-jam at 2.1%.
   - Showdown: the jammer had QTo; callers J5o and T7s.
   - **STRATEGIC CONCERN** (same cause as 1, pot 266).
   - Item 1 and this hand together are two showdowns with five shown ranges, all far wider than modelled. That is
     consistent with the jam bands being too tight for this pool, but it is two hands, not a measurement.
5. **T8:h:25 `preflop|2`, QJs UTG open-fold, 8 dealt in, 35 bb.**
   - **STRATEGIC CONCERN** (§6.1). Small EV per hand, but it recurs for a whole class of hands (suited broadways and
     suited aces at early seats at 7–10-handed tables).
6. **T8:h:58 `preflop|4`, KQo folds over one limper, 10 dealt in, 112 bb.**
   - **STRATEGIC CONCERN** (§6.2). Facing limpers was the most frequent preflop situation on T8 (20 of 60 decisions;
     16 folds).
7. **T8:h:38 `turn|16`, A♠Q♠ folds to a 65-chip all-in (pot 173) on K♦J♦9♠2♣.** v2, multiway.
   - Needs 27.3% with a player still to act behind (who called and showed 88). The jammer showed 76o.
   - **Defensible** (gutshot plus overcards, about 22% against the jam with a live player behind). Listed because it
     is the second-largest loss (−35 chips).
8. **T8:h:58 `preflop|13`, KQo folds to a 10 bb iso with callers.** **Justified** (17.5% vs 20.9%; §3.2).
9. **T8:h:34 `flop|10`, 92o checks in a limped pot.** The re-run picks "bet small" at 45%, a near-tie (EV 1.03 vs
   1.00): v2 mixes. **Not a defect.**
10. **T8:h:36 `flop|9`, K♣2♣: v3 bets large (11 into 11).** The re-run picks medium, from a mix of 5 sizes within
    1.0 chip of EV. **Not a defect.** It shows that v3 did act in heads-up pots (§7).

## 5. Verified tracking and execution defects

| Id | Defect | Severity | Wrong action executed? | Evidence (hand · frames · code) |
|---|---|---|---|---|
| **D1** | **Background-tab timer throttling delays the scheduler and the decision loop beyond the safe deadline** | **High** | No wrong action. One deadline overrun (h:5, raise sent at 24.65 s). One probable timeout fold (h:41, §5.3) | §5.3; `src/bot/ext/content.ts:216` (`setInterval(tick, 250)`), `src/bot/ext/scheduler.ts:159` (`waitUntilDue` sleeps in ≤250 ms steps) |
| **D2** | **Returning or new-player live posts are not modelled**: Hero's 2-chip post at CO after sitting out made the hand invalid | Medium | No (safe fold of J7s, cost the 2-chip post) | h:45 frames 1608–1619, "seat 1 (Hero) shows 2 in front, engine has 0"; `src/bot/table/engine.ts:21` has only `post-sb`, `post-bb`, `post-ante` and `post-straddle`; `tracker.ts:533` raises "intermediate raises were missed" |
| **D3** | **The controller decides and arms again for a decision point whose click is still in flight**, after one stale read showing Hero's turn again | Low (the safety held) | **No.** Executor rejected: "this decision point was already acted on" | h:17 frames 540–546; two records for `T8:h:17\|preflop\|6`; `controller.ts:338` (`if (!this.deciding) void this.decide(…)`), `src/bot/adapter/executor.ts:140` |
| **D4** | **Timing diagnostics attributed to the wrong attempt**: the accepted h:17 record shows `computeMs` 14,605 (from the second attempt); the rejected one shows 0 | Low (diagnostic) | No | `scheduler.ts:177-185` `fired()` reads `this.pending`, which the second `arm()` replaced |
| **D5** | **Cancelled recommendations and outside clicks are not recorded**: 12 Hero actions on T8 have no decision record, and nothing logs "Hero acted while an action was pending" | Medium (audit integrity) | No | §2; `controller.ts:386-431` sends the record only after execution |
| D6 | No turn clock was ever read (deadline always assumed) | Low, **UNVERIFIED** whether a clock was shown | No | 0 of 2,152 frames with `timeRemainingMs` |

Not defects (checked):

- Position labels and turn order agreed at every T8 decision point. The 32 "disagree" frames are h:45 (after the
  missed post, 31 frames) and one transient frame in h:13.
- Call amounts, pots and legal ranges matched at all 61 executed actions.
- No missed intermediate raise or hand-boundary error occurred at T8, other than D2.
- Button controls were present on every Hero-turn frame.
- The one false "Hero's turn" (h:17 frame 544, stale buttons just after the click) was caught by the executor.

### 5.1 The rejected duplicate (h:17): the safety system worked

| Time from turn start | Frame | Event |
|---|---|---|
| 0.00 s | 540 | Hero's BB option; decision ready: check |
| 14.56 s | 543 | the check is sent (target 14.50 s). The table briefly shows nobody to act; `idle()` clears the decision, but the pending action is already executing, so it is not cancelled |
| 14.60 s | 544 | the page still shows Hero's turn with stale buttons (fold on, check off), and the tracker version is still 6. The same key is decided again (thinking, then ready at 545) and armed; it is already past due, so it fires at once |
| 14.61 s | — | the first attempt is confirmed: "table shows Hero check" (924 ms confirmation) |
| 15.43 s | — | the second attempt is **rejected by the executor**: "this decision point was already acted on". No second click |

Proposed minimal fix (not implemented): the controller keeps the key of the last point it fired. `heroTurn` does not
start `decide` for that key while it is executing, or after it has been executed. Proposed deterministic regression
test, using the fake driver and clock from `tests/bot/ext.test.ts`:

1. Fire a check.
2. Feed one stale frame with `heroToAct: true` and the same version.
3. Assert that `decide` runs once and the executor receives one request.

### 5.2 Missed post (h:45)

Sequence:

1. Hero was not dealt in at h:42–44, after the timeout in h:41 (§5.3).
2. Hero re-entered at h:45 by posting 2 at CO. PokerNow asks a returning player to post a big blind.
3. The engine has no event for such a post. The first frame (1608) already warns "Hero shows 2 in front, engine has
   0". At frame 1615 the hand became invalid: "seat 1 shows 2 against a bet of 11: intermediate raises were missed".
4. The recommendation was suppressed (blocked, frames 1617–1618). At the assumed deadline the untrusted-state rule
   made a **safe fold** (logged at 19:50:40, 17 s after the suppression).

The fold of J7s facing 11 was harmless here. But every return from sitting out, and every opponent's entry post,
loses or invalidates that hand.

Proposed minimal fix (not implemented):

- Add a `post-live` event kind (a big-blind-sized post outside the blinds that counts towards the current bet) and a
  `post-dead` kind (a dead small blind that does not count).
- Recognise them in the tracker when a seat shows a bet before acting that matches the big or small blind.

Proposed regression test: an anonymised fixture of h:45 (`sim/bot/make-hand-fixture.ts`) rebuilds as valid, with
Hero's call amount 9.

### 5.3 Timing: the 5.51 s target with 24.65 s actual delay, and the probable timeout (h:41)

The T8 frames show **11 periods, totalling about 11 minutes of the 106, in which successive frames fall exactly on a
1-second grid**. Examples:

- frames 147–167: the timestamp's millisecond part is always .74;
- frames 1459–1536.

That pattern is Chrome's timer throttling for background pages. In those periods the 250 ms tick, and the
scheduler's 250 ms wait steps, ran at most once per second, and sometimes not for 20 s or more.

**h:5 preflop** (`T8:h:5|preflop|6`: raise to 12, target 5.51 s, actual 24.65 s):

| Time (s) | Frame | Event |
|---|---|---|
| 59.04 | 166 | Hero's turn; plan created, delay drawn as 5.51 s |
| (59.07) | — | decision ready: computation 27 ms according to the record |
| 81.00 | 167 | the next frame, 22 s later, on the 1 s grid; only now is the "ready" state recorded |
| 83.69 | 168 | raise sent = 24.65 s after the turn started |

Findings for h:5:

- The click came 19.1 s after the drawn delay and 7.7 s past the assumed safe point (17 s). The deadline cap could
  not help, because the code that enforces it was not running.
- The diagnostic is **accurate**: `actualDelayMs` is measured as the send time minus the turn start on the page
  clock (`scheduler.ts:185`).
- It was **not** a scheduling-logic defect, computation, a stale state or a controller decision. The page's timers
  were suspended or throttled; the browser was most likely in the background or minimised. **CONFIRMED by the frame
  cadence; the cause of the throttling (tab hidden) is inferred.**

**h:41** (`T8:h:41|preflop|2`, A5o, fold recommended):

| Time (s) | Frame | Event |
|---|---|---|
| 52.02 | 1477 | Hero's turn starts ("thinking") |
| 60.00 | 1478 | 8 s later, "ready" (normal computation is 2–10 ms) |
| 70.00 | 1479 | still ready, nothing sent |
| 83.00 | 1480 | Hero has folded, 31.0 s after the turn started; there is **no executor record** |

Findings for h:41:

- If the bot had clicked, a record would exist. The executor always reports, and a cancellation cannot interrupt a
  click in flight.
- The most likely explanation is PokerNow's own timeout fold. Afterwards Hero was not dealt in for three hands
  (h:42–44), which is consistent with PokerNow sitting out a player who timed out. **UNVERIFIED**: the page showed no
  sitting-out marker.

**All other T8 executions** were on time:

- 61 accepted; actual = min(target, 17.0 s) to within 0.11 s, except h:5;
- 15 drawn delays above 17 s were capped to 17.0 s by the assumed deadline, as designed;
- 0 deadline conflicts;
- confirmation took ≤ 928 ms.

Instant versus Random timing: 0.9.1 had only the randomised 4–20 s range, and the bundle settings do not show the
bounds. The observed range (4.23–19.90 s) matches the default.

Proposed minimal fix for D1 (not implemented; it changes no timing setting and weakens no safeguard):

1. **Detect and report.** When a tick or a wait step is more than 2 s late, log `page timers throttled (N s late)`.
   Add `lateMs` to the execution timing, and show a warning on the Live tab while `document.hidden` and autonomous
   play is armed.
2. **Keep the deadline enforceable.** Wake the content script from the extension's service worker, whose messages
   are not subject to page timer throttling, and use it both to tick and to end waits. Alternatively, tell the user
   that autonomous play requires the table tab to stay visible.

Proposed regression test: a fake `sleep` that resolves 20 s late must produce the diagnostic. The executor must still
re-validate the table, and it does today. Instant mode (0.9.2) would not avoid this, because the throttled tick loop
itself is late.

## 6. Preflop coverage issues seen live

T8 preflop decisions by source (60, re-run with the current code): heuristic 26 (43%), approximate chart 18 (30%),
computed all-in call 14 (23%), exact chart 2 (3%).

| Dealt in | Heuristic | Approximate chart | Computed | Exact chart |
|---|---|---|---|---|
| 5–6 | 0 | 6 | 1 | 2 |
| 7–8 | 11 | 9 | 5 | 0 |
| 9–10 | 15 | 3 | 8 | 0 |

**Phase 3.0 findings, checked live**

- **6-max data at full ring.** 14 chart decisions were stated as "6-handed data used at a 7–9-handed table".
- **Stack depth.** 10 were outside the charts' stated 60–150 bb.
- **Open size.** 3 said "made for a 2.5 bb open, the raise faced is to 5.5 bb".
- **Opponent-dependent cells.** 3 were on opponent-dependent Greenline cells.
- **The pool's sizing.** Opens faced on T8 were large: 2–10 bb opens and raises to 23–50 bb were common. The charts'
  assumed sizes rarely applied.
- **Inconsistent opener ranges.** The Phase 3.0 finding was the 15.5% defence against an 11% opener. It arose
  once: h:21, K7o at HJ against an MP open, 9-handed, used Pekarstas "MP-vs-open-UTG", stated as "the raiser sits
  earlier than the earliest seat in the data, nearest seat used". K7o folds in either range, so it had no effect
  here.

**Situations on T8** (bot recommendations, first decision of each spot):

| Situation | Count | Fold | Raise | Call or check |
|---|---|---|---|---|
| facing limpers | 20 | 16 | 4 | 0 |
| unopened (raise first in) | 12 | 10 | 2 | 0 |
| facing an open with callers | 8 | 8 | 0 | 0 |
| facing an open | 7 | 6 | 1 | 0 |
| cold facing a 3-bet | 4 | 4 | 0 | 0 |
| facing a squeeze | 2 | 1 | 0 | 1 |
| facing iso, BB option, 3-bet, 4-bet, cold 4-bet | 1–2 each | | | |

Short stack (16 bb or less): none. 14 of 60 decisions faced an all-in or a near-all-in call and were decided by
the computed all-in rule.
Opportunities to squeeze: 8 spots facing an open with callers, all folded. The hands were 72o, J9o (twice), K3o,
J8o, 63o, T3o and 76o; none is a reasonable squeeze or flat.

### 6.1 Early-seat open: right frequency, wrong hands (STRATEGIC CONCERN)

For 7–10 dealt-in players the early seats have no chart. They open the top `openFraction(behind)` (12.5% with 7
behind, 11% with 8, 10% with 9) of the **equity ordering** (`src/bot/ranges/range.ts`, documented as "an equity
ordering, not a playability ordering"; used at `preflop.ts:278`). That ordering puts:

- inside the top 12.5%: A9o (11.5–12.4%), A8s, A7s and 55;
- outside: QJs (15.8–16.1%), A5s (15.2%), KJo (13.4%), QTs (19.3%) and JTs (19.9%).

Published full-ring early-position ranges generally include QJs, JTs and A5s and exclude A9o.

The frequency is roughly right; the composition is not. Correcting it needs a sourced or computed full-ring range,
not a hand-picked list. This is Phase 3.0 weakness 1 again.

### 6.2 Iso-raise over limpers (STRATEGIC CONCERN)

The iso threshold is `0.6 × openFraction` (`preflop.ts:283`): 7.5% with 7 behind, tighter than the 12.5% open. A
limp-behind option exists only at CO, BTN and SB for pairs and suited hands. At early and middle seats every hand
outside 7.5% folds behind a limper, including KQo, KJs, ATo, 66 and A5s.

On T8, facing limpers was the most common situation (33% of preflop decisions, against about 5% in the Phase 3.1
simulated suite). There is no sourced iso chart for 7–10-handed play.

### 6.3 Heuristic continuing ranges ignore the price (CONFIRMED)

The "vs open / raise over limpers with callers" heuristic (`preflop.ts:309-315`) and the "vs 3-bet without a chart"
heuristic (`preflop.ts:337-343`) choose fixed percentile bands. The price is not an input, beyond an on/off check for
calling 3-bets.

Two T8 folds contradict the engine's own equity, with large margins:

- h:25 ·10: 21.4% vs 10.5% needed;
- h:5 ·13: 34.8% vs 19.6% needed.

Proposed minimal fix (not implemented): in those two heuristic branches, add a pot-odds floor. Allow a call when
Hero's equity against the engine's own villain ranges exceeds the price by a realisation margin. The margin would be
taken from the existing all-in rule (`computed`), not invented.

Proposed deterministic regression tests:

- anonymised fixtures of h:25 ·10 and h:5 ·13 must not fold;
- a control in which the price is poor (for example h:58 ·13) must still fold.

This is not "always play QJs": the same fixtures at a poor price must fold.

### 6.4 Opponent jam ranges (STRATEGIC CONCERN)

Re-jam and call-jam ranges are stack-depth percentile bands with floors of 1.5% and 2%
(`preflop-model.ts:116-118`). At 90 bb a re-jam becomes essentially AA, KK and part of AKs (h:35, with Hero holding QQ). This decided the two largest preflop folds,
QQ and 99. The population calibration loaded for v3 (HandHQ) is not used by v2 preflop.

## 7. Actual v2 and v3 usage (T8)

| | Decisions | Share |
|---|---|---|
| **v3** (heads-up postflop) | **2** (h:36 flop bet; h:5 flop fold) | 3.2% of all; **100% of heads-up postflop points** |
| v2, preflop fallback ("version 3 has no preflop engine") | 50 | 79.4% |
| v2, multiway fallback ("N opponents in the pot: version 3 searches heads-up pots only"; 2–4 opponents) | 11 | 17.5% |
| error or unsupported-state fallback | 0 | — |
| suppressed (state not trusted): h:45 | 1 point (then safe fold) | — |
| cancelled because someone acted first (no record) | 11 | — |

The preliminary count of **61 v2 to 2 v3 is correct.**

Situations that prevent v3:

- every preflop decision: v3 has no preflop engine;
- every postflop pot with two or more opponents: v3's search is heads-up only.

At a 7–10-handed table where pots are usually multiway, v3 ran at 2 of 13 postflop points. Its two executed decisions
are too few to judge it.

The recommend-mode tables (T1, T4, T5, T7) used v2 throughout. Where v3 was requested (T4, T7), v2 decided all
preflop points; T7 also had one postflop point with v2 requested.

## 8. Timing discrepancies (summary)

- **h:5:** 24.65 s against a 5.51 s target. The page timers were throttled (D1); the diagnostic is accurate.
- **h:41:** a probable PokerNow timeout at 31 s during throttling (D1). The bot did not click.
- **h:17:** a duplicate attempt, rejected by the executor (D3). Its `computeMs` was misattributed (D4).
- **All other T8 executions** were on time: 15 drawn delays capped at 17 s by design, 0 conflicts.

## 9. Performance summary (T8 only; not evidence of long-run results)

**Result:** 53 valid hands with a Hero result, blinds 1/2, total **+125 chips = +62.5 bb**. That is +118 bb/100,
**±352 bb/100** (95% interval; per-hand standard deviation 13.1 bb). The preliminary +125 chips over 53 hands is
**confirmed**.

**Concentration in two hands**

- h:25 (+157) and h:29 (+89) make up +246 chips. Without them, the other 51 hands total **−121 chips**.
- Without h:25 alone: −32 chips.
- Largest losses: h:35 QQ (−36), h:38 AQs (−35), h:5 (−22).

**What the bot's own policy would have done**

- h:25 is the biggest winner, and its preflop was played by hand against the bot's fold.
- h:5's extra 10 chips and h:58's 2 chips were also lost to hand-made calls.
- A rough bot-only counterfactual is about −20 chips. That is meaningless at this sample size, but it means the
  +125 chips cannot be credited to the bot.

**VPIP and PFR**

| | VPIP | PFR | Basis |
|---|---|---|---|
| Played on T8 (including the user's clicks) | 9 / 55 = 16.4% | 7 / 55 = 12.7% | |
| Bot's own first preflop recommendation | 7 / 54 = 13.0% | 13.0% | Wilson 95% interval 6.4–24.4% |
| Phase 3.0 simulated baseline, 9 players | 17% | 14% | `reports/V4_BASELINE_AND_GAPS.md` §4 |

The live rate is within sampling error of the simulated baseline. The live table also differs from the simulation:

- 8.4 players dealt in on average;
- far more limping (facing limpers was 33% of decisions, against about 5% in the simulation);
- much larger opens.

So frequencies are not directly comparable.

**Is the bot too tight?** Overall tightness is **not demonstrated** at 54 hands, and a TAG classification is not in
itself a defect. Particular spots are too tight for identifiable reasons:

- the heuristics ignore the price (§6.3, confirmed);
- early seats choose the wrong hands (§6.1);
- the iso threshold folds hands like KQo behind a limper (§6.2);
- opponent jam ranges are modelled very tight (§6.4).

## 10. Recommended fixes, in order of severity

Each fix is proposed with a deterministic regression test. **None is implemented.**

1. **D1, page timer throttling (High).**
   - Fix: detect and log late wake-ups, show a Live-tab warning while the tab is hidden, and wake the page from the
     service worker so the deadline cap stays enforceable.
   - Test: a late fake `sleep` produces the diagnostic; the executor still re-validates the table.
2. **§6.3, price-blind heuristic folds (Medium-High; affects strategy, confirmed).**
   - Fix: a pot-odds floor in the two heuristic branches, using the engine's own ranges and the existing realisation
     margin.
   - Tests: fixtures h:25 ·10 and h:5 ·13 do not fold; h:58 ·13 still folds.
   - Must be judged in the paired harness (`sim/bot/v4-bench.ts`) before adoption, with the Phase 3.1 rule: no
     adoption on fallback-rate changes alone.
3. **D2, live and dead posts (Medium).**
   - Fix: add `post-live` and `post-dead` event kinds and tracker recognition.
   - Test: the h:45 fixture rebuilds as valid, with a call amount of 9.
4. **D5, record cancelled recommendations and outside actions (Medium, audit integrity).**
   - Fix: store the decision with `execution: {status: 'cancelled', reason}`. Log "Hero acted while an action was
     pending" when the table shows a Hero action that the executor did not send.
   - Test: in the controller test, a hand-made click while waiting produces both.
5. **D3 and D4, re-arming an executed point; timing attribution (Low).**
   - Fix: skip `decide` for the fired key; pass the attempt's own `computeMs` to `fired()`.
   - Test: §5.1.
6. **§6.4 jam ranges, and §6.1 and §6.2 early-seat and iso composition (strategic).**
   - No code change from this evidence alone (two showdowns; no sourced full-ring data).
   - Address them through a licensed or computed range source and the strengthened opponent pool (roadmap §1.2).
7. **D6, clock reading (Low, unverified).** Record what PokerNow shows for the turn clock in the next live recording,
   before changing the reader.

## 11. What this means for Phase 3.1 and the next step

Phase 3.1 was already implemented (`1905518`) before this audit was requested. Measured against this evidence:

- **Confirmed useful:**
  - preflop classification and sources recorded with every decision;
  - stated substitutions ("6-handed data used at a 9-handed table", size departures);
  - the paired harness;
  - Instant/Random timing.

  The classification made this audit possible at decision level.
- **Not addressed by Phase 3.1 and now evidenced:**
  - price-blind heuristic branches (§6.3);
  - full-ring early-seat composition (§6.1);
  - iso threshold (§6.2);
  - tight jam bands (§6.4).

  Phase 3.1 only labelled these heuristics.
- **Recommended change of scope (before Phase 3.2 strategy work):**
  - **(a) Reliability:** a short "3.1b reliability" step for D1, D2, D4 and D5. D3 is already caught by the executor.
    These are execution and diagnostic fixes that change no strategy, and they are needed so the next live recording
    is clean and attributable.
  - **(b) Strategy:** the pot-odds floor (§6.3) should be the first strategy candidate, evaluated in the paired
    harness with a punishing opponent in the pool. The Phase 3.1 negative control showed the pool does not yet punish
    loose calls. The candidate must not be adopted on this live hand alone.
  - **(c) Data and range modelling:** §6.1, §6.2 and §6.4 stay in Phase 3.2 (data source and range modelling), as the
    roadmap already plans.
- **Next live test:**
  - keep the table tab in the foreground;
  - do not click by hand during autonomous play, or note when you do, so results can be attributed;
  - export the bundle immediately afterwards.
