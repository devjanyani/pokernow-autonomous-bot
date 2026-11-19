# Authorised execution and action scheduling (0.9.1)

For play-money games whose organiser allows bots (a bot-versus-bot competition). Nothing here applies anywhere else:
outside such games keep the extension in recommend or manual mode.

## 1. When the extension clicks

One function decides, `executionStatus()` / `mayAct()` in `src/bot/ext/records.ts`. Every path to a click goes through
it: the executor is armed from it on every read of the table, the scheduled action asks it again immediately before it
is executed, and the clock-out safe check / fold asks it too. All of these must hold:

| Requirement | Where it is set | Default |
|---|---|---|
| Mode is **Autonomous** | toolbar popup | Recommend |
| Emergency stop is off | popup, in-page panel, dashboard | off |
| "I confirm automated play is authorised by the organiser of the tables I authorise, and that they are play-money games" | popup | not given |
| **This table** is authorised | popup, "Authorise this table" | none |
| With version 3 selected: the separate **"Allow version 3 to act on authorised tables (experimental)"** permission | Dashboard → Settings → Strategy experiments, with a confirmation dialog | off |

Choosing version 3 never switches its execution permission on, and the permission is never inferred from the
strategy. Withdrawing the organiser confirmation in the popup clears every table authorisation **and** the version 3
permission (also enforced when settings are read: the permission cannot be stored without the confirmation).

**Real money.** The extension runs only on `pokernow.club` / `pokernow.com` game pages and cannot tell from the page
whether a game is for real money. It relies on your confirmation for each table. Do not authorise a table unless the
organiser allows bots and the game is play money.

Before the click itself the executor re-reads the table and re-checks, in order: armed; nothing else in flight; this
decision point not acted on before; a valid, trusted reconstruction with no open reconciliation blocker and enough
confidence; same hand, same street, no new event since the decision; Hero's turn on both the engine and the page; the
action legal in the rules engine, the amount inside the legal window and inside the page's own limits; the matching
control present and agreeing (for example the call amount). The decision point is marked used before the click, so an
unknown outcome never leads to a second click.

## 2. Supported states and the version 3 fallback

| State | Decided and executed by |
|---|---|
| Version 1 or 2 selected | that engine, every spot it supports |
| Version 3 selected, heads-up pot after the flop | version 3: check, fold, call, bet, raise, all-in, as legal |
| Version 3 selected, preflop | version 2, labelled "v3 -> v2 fallback" (reason: version 3 has no preflop engine) |
| Version 3 selected, two or more opponents | version 2, labelled as the fallback |
| Version 3 fails on a spot | version 2 for that decision, labelled as the fallback with the error |
| State not confirmed (blockers, turn disagreement, buttons contradict the reconstruction, low confidence, cards unread) | nobody: no decision is made; only the existing clock-out safe check / fold may act, when enabled |

A version 3 decision is never invented for a state it does not support. The executed label, the stored decision and the
dashboard all say which engine decided.

## 3. How the delay is chosen

`src/bot/ext/scheduler.ts`. Settings → **Authorised autonomous play: timing**.

| Setting | Default | Range |
|---|---|---|
| Randomised delay | on | on: uniform between minimum and maximum; off: always the minimum |
| Minimum target delay | 4 s | 0-60 s |
| Maximum target delay | 20 s | up to 120 s, raised to the minimum if lower |
| Deadline safety margin | 3 s | 0.5-10 s |
| Clock to assume when none is shown | 20 s | 3-120 s |

- The delay is drawn **once per decision opportunity** (hand, street, state version), when Hero's turn is first
  confirmed (table and engine agree, no blocker). That is before any recommendation exists, so the delay cannot depend
  on the action: folds, checks, calls, bets and raises are timed the same way.
- It is a plain uniform draw within the bounds. It is not a model of human timing and is not meant to disguise the
  bot.
- **Computation is part of the delay.** The action is due at *turn confirmed + drawn delay*; when the recommendation is
  ready the remaining time is waited. The dashboard and the stored decision show computation and waiting separately.
  If computation takes longer than the delay, the action goes as soon as the recommendation is ready (still within
  the deadline rule below).
- Repeated reads of the same opportunity reuse its plan: the delay is not redrawn and the start does not move, also
  when the page briefly stops showing Hero's turn and shows it again for the same decision point.

## 4. Deadlines

- **Observed clock** (the page shows Hero's remaining seconds): the deadline is now + the shown time, updated on every
  read. The page shows whole seconds, so the reading can be up to a second late; the margin covers this.
- **No clock shown**: the deadline is the assumed clock counted from when Hero's turn was confirmed. It is never
  treated as unlimited. With the defaults (20 s clock, 3 s margin) the latest action is 17 s after the turn began,
  so drawn delays of 17-20 s are shortened to 17 s and say so ("shortened"). Raise the assumed clock only if the
  organiser's clock is known to be longer.
- **Opened or reloaded during Hero's turn** with no clock shown: when the turn began is unknown, so the delay is the
  minimum (4 s by default) from the first confirmed read.
- **Deadline policy when the clock is shorter than the minimum** (for authorised testing): the action is due at the
  latest safe moment, *deadline - margin*, or as soon as the recommendation is ready if that moment has passed. The
  4 s minimum is then **not** met, and this is shown as "Deadline conflict" on the Live tab and in Settings, logged as
  a warning, and stored with the decision. The safety margin is never given up to reach the minimum.
- The existing clock-out safe check / fold (Advanced → "When the clock is nearly out and the state is not trusted")
  is unchanged and independent of the scheduler.

## 5. Cancellation and stale actions

A pending action is cancelled at once (the wait is woken, not left to expire) and the reason is kept and shown when:

- it is no longer Hero's turn on the table (Hero acted by hand, a timeout, a new hand);
- the hand, the street or the state version changes (for example an opponent's raise is recorded): the new decision
  point gets its own plan and a newly drawn delay;
- the state stops being confirmed (reconciliation blocker, turn disagreement, contradictory buttons, low confidence)
  or the page is mid-update;
- the emergency stop is pressed, the table's authorisation or the organiser confirmation is withdrawn, the mode
  changes, the strategy changes, the version 3 permission is withdrawn, or any setting changes;
- the page is hidden or closed (`pagehide`).

Every decision computation carries a generation number; anything that invalidates the decision point increments it,
so an older computation or wait can never act. After the wait the permission is checked again, and the executor
re-reads and re-validates the whole table (section 1); a recommendation for an earlier state version is rejected as
stale. At most one action is pending, and the executor's used-decision-point record makes a second click for the same
point impossible even if the table does not register the first. A strategy change while waiting drops the pending
action; the new engine decides the same opportunity and acts at the opportunity's original scheduled time.

After a reload the old page's pending action is gone with it; the new page starts from its own first confirmed read
(section 4).

## 6. Monitoring

- **Live tab**: "Execution enabled" / "Execution off: <reason>" next to the strategy tag; an "Authorised play:
  scheduled action" card with the pending action, the engine that decided it, the remaining delay, the drawn delay,
  computation time, the deadline and its source, any conflict, the last cancellation with its reason, and the last
  executed action with its timing.
- **Settings**: the same information under the timing settings, refreshed live.
- **Popup**: "ACTING automatically on this table with experimental version 3 (v2 for preflop and multiway)".
- Stored decisions (Hand review, debug bundle) carry `execution.timing`: drawn delay, actual delay, computation,
  waiting, deadline source, conflict.

## 7. What has been tested

- `tests/bot/scheduler.test.ts`: the scheduler alone (bounds, uniform spread, no redraw, short and unknown deadlines,
  immediate cancel) and the whole controller on a simulated table with a manual clock and seeded randomness: every
  action type, delays within bounds, a 5 s clock, no clock, repeated frames and a flicker, actor change, street change,
  an opponent raise, authorisation revoked, emergency stop, mode change, v3 to v2 switch, v3 with and without its
  permission, the preflop fallback, stale requests, duplicate prevention, page reload.
- `sim/bot/e2e-exec.ts` (Chromium, built extension, stand-in table, real time): [reports/e2e-exec-2026-11-19.md](../../reports/e2e-exec-2026-11-19.md).
- **Not tested on the live PokerNow site.** Its clock markup, its timing and whether its buttons accept the clicks at
  every moment are covered only by the selectors and the stand-in table.
