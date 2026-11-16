# Development session log

Resumable record of the session that started on 2026-11-16 from commit `d950658` (v0.6.1, branch `autonomous-bot`).
Priorities, in order: (1) dashboard, popup and history management; (2) audit of the long-game recording;
(3) Phase 2.2 strategy work. Raw debug bundles stay in `debug_bundles/` (git-ignored) and are never committed.

**The session stopped early at a usage limit, in the middle of Priority 2.** Priority 1 is finished and pushed.
Priority 2 has findings but no fixes yet. Priority 3 was not started.

## Tasks completed

- Priority 1, UI and storage: done and pushed (`fd0245f`). Database v3, table manager, scoped deletion,
  redesigned Opponents / Hand review / Diagnostics / Settings / popup, experimental engine selector (default v2).
- Priority 2, tools only: `sim/bot/audit-bundle.ts` (whole-bundle audit, anonymised output) and
  `sim/bot/audit-hand.ts` (one hand, frame by frame).

## Commits

| Commit | What |
|---|---|
| `fd0245f` | Dashboard and popup redesign, table manager, deletion, database v3 |
| (this commit) | Audit tools and this checkpoint |

## Test results

- `npx vitest run tests/bot`: 298 of 298 (264 before, 34 new). The full `npm test` was NOT re-run this session.
- `npm run bot:e2e:dashboard`: 40 of 40 browser checks (`reports/e2e-dashboard-2026-11-16.md`).
- `npm run bot:e2e:recommend`: 32 of 32 (`reports/e2e-extension-recommend-only-2026-11-16.md`).
- `npm run build`: clean. Version number still 0.6.1 (not bumped; the database is at version 3).

## Priority 2 findings so far (bundle of 2026-11-16, 8 sessions, 138 recorded hands, 110 summaries)

Reproduce with `npx tsx sim/bot/audit-bundle.ts <bundle>` and `npx tsx sim/bot/audit-hand.ts <bundle> T7:h:58 --replay`.

The two results in the screenshot:

- **The large loss is real.** Hand T7:h:58: Hero lost 1,602 chips (534 big blinds at 2/3), all-in before the flop
  with 4d 6d against three players. Hero's stack went from 1,602 to 0 on the table and Hero is absent from the next
  hand. The stored recommendation at that decision was **fold** (call valued at about minus 536 bb) and it is stored
  as "shown only", so the call was not made by the extension's executor.
- **The positive total is the sum over hands marked valid only** (+848.7 bb over 55 hands). Hands marked invalid or
  unfinished are left out, and those include the two largest losses (minus 534 and minus 360 bb). Over all 82 hands
  that have a number the total is minus 30.3 bb. So the dashboard total was arithmetically right but misleading.
  It has NOT yet been checked against Hero's stack from first to last frame of each session.

Defects confirmed by reading the frames, NOT yet fixed and with no regression test yet:

1. **Uncalled bet returned during an all-in run-out marks the hand invalid** (13 of 18 invalid hands). The site
   shows the returned chips on the stack before the board is dealt; the silent stack check in
   `HandTracker.validate` (the loop that sets `this.uncertain`, about line 681 of `src/bot/adapter/tracker.ts`)
   does not allow for it. Planned fix: when nobody is left to act, accept `stack = engine stack + uncalled part of
   that seat's bet`; and write a tracker note whenever that check fires, so a hand is never invalid without a reason.
2. **A showdown where the loser mucks is stored as "ending not observed"** (for example T7:h:55, minus 360 bb, which
   was fully visible). The tracker waits for every live seat to show cards. Planned fix: when the next hand starts,
   settle with mucked hands losing and accept the result only if every seat's stack plus bet at the start of the
   next hand equals the settled stack (same seat and name); otherwise keep "ending not observed". The same check
   can confirm folds inferred because the next hand began first (13 hands).
3. **A call shown as the caller's whole stack is read as an illegal raise** (T7:h:57: "raising is not open to this
   seat"). A player calling an all-in shows 3,235 in front against a bet of 802. Planned fix in `sync` step 1: when
   the chips shown exceed the bet but no raise is legal, apply a call.

Still to look at: three hands marked "a seat folded with a free check available" (T6:h:7 is Hero folding the big
blind when a check was free, which is an action that really happened and should not invalidate the hand), T7:h:29
and T7:h:40 (cause not yet identified; both end in an all-in call at showdown), T5:h:1 (0.25 chip imbalance),
T1:h:5, the five recorded hands with no summary, the count of Hero decision points without a recommendation, seat
numbers that change when Hero leaves the table, and the placeholder routine in the audit tools replacing a short
player name inside ordinary words ("check").

Strategy observations to carry into Priority 3 (not defects in tracking): in T7:h:55 the engine raised a flop bet
from 84 to 504 with a flush draw in a three-bet pot three ways at about 900 bb deep, on a modelled EV advantage of
294 against 161 for calling; in the fixture run it recommended a flop bet with 18% equity.

## Current work

Priority 2, at the point described above. Next action: write failing tests for defects 1 to 3 from the frames of
T7:h:58, T7:h:55 and T7:h:57 (anonymised fixtures in `tests/bot/fixtures`), then fix `tracker.ts`, re-run the audit,
and write `docs/bot/LONG_SESSION_DIAGNOSTIC_AUDIT.md`.

## Known limitations

- Priority 3 (A to F) not started. `LONG_SESSION_DIAGNOSTIC_AUDIT.md` not written. `PROJECT_PROGRESS.md`,
  `CHANGELOG.md` and `docs/bot/STORAGE.md` not yet updated for the Priority 1 work.
- The dashboard was checked against the fixture table and with data copied in the browser test, not on the live site.
  The option of looking at the real bundle in the new dashboard (`e2e-dashboard.ts --bundle`) was written but not run.
- Hero's own profile appears in the Opponents list. The Tables list is not paged.
- Hands that never completed leave recommendations and frames with no hand summary; they go when the table is deleted.

## Next steps

1. Finish Priority 2 as above. 2. Update the documents and bump the version. 3. Run the full `npm test`.
4. Priority 3 items A to F in order.
