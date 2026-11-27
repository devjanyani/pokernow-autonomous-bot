# Phase 3.1b: live execution and tracking reliability (version 0.9.3)

2026-11-26, branch `autonomous-bot`, from `74bcad0`. Implements the four confirmed reliability defects of
[LIVE_SESSION_FORENSIC_AUDIT_2026_11_21.md](LIVE_SESSION_FORENSIC_AUDIT_2026_11_21.md) (D1, D2, D3/D4, D5).

**What did not change:**
- strategy (v1, v2, v3), preflop ranges, opponent models, bluff frequencies;
- the default strategy, table authorisation and the emergency stop;
- the Instant/Random timing preference and its bounds.

No pot-odds rule was added. Stored data needs no migration: the new fields are optional additions.

Every hand and frame number refers to the 2026-11-21 recording (table T8 in the audit) unless stated. The recording
itself stays private and git-ignored. Only an anonymised 65-frame excerpt (hands 44–45) is committed as a test
fixture: `tests/bot/fixtures/live-2026-11-21-h45.json`.

## 1. Answers in short

| Question | Answer |
|---|---|
| Exact cause of the 24.65 s action (h:5) | The page's timers were held while the table tab was hidden. Neither the 250 ms read loop nor the scheduler's 250 ms wait ran for about 22 s. The held wait was released at 18:38:01.00, the moment the tab became visible again, and the raise was sent then (§2). |
| What Chrome does to a hidden tab | It runs a hidden page's timers at most once per second. "Chained" timers (setInterval, a setTimeout set from a timer callback) can be held much longer: Chrome documents once per minute after 5 minutes hidden. A frozen or suspended page runs nothing until it resumes (§2.3). |
| Can actions still miss deadlines? | **Yes.** No page timer can guarantee a deadline. What changed is what happens then: the action is **not sent**, and the site may time Hero out. |
| Are late actions safely cancelled? | **Yes.** Every wake-up and the moment immediately before the click are judged on the monotonic page clock. Past the latest safe moment (+0.5 s) the attempt expires; it is recorded and never sent. The same applies after a suspension (the wall clock and the page clock disagree) and when the turn's start is too uncertain to anchor the deadline (§3). |
| Reliable unattended background-tab execution? | **Not achievable with this architecture**, and not attempted (§3.4). The bot now says so on the dashboard and the panel whenever autonomous play is armed and the tab is hidden or its timers are being delayed. |
| Re-entry posts reconstructed? | **Yes, for the pattern the recordings show:** one big blind live, plus the missed small blind dead, before the first action. Hand 45 now rebuilds as valid, with Hero facing 9 more. Three other recorded hands where an opponent's post had been counted as a voluntary call are corrected. Patterns the recordings do not show are left explicit and uncertain (§4). |
| Manual overrides and cancellations recorded? | **Yes.** Every recommendation in authorised play gets one lifecycle record, stored when its fate is known: executed, rejected, failed, cancelled (with the reason) or expired. A manual action is recorded as `manual-click-observed` when the page reported a real click on an action button, and as `manual-inferred` when only the table showed it (§5). |
| Duplicate-attempt timing fixed? | **Yes.** A decision point whose action was sent is never decided again, no attempt can be armed while one is executing, and timing is taken from the attempt's own object. Hand 17 is reproduced in a test: one decision, one executor call, one record with its own timing (§6). |

## 2. D1 root cause (hand 5: target 5.51 s, sent at 24.65 s)

### 2.1 Evidence

The frame recorder stores a frame whenever anything it tracks changes, including the recommendation state
(`recorder.ts` `record()`). So after the decision became *ready*, the next read of the table must produce a frame.

| Page clock (ms) | Wall clock (UTC) | Frame | What happened |
|---|---|---|---|
| 441,746.6 | 18:37:36.351 | 166 | Hero's turn read; plan created (delay 5.51 s, latest safe 17 s); the tick starts the decision ("thinking") |
| — | 18:37:36.352 | — | decision ready: v2 raise to 12, 25 ms of computation (decision record timestamp). The scheduler's first 250 ms wait is set |
| 463,735.8 | 18:37:58.314 | 167 | the next read of the table: 21.99 s later, on the 1-second grid (the page clock reads `.736` ms, as all the frames from 147 on do). Only now is "ready" recorded |
| 466,400 | 18:38:01.004 | — | the 250 ms wait set at 36.35 runs, 24.6 s late. The action is sent: `actualDelayMs` 24,653.6 |
| 466,453.8 | 18:38:01.032 | 168 | the table shows the raise; bet entry and confirmation took 226 ms, normal speed |
| 466,541 → | 18:38:01.1 → | 169–243 | frames back on the normal 250 ms read loop (page-clock phases 35, 285, 535 and 785 ms) |

The cadence of the frames shows when the page was visible:
- **Visible:** reads follow the 250 ms loop at its own phase.
- **Hidden:** reads only on the 1-second grid.

Reconstructed:
- visible until 18:36:15.7;
- hidden from 18:36:34.3 at the latest until 18:38:01.0, about 1 min 45 s;
- earlier hidden spells: 18:35:18–18:35:46, 18:35:50–51 and 18:36:08–09.

### 2.2 What this shows

1. **No read ran from 36.35 to 58.31 s, about 22 s.** The read loop is a `setInterval(250)` (`content.ts`). That is
   more than Chrome's documented once-per-second check for hidden pages.
2. **One timer ran at 58.31 s, the wait did not.** The 58.31 s read ran on the 1-second grid. It came from the other
   read trigger: a `MutationObserver` that sets a single `setTimeout(40)`, which is not chained. The scheduler's wait
   was already due, but it did not run then. It is a chain of `setTimeout(≤250)` calls, each set from the previous
   one's callback.
3. **The wait was released when the tab became visible.** It ran within 30 ms of the first read back on the normal
   loop. The bet entry that followed (two short sleeps) and the confirmation polling ran at full speed.

So the exact behaviour: **Chrome held the page's chained timers while the table tab was hidden.** It held the
250 ms read loop and the scheduler's wait chain for 22–25 s, while still running an unchained 1-second-aligned timer.
It released them the moment the tab was shown. The click time was then simply "when the held timer was released".
That is 19.1 s after the target and 7.7 s past the 17 s latest safe moment. No code that could have enforced the cap
was running.

The diagnostic was accurate: `actualDelayMs` is measured on the page clock. The scheduling logic, the computation
and the state were not at fault. 0.9.1 had no rule that refused a decision whose latest safe moment had passed, so a
late wake-up was taken as permission to act.

**Not determined from the recording: which Chrome policy applied.** The pattern (chained timers held tens of seconds,
an unchained timer still running on the second) is what Chrome documents as *intensive throttling*: chained timers,
hidden for more than 5 minutes, silent for 30 s, checked once per minute. Two things do not match that
documentation:
- by the frames, the tab had been hidden for under 2 minutes;
- the release came at the moment the tab was shown, not on a minute boundary.

An Energy Saver or efficiency mode, a different grace period in this Chrome build (157), or Windows window
occlusion could each explain it. The page cannot tell them apart. This is **confirmed as behaviour, unverified as to
the policy**.

**h:41** (probable timeout fold): the same throttled period (frames 1459–1536, 19:40:19–19:45:44).
- Hero's turn started at 19:41:35.3 ("thinking").
- No read ran from 41:53.3 to 42:06.3, and no executor record exists.
- At 42:06.3 the fold is shown, 31.0 s into the turn, and the pending wait was cancelled by that read.
- Hero was not dealt in for the next three hands.

This is consistent with the held wait never running before PokerNow's own clock ran out.

### 2.3 What Chrome does to a hidden or suspended tab

- **Hidden** (another tab in front, or the window minimised; possibly an occluded window): the page's timers are
  checked at most once per second.
- **Chained timers in a page hidden long enough:** checked once per minute (Chrome 88+, "intensive throttling"). The
  recording shows this class of holding occurring earlier than the documented 5 minutes.
- **Frozen or suspended:** nothing runs. This covers a frozen or discarded tab, a computer that sleeps, and a
  debugger pause. The page clock (`performance.now`) and the wall clock can then disagree when it resumes.
- **Unaffected:** DOM events (`MutationObserver`, `visibilitychange`, clicks) and `MessageChannel` tasks are not timer
  tasks. But they only run if the page is running and something triggers them.

## 3. D1 fix: detect, refuse late actions, warn

### 3.1 Behaviour, before and after

| Situation | 0.9.1 / 0.9.2 | 0.9.3 |
|---|---|---|
| The wait wakes after the latest safe moment (h:5) | sent late (24.65 s) | **expired:** not sent, recorded with the reason, in the form "N s past the latest safe moment (17.0 s into the turn, assumed deadline); the browser delayed the page's timers by up to M s: an expired decision is never executed", logged, and shown on the dashboard as "Last expired" |
| The wait wakes late but before the latest safe moment | sent, lateness not recorded | sent once. The lateness is recorded on the attempt (`maxTimerLateMs`, `lateWakeups`); the stored settings are read again first (§3.2) |
| Suspension: the wall clock moved more than 1 s further than the page clock during one wait step | not detected | **expired:** "the time left on Hero's turn is not known" |
| Hero's turn first read more than 1 s after the previous read, no clock shown | the assumed 20 s clock counted from the late read | counted from the previous read (the earliest possible start). Beyond 2 s of uncertainty the deadline counts as **not established** and the action is not sent. An observed clock makes it reliable again |
| Timers held while a bet amount is typed | submitted whenever the held sleep ended | the driver asks again immediately before the submit (`onTime`). If the attempt has expired, nothing is submitted, and the passive fallback is refused by the same check |
| Gaps between reads of 2 s or more | not reported | logged (at most every 30 s), counted for the last minute, shown in the "Page timers" row |
| Table tab hidden while autonomous play is armed | nothing shown | warning on the dashboard and the panel: "Needs attention: The table tab is in the background…"; log lines when it hides and shows again |

### 3.2 How it works

- **`src/bot/ext/scheduler.ts`:**
  - Every armed action is an attempt with its own `id`.
  - `waitFor(attempt)` measures each wake-up against the time it asked for (monotonic page clock), and the wall
    clock against the page clock (suspension).
  - After every wake-up, `verdict(attempt)` returns why it may no longer run:
    - the plan is unreliable;
    - the wall clock jumped;
    - or it is more than `LATE_TOLERANCE_MS` (0.5 s) past `latestSafeAt`.
  - An expired attempt is settled once, through `onSettle`.
  - No busy-waiting: the same 250 ms steps as before. No new timers, no polling, no hidden playback, no workers.
- **`src/bot/ext/controller.ts`:**
  - measures the gap before every read (`LOOP_GAP_MS` 2 s);
  - passes the turn-start uncertainty to the plan;
  - after delayed timers, reads the stored settings before the click (`deps.loadSettings`). An emergency stop or a
    withdrawn permission set in the popup while the page was suspended may not have been delivered yet;
  - gives the executor a last-moment `guard`: the verdict on the monotonic clock, and a shown table clock that has
    not run out. The guard is checked after all eight existing checks pass, on the executor's fresh read,
    immediately before the decision point is marked used and the click is sent;
  - gives the DOM driver `onTime` for bet entry.
- **`src/bot/ext/content.ts`:**
  - `visibilitychange` tells the controller and reads the table at once when the tab is shown;
  - `wallNow`, `visible` and `loadSettings` are supplied.
- **Unchanged:** the executor's eight checks, the used-decision-point record, the emergency stop path, the
  authorisation gate, the timing modes and their bounds.

### 3.3 What remains true

- **A deadline can still be missed.** If the browser holds the page's timers past the deadline, nothing is sent: the
  site's clock runs out, and PokerNow folds or checks for Hero. This is a safe failure, not a guarantee of action.
- **The thresholds are judgement calls:** 0.5 s past the latest safe moment, 2 s of start uncertainty, a 1 s clock
  divergence. The latest safe moment is still 3 s before the assumed deadline.
- **The untrusted-state fallback is still timer-driven** (`untrustedTurn`: check or fold near the deadline). It acts
  on the current read only, but in a hidden tab it can also run late or not at all.

### 3.4 Background execution: why it is not achievable here, and what was not done

**Reliable unattended background-tab execution is not technically achievable with the current architecture.**
- The decision, the timing and the click all live in the page's content script. The browser decides when that
  script runs while the page is hidden, and can freeze it outright.
- The click itself must happen in the page.
- Considered and rejected:
  - **`chrome.alarms`:** a minimum period of 30 s, and alarms can be late; inadequate for a 4–17 s window.
  - **Waking the page from the service worker:** an MV3 service worker can be stopped after about 30 s without
    events, which loses its timers. Delivery into a frozen page waits for it to resume. And using it to wake a
    throttled page is a throttling workaround.
  - **An offscreen document or worker timers:** offscreen documents are purpose-restricted, and timers in a worker
    are a known throttling bypass.
  - **Silent audio:** hidden playback is explicitly excluded.

The supported way to play autonomously is to keep the table tab in front, in a window that is not minimised. The
extension now says so whenever that is not the case, and fails safe otherwise.

## 4. D2: returning-player and entry posts

### 4.1 Evidence (hand 45, frames 1607–1608)

- **Previous read (end of hand 44):** Hero 240 behind, nothing in front.
- **First read of hand 45:**
  - Hero 237 behind, 2 in front, at CO;
  - SB 1, BB 2, pot **6**;
  - the table shows UTG (seat 6) to act, which is the hand's first actor.
- So Hero paid 3: a big blind live (2, in front) and the missed small blind dead (1, in the pot, not in front).
- **0.9.1:** the engine had no such event. It warned "seat 1 (Hero) shows 2 in front, engine has 0". When Hero's
  turn came (facing 11 with 2 in), the hand became invalid ("intermediate raises were missed"), and the
  recommendation was blocked.

### 4.2 Rules implemented (only what the recordings support)

**Engine (`src/bot/table/engine.ts`):**
- `HandConfig.extraPosts` with two new forced kinds:
  - `post-live`: at most one big blind; counts toward the bet; not voluntary; the poster keeps the option like the
    big blind;
  - `post-dead`: goes to the pot only; never counts toward the bet.
- Posts at the blinds, or above one big blind, are refused.
- Every consumer that filters `kind.startsWith('post')` (profiles, preflop context, villain ranges, v3 search)
  therefore never counts a post as a call, raise, limp or VPIP.
- `rebuild.ts` replays the new kinds, so hand records stay replayable.

**Tracker (`src/bot/adapter/tracker.ts` `reentryPosts`):** chips in front of a non-blind seat at the start of a hand
are a live post only when all of these hold:
- the standard blind layout fits, with every blind visible;
- the table shows the hand's **first** actor, so nobody has acted;
- no seat shows more than its forced amount;
- the chips are exactly one big blind;
- the poster sits after the first actor. The first actor itself qualifies only when its dead small blind is
  confirmed by its own stack (18 Nov h:32).

**Dead money** (what the pot holds beyond the chips in front and the antes, at most one small blind, with a single
poster):
- *attributed* when the poster's stack before the hand confirms it (stack before = stack + in front + ante + dead);
- *attributed but the hand is marked uncertain* (kept out of profiles) when that stack was not seen;
- *not attributed* when the stack contradicts it (the pot mismatch warning stays).

**Kept explicit rather than guessed:**
- **No acting seat shown:** the tracker waits briefly, then starts the hand marked uncertain without modelling the
  post.
- **A first read after limps, or on a later orbit:** treated as ordinary actions, with a note.
- **Not modelled at all, because no recording shows them:** dead big blinds, a dead small blind without a live big
  blind, and posts of other sizes.

The previous hand's result check now includes the dead money, so a returning player's start stack is not reported
as an unexplained difference.

### 4.3 Results on every recorded bundle (offline replay through the tracker)

| Bundle | Valid hands before → after | Hands with entry posts | Note |
|---|---|---|---|
| 2026-11-13 ×3, 2026-11-16, 2026-11-18 (02:28) | unchanged | 0 | |
| 2026-11-18 (04:35) | 96 → 96 | 2 (h:28, h:32) | posts by opponents, live 0.5 + dead 0.25, confirmed by their stacks. Before, each was counted as a voluntary call |
| 2026-11-21 | 177 → **178** | 2 (h:45, h:60) | h:45 is now valid (it was "ending not observed"). h:60: an opponent's post (live 2 + dead 1) is now a post instead of a call. Its ending was not observed |

Invalid hands: unchanged in every bundle. Two looser rule versions were rejected during development because they
misread mid-hand first reads as posts (21 Nov hands 1, 2, 6 and 49 of other tables). The final rule does not.

## 5. D5: decision lifecycle records (schema 2)

`DecisionRecord.lifecycle` (optional; `src/bot/ext/records.ts` `DecisionLifecycle`) records:
- **opportunity:** hand, street and state version; stable across repeated reads;
- **attempt:** the scheduler attempt id; 0 for recommendation-only records;
- **mode, permission and strategy:** mode; whether execution was permitted; the strategy selected and used, and any
  fallback;
- **recommendation:** action, amount, label;
- **schedule:** timing mode, drawn delay, planned and latest-safe times, deadline source, start uncertainty,
  conflict and cap;
- **timing:** when the recommendation was ready; when it was handed to the executor;
- **outcome:** `recommended | executed | unverified | rejected | failed | cancelled | expired`, with the reason;
- **Hero's action and its evidence:** `bot | manual-click-observed | manual-inferred | none | unknown`, with a
  detail;
- **table confirmation:** whether the table showed the action;
- **timer health:** maximum lateness, late wake-ups, clock jump, gap before the turn, page visibility;
- **events:** a list of timed lifecycle events (at most 40).

**When a record is stored:**
- **Authorised play:** one record per attempt, when its fate is known.
  - A cancellation because "it is no longer Hero's turn" is held until the state moves on. If the same decision
    point comes back (a one-read display flicker), the same attempt continues: one record, not two.
- **Recommendation only:** one record per decision point and recommendation, when shown.
  - A record is not repeated for identical reads or after a flicker.
  - After an emergency stop, the same point is shown, and stored once, as a recommendation.

**How manual actions are told apart:**
- **Observed:** the content script listens for real clicks (`isTrusted`; the bot's own `element.click()` is never
  trusted) on the table's action buttons and the bet form (`PokerNowDom.userActionOf`). Such a click cancels a
  pending action for that decision point at once and is kept as evidence.
- **Inferred:** the table shows a Hero action the bot did not send, but no click was seen. This could be a keyboard
  shortcut, a click the page did not report, or **PokerNow's own time-out action**; these cannot be told apart.

**Compatibility:**
- `execution` keeps its 0.9.1 meaning: set only when the executor was called. A cancelled or expired record has
  `execution: null`, so tools that treat a record with `execution` as "executed" are still right.
- Records written before 0.9.3 have no `lifecycle` and are read unchanged.
- The message validator, storage, the table export and the debug bundle (format version 1, unchanged) pass the new
  field through. No migration is needed; a test stores and exports both shapes.
- `ExecutionTiming` gains the optional `attempt` and `maxTimerLateMs`.

## 6. D3/D4: the duplicate attempt (hand 17)

**Reproduced** (test "hand 17"):
1. The check is sent.
2. The next read shows nobody to act, which cleared the decision in 0.9.1.
3. The reads after it show the old buttons with the same state version.
4. 0.9.1 then decided and armed the point again. The second `arm()` replaced the pending object, so `fired()` of the
   first attempt read the second one's `computeMs` (14,605 ms), and the second was rejected by the executor with
   `computeMs` 0.

**Fixed:**
1. The controller keeps the decision points whose action was handed to the executor and never decides them again.
   The panel shows "Action sent for this decision point; waiting for the table to show it."
2. The scheduler refuses to arm while an attempt is executing.
3. `firing(attempt)` and `fired(attempt)` work on the attempt object, so timing can only come from that attempt.

The executor's used-decision-point protection is unchanged and still the last line of defence. The test asserts one
click, one executor call, one record, `computeMs` under 1 s, and no "already acted on" rejection.

## 7. Tests

**New: `tests/bot/reliability-31b.test.ts`, 28 deterministic tests.** They use a manual page clock, a separate wall
clock, held and frozen timers, and seeded randomness.

*Scheduler:*
- late wake-up after the deadline;
- late but in time;
- suspension;
- unknown start;
- attempt identity.

*Controller:*
- 25 s hold, in both release orders;
- 8 s hold;
- frozen computer;
- a 6 s gap before the turn, with and without a table clock;
- emergency stop during a suspension;
- the table times Hero out during a suspension, in both orders;
- a hold during bet entry;
- the hidden-tab warning.

*Duplicate and lifecycle:*
- hand 17;
- a manual click observed;
- a manual action inferred;
- cancellation records, a flicker, and recommendation-only records.

*DOM driver:*
- submit withheld;
- real-click classification.

*Export compatibility:* 0.9.1 and 3.1b records, storage, table export and bundle.

*D2:*
- the fixture is the recording;
- hand 45 rebuilds as valid, with a pot equal to the table at every frame, a call of 9, and a replayable record;
- the controller now gives a recommendation at Hero's turn in hand 45;
- engine rules, and no VPIP or limp for a post;
- a joining player's live-only post;
- unconfirmed and contradicted dead money;
- a first read after limps;
- no acting seat shown.

**Results:** see §9.

## 8. Remaining limitations

1. **Deadlines are not guaranteed.** In a hidden, throttled or frozen tab an action can be cancelled instead of sent.
   The site may then time Hero out and sit Hero out (the h:41 pattern).
2. **Unattended background play is not supported** (§3.4). The warning depends on `document.visibilityState`. An
   occluded but "visible" window may still be throttled; that shows only as delayed reads.
3. **A manual action without a seen click cannot be told from PokerNow's time-out action** (`manual-inferred`).
   Keyboard shortcuts are not captured.
4. **Only the recorded entry-post patterns are modelled.** A dead big blind, a lone dead small blind and other sizes
   are not; they stay notes and uncertainty.
5. **Real browser throttling is not reproduced in the automated Chromium checks.** Headless Chromium does not hide
   the tab the way a user does. The throttling behaviour is covered by the deterministic tests and by the recording.
6. **The policy is unverified.** Which Chrome policy held the timers on 2026-11-21 is not determined (§2.2).
7. **D6 is unchanged:** no turn clock was ever read on PokerNow, so the deadline is always the assumed 20 s from the
   start of the turn.

## 9. Verification

- full suite **1,282 / 1,282** (96 files, `npx vitest run --maxWorkers=4 --minWorkers=1`), including the 28 new tests;
- type-check (`tsc --noEmit`, `npm run typecheck:tools`), lint (0 errors), production build: pass;
- Chromium, built extension, stand-in table, one at a time: `bot:e2e` 24/24, `bot:e2e:recommend` 32/32,
  `e2e-v3` 27/27, `bot:e2e:exec` 28/28, `bot:e2e:dashboard` 40/40 (same counts as 0.9.2). Not run on live PokerNow.
