# Audit of the long-session recording of 2026-11-16

Subject: the debug bundle exported on 2026-11-16 07:34 UTC by extension 0.6.0 (kept locally in `debug_bundles/`,
never committed). Players and tables are named by placeholders here (`T7` is the seventh table, `T7:h:58` its
58th hand since the tab was opened; Hero is always seat 1).

Everything below can be reproduced from the bundle:

```
npx tsx sim/bot/audit-bundle.ts <bundle.json>                    # whole bundle, anonymised
npx tsx sim/bot/audit-hand.ts <bundle.json> T7:h:58 --replay     # one hand, frame by frame
```

"Stored" means what the extension wrote during play. "Rebuilt" means the same recorded observations fed to the
tracker as it is after this audit.

## Summary

- The bundle holds eight recording sessions on seven tables over three days: 3,144 frames, 138 recorded hands,
  110 stored hand summaries, 177 stored recommendations. Nothing was dropped (no pruned frames, no sequence gaps).
- **The large negative hand is real.** Hero lost 1,602 chips (534 big blinds) in `T7:h:58`. The stored
  recommendation at that decision was to fold; the call was a manual click.
- **The positive total was a sum over an unrepresentative subset.** It added the 55 hands stored as valid
  (+848.7 bb) and left out every hand stored as invalid or unfinished, which included the two largest losses. Rebuilt and checked against the stacks, Hero's result over the 83 hands that
  have a verified result is **minus 87.8 big blinds**. (Big blinds of different sizes are added together in that
  figure, as they were on the dashboard: four stake levels occur in the bundle.)
- **Seven defects were confirmed, reproduced in tests and fixed** (A to G below). Stored summaries were 66%
  usable (73 of 110 verified); the same recording rebuilt is 95% (104 of 109 completed hands).
- One class of wrong result could not have been found without a new check: **boards run twice**. The page shows
  one board and pays according to two. Three hands in the bundle were paid differently from the cards shown.
  Every result is now compared with the stacks the next hand starts with.
- No defect was found in turn order, blind assignment or legal-action detection during ordinary betting.
  All 24 decisions where Hero's action differed from the recommendation were manual clicks; none came from the
  executor.

## What was recorded

| Session | Table | Start (UTC) | Minutes | Frames | Hands recorded | Stored summaries | Stored as valid | Valid when rebuilt |
|---|---|---|---|---|---|---|---|---|
| 1 | T1 | 11-13 19:20 | 5 | 118 | 5 | 5 | 3 | 3 of 4 |
| 2 | T2 | 11-13 19:53 | 13 | 276 | 6 | 5 | 3 | 5 of 5 |
| 3 | T3 | 11-13 20:55 | 27 | 634 | 14 | 13 | 8 | 13 of 13 |
| 4 | T4 | 11-14 06:45 | 13 | 271 | 10 | 9 | 5 | 9 of 9 |
| 5 | T5 | 11-14 06:57 | 1 | 29 | 2 | 1 | 1 | 1 of 1 |
| 6 | T4 | 11-14 06:58 | 0 | 1 | 1 | 0 | 0 | 0 of 0 |
| 7 | T6 | 11-15 19:15 | 5 | 131 | 7 | 7 | 4 | 7 of 7 |
| 8 | T7 | 11-16 06:30 | 63 | 1,684 | 70 | 70 | 50 | 69 of 70 |

Sessions 1 to 3 were recorded by versions before 0.5.1 and contain problems those versions already had and later
versions fixed (the call button read from a size shortcut; a hand closed before the flop while play continued).
They are listed where relevant and not counted as new findings.

| Status of the hand summaries | Stored | Rebuilt |
|---|---|---|
| Verified | 73 | 104 |
| Reconstruction invalid | 19 | 0 |
| Ending not observed | 17 | 2 |
| Result unverified | 1 | 3 |
| Total | 110 | 109 (one hand of session 1 was still in progress when the tab closed) |

## The two results in the screenshot

### The large loss: `T7:h:58`, minus 534 big blinds

Blinds 2/3. Hero, small blind, 4d 6d, 1,602 chips.

1. Two players call 3. Hero raises to 18 (recommended and carried out by the executor).
2. The big blind moves all-in for 3,280. Both callers call all-in (2,771 and 847).
3. Hero's turn: pot 6,916, 1,584 to call. **Recommendation: fold** (call valued at minus 536 big blinds). It is
   stored as "shown only": the executor did not act. Hero's 1,584 then go in.
4. Board 4s Qh Ks 2h As. Hero's stack reads 0 afterwards and Hero is not dealt into the next hand.

The chips add up exactly (stack changes minus 1,602, plus 1,832, minus 2,771, plus 2,541; total zero), the action
is fully displayed, and nothing is deduced. The result is correct.

It was shown as "reconstruction invalid" because of defect A: after the call, the site returned the 509 chips of
the biggest stack that nobody could call, before the board was dealt, and the tracker treated that stack as
unexplained.

### The positive total

| Sum of Hero's results | Hands | Big blinds |
|---|---|---|
| Stored, hands marked valid (what the dashboard showed) | 55 | +848.7 |
| Stored, every hand that has a number | 82 | −30.3 |
| Rebuilt, verified results (after fixes A to G) | 83 | −87.8 |

The first row is arithmetically right and badly biased: a hand that ended in an all-in was far more likely to be
marked invalid (defect A), and all-in hands are where the large results are. The hands it left out include
`T7:h:58` (minus 534), `T7:h:55` (minus 360) and `T6:h:4` (minus 84.5), and also `T6:h:6` (plus 99).

The third row is lower than the second mainly because of one hand (`T3:h:5`): the cards shown give Hero the whole
pot (plus 63 big blinds), but the table paid half of it to each player (plus 6.5). See defect F.

**Check against the stacks.** For every pair of consecutive hands in a session, Hero's stack at the end of the
rebuilt hand was compared with the stack the table shows when the next hand starts. 76 of 77 pairs agree to the
chip. The one difference is plus 200 chips after Hero's stack reached zero in `T6:h:4`: a re-buy.

## Defects found, reproduced and fixed

Each has a failing-before, passing-after test in `tests/bot/live-2026-11-16.test.ts`, run on frames cut from this
recording (`tests/bot/fixtures/live-2026-11-16-ranges.json`, names and table id replaced, observations unaltered).
Each also has a test that the neighbouring wrong case is still caught.

| | What the table showed | What 0.6.1 did | Hands affected (stored) | Fix |
|---|---|---|---|---|
| A | An all-in is called for less. The uncalled part returns to the bettor's stack before the board is dealt. | Marked the hand uncertain, with no message. Stored as "reconstruction invalid". | 15 of the 19 invalid hands | When nobody is left to act, a stack equal to the settled stack plus that seat's uncalled bet is accepted. Any other unexplained stack still keeps the hand out, and now always writes a tracker message saying which seat and why. |
| B | At showdown the loser does not show cards; the pot is paid and the next hand starts. | Waited for every live seat to show. Stored as "ending not observed", result excluded. | 15 of the 17 unfinished hands (with the unseen last fold), including minus 360 bb | The hand is settled with the hidden hand losing, and accepted only if the next hand starts with exactly those stacks (same seat, same name). Otherwise it stays "ending not observed". The same test confirms a last fold that was not displayed. |
| C | A call of an all-in is drawn as the caller's whole stack in front (3,235 against a bet of 802). | Read it as a raise, which the rules do not allow there. Hand invalid. | 1 | More chips than the bet where no raise is legal is a call. |
| D | For a moment the page shows no chip amounts (every stack and the pot unreadable, bets drawn as 0). 23 frames in two sessions. | The highlight had moved on, so a check was deduced. The seat had bet. The next player's fold then looked like a fold with a free check. | 1 | A check is not deduced from a frame in which that seat's stack cannot be read. |
| E | A player folds although a check is free (Hero did this once with the big blind). | Assumed a bet had been missed; hand uncertain. | 3 | When every stack, bet and the pot are exactly as reconstructed, nothing was missed and the fold is accepted (with a note). If any chips are unaccounted for, the hand is still marked uncertain. |
| F | An all-in is called and the players run the board twice. The page shows one board and pays by two. | Settled the pot from the board shown. Result wrong, nothing checked it. | 3 (pots split 113/113, 439/439, 535/535) | New: every finished hand is compared with the stacks at the start of the next hand. See below. |
| G | Facing an all-in for more than Hero has, the call button reads the full amount ("Call 126"); Hero can put in 64. | Reported the buttons as disagreeing with the engine and **suppressed the recommendation** at that decision. | 1 decision | A call button showing exactly the full amount to match, when the engine's call is Hero's whole stack, agrees. Any other amount is still a mismatch. |

### The result check (F)

When the next hand starts, each player's chips (stack plus the blind or bet already in front, plus an ante already
taken) are compared with the stack the finished hand was settled at. The outcome is stored with the hand:

| Outcome | Meaning | Effect | In this bundle (rebuilt) |
|---|---|---|---|
| confirmed | every stack is as settled | result verified | 86 |
| top-up | only increases | chips were added between hands; result stands | 12 |
| awarded differently | the same chips ended with different live players at a showdown | the table's result replaces the settled one; the hand is marked "Verified by stacks" with a warning | 3 |
| unexplained | anything else | result shown as unverified, never summed | 2 |
| unavailable | a player of the hand had left, or no next hand could be read | as before | 4 |
| no following hand | the session ended | as before | 2 |

"Awarded differently" is accepted only when the differences are among players who were still in the hand at
showdown and cancel out exactly. All three cases in the bundle are exact halves of the pot, and the page showed a
Yes/No prompt after the all-in call in the one case where the buttons were recorded, which fits the site's
run-it-twice option. The tracker does not claim to know why the pot was shared; it reports what the table paid.

The two "unexplained" hands are at the table with antes: before one of them every player is 3 chips short at the
next deal (a pot that everyone paid into before the first observation), and one is 0.1 off (an ante). They are
shown as unverified rather than guessed at.

For a hand that was already stored when its next hand started, the check arrives as a separate message and is
attached to the stored hand (`HandRecord.stackCheck`). It is not applied to a hand that was deleted meanwhile.

## Other things looked at

**Repeated action observations.** None. No action appears twice in any stored or rebuilt hand, and no frame
sequence has a gap.

**Street transitions.** No wrong transition in sessions 4 to 8. In session 1 (an older version) one hand was
closed before the flop while four players went on; the current tracker follows that recording correctly.

**Missing player actions.** Deduced actions are marked as such. The only wrong deduction found is defect D.

**Missing hand endings.** After the fixes two remain, both genuine: the next hand began with different players
before the last action was visible.

**Joins and departures.** Handled, with one limit: the page numbers seats relative to Hero. When Hero is not
seated (after losing the whole stack), every other player's seat number shifts by one. Decisions are unaffected
because there are none to make, and profiles are keyed by name or player id, but the hand before and the hand
after cannot be compared seat by seat, so that result is reported as "could not be cross-checked".

**Recorded hands with no summary.** Five: the hand in progress when each tab was closed, and one single-frame
session. Nothing to store.

**Missing recommendations.** Of 177 actions Hero was seen to take, 172 have a stored recommendation.

| Missing | Cause |
|---|---|
| 3 (one hand, session 2) | Older version: a size shortcut was read as a call button. Fixed in 0.5.1. |
| 1 (session 1) | Hero acted between two reads of the page. |
| 1 (`T6:h:4`, turn, an all-in call) | Defect G. |

**Recommendation against action.** 148 of the 172 were played as recommended; 36 were carried out by the
executor. All 24 differences are stored as "shown only", that is, clicked by hand. Seventeen of them are calls
where the recommendation was to fold; the largest is `T7:h:58`.

## Decisions that look strategically doubtful

These are observations for the strategy work, not tracking defects. No claim is made that a different action
would have won more: the samples are single hands.

| Hand | Situation | Recommended | Why it stands out |
|---|---|---|---|
| `T7:h:6` (minus 158 bb) | K-Q, top pair on K-8-4 two-tone, four players, raised pot | Bet 150% of the pot on the flop, then all-in for 71% of the pot on a turn that paired the 8, with two callers | One pair is played for a whole 158 bb stack against two players who called a 150% pot bet. The values shown (403 for all-in against 301 for a check) rest on the modelled chance that both fold or call with worse. |
| `T7:h:55` (minus 360 bb) | A-5 suited, nut flush draw and a gutshot, three-bet pot, three players, about 900 bb deep | Raise a bet of 84 to 504 on the flop (pot 336) | A sixfold raise into the three-bettor and a caller. Modelled value 294 for the raise against 161 for a call; the difference is fold equity that nothing has measured. The later call of an all-in with correct odds is unremarkable. |
| `T6:h:4` (minus 84.5 bb) | Heads-up, turn K making three hearts, Hero bets 150% of the pot and is raised | Re-raise to 100, leaving 64 behind | A raise that commits the stack while keeping a fold "available" that would never be used. |
| Fixture table (not this bundle) | Flop, 18% equity | Bet small | Seen in the dashboard test run; noted for the same reason. |

The common thread is large bets and raises whose value depends on how often opponents fold: the part of the model
that the Phase 2.1 diagnosis found to be unvalidated. In simulation the version 2 engine was too passive; in
these hands against people it chose the largest sizes. Both can be true: the simulated opponents and these
players differ, and the engine has no measured response frequencies for either.

## What changed in the code

- `src/bot/adapter/tracker.ts`: fixes A to G; `ResultCheck`, `HandTracker.takeResultChecks()`,
  `CompletedHand.resultCheck` and `endConfirmedByNextHand`.
- `src/bot/ext`: the check travels as a `bot/handCheck` message and is stored on the hand
  (`BotStorage.applyHandCheck`). Hand review shows "Verified by stacks" with the table's result and a warning;
  an unexplained difference shows the result as unverified.
- Tools: `sim/bot/audit-bundle.ts`, `sim/bot/audit-hand.ts`, `sim/bot/make-range-fixture.ts`.
- Not changed: reading the page, button classification, turn order, blinds, the legal-action rules, the executor.

## Limits of this audit

- Fixes were verified by replaying recorded observations, not on the live site. The recording is one user's
  sessions at seven tables.
- Hands already stored in your browser keep their old status. They are not re-evaluated, because the stored
  summaries do not hold the observations. New hands get the new checks.
- Opponent profiles built while the old code was running left out the hands it marked invalid (mostly all-in
  hands), so showdown and all-in statistics from that period are thinner than they should be. They are not wrong.
- A showdown where the winner does not show either, and a pot paid differently when a player then leaves, remain
  unverifiable and are reported as such.
- "Won at showdown" in a profile uses the result settled from the cards shown, so it is wrong for the rare hand
  that was run twice and paid differently.
