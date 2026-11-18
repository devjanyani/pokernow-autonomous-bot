## Cash-game session: decisions and calibration data

Hands in the bundle: 100; valid and observed to the end, rebuilt by the rules engine: 96; left out: 4.
Calibration part (first 60% by time): 57 hands. Evaluation part: 39 hands, never counted into a statistic.
Opponents with a profile from the calibration part: 12; hands per opponent: 52, 52, 52, 52, 49, 43, 30, 17, 16, 12, 10, 10.

### Opportunities per statistic (opponents only, calibration part)

Pooled = all opponents together. "Players with 30+" = players with at least 30 opportunities of their own, the level at which version 3 moves a knob about 60% of the way to the player's own estimate.

| Statistic | Pooled: did / chances | Pooled estimate (90% interval) | Assumed (population prior) | Players with 30+ chances | Enough to calibrate? |
|---|---|---|---|---|---|
| vpip | 107 / 390 | 27% (24%–31%) | 26% | 7 | population: yes; per player: 7 |
| pfr | 54 / 390 | 14% (11%–17%) | 18% | 7 | population: yes; per player: 7 |
| threeBet | 11 / 164 | 7% (4%–10%) | 7% | 0 | population: yes; per player: no |
| fourBet | 3 / 12 | 18% (5%–30%) | 10% | 0 | no; per player: no |
| foldTo3Bet | 3 / 12 | 39% (22%–55%) | 55% | 0 | no; per player: no |
| cbetFlop | 15 / 31 | 50% (37%–63%) | 55% | 0 | no; per player: no |
| cbetTurn | 2 / 7 | 38% (19%–57%) | 45% | 0 | no; per player: no |
| foldToCbetFlop | 7 / 22 | 36% (22%–50%) | 45% | 0 | no; per player: no |
| foldToCbetTurn | 2 / 3 | 50% (28%–72%) | 45% | 0 | no; per player: no |
| checkRaise | 3 / 37 | 8% (2%–14%) | 8% | 0 | no; per player: no |
| foldToCheckRaise | 1 / 3 | 42% (21%–64%) | 45% | 0 | no; per player: no |
| foldVsRaise | 2 / 6 | 41% (21%–60%) | 45% | 0 | no; per player: no |
| reraiseVsRaise | 0 / 6 | 5% (0%–14%) | 8% | 0 | no; per player: no |
| raiseVsBetFlop | 4 / 37 | 11% (4%–18%) | 12% | 0 | no; per player: no |
| raiseVsBetTurn | 1 / 30 | 5% (0%–11%) | 10% | 0 | no; per player: no |
| raiseVsBetRiver | 0 / 12 | 4% (0%–10%) | 8% | 0 | no; per player: no |
| foldVsBetFlop | 18 / 37 | 48% (36%–60%) | 45% | 0 | no; per player: no |
| foldVsBetTurn | 20 / 30 | 61% (49%–74%) | 45% | 0 | no; per player: no |
| foldVsBetRiver | 7 / 12 | 55% (37%–72%) | 50% | 0 | no; per player: no |
| callVsBetRiver | 5 / 12 | 42% (25%–59%) | 42% | 0 | no; per player: no |
| betWhenCheckedToFlop | 21 / 80 | 28% (20%–36%) | 40% | 0 | population: rough; per player: no |
| betWhenCheckedToTurn | 18 / 49 | 37% (27%–47%) | 38% | 0 | no; per player: no |
| betWhenCheckedToRiver | 9 / 28 | 33% (21%–45%) | 35% | 0 | no; per player: no |
| aggFreq | 53 / 127 | 41% (34%–48%) | 33% | 0 | population: rough; per player: no |
| wtsd | 23 / 93 | 25% (18%–32%) | 28% | 0 | population: rough; per player: no |
| wsd | 11 / 23 | 48% (34%–63%) | 50% | 0 | no; per player: no |

Bet sizes after the flop (opponents, calibration part): 48 bets: under 40% of the pot 27%, 40-70% 56%, 70-110% 17%, over 110% 0%

### Response frequencies by situation (calibration framework, opponents, calibration part)

Each row compares what was counted with the engine's present assumption for the same thing. "Outside" = the assumption lies outside the 90% interval of the observed frequency, after shrinkage toward it.

| Situation | Action | Observed | Estimate (90% interval) | Assumption | Outside? |
|---|---|---|---|---|---|
| facing flop large hu | fold | 2 of 5 | 43% (23%–64%) | 45% | no |
| facing flop large hu | call | 2 of 5 | 42% (22%–62%) | 43% | no |
| facing flop large hu | raise | 1 of 5 | 14% (1%–28%) | 12% | no |
| facing flop large multi | fold | 2 of 2 | 54% (31%–77%) | 45% | no |
| facing flop large multi | call | 0 of 2 | 36% (14%–58%) | 43% | no |
| facing flop large multi | raise | 0 of 2 | 10% (0%–23%) | 12% | no |
| facing flop medium hu | fold | 5 of 9 | 50% (32%–68%) | 45% | no |
| facing flop medium hu | call | 3 of 9 | 38% (21%–56%) | 43% | no |
| facing flop medium hu | raise | 1 of 9 | 12% (0%–23%) | 12% | no |
| facing flop medium multi | fold | 6 of 15 | 42% (26%–58%) | 45% | no |
| facing flop medium multi | call | 8 of 15 | 49% (33%–65%) | 43% | no |
| facing flop medium multi | raise | 1 of 15 | 9% (0%–18%) | 12% | no |
| facing flop overbet hu | fold | 2 of 5 | 43% (23%–64%) | 45% | no |
| facing flop overbet hu | call | 3 of 5 | 49% (28%–69%) | 43% | no |
| facing flop overbet hu | raise | 0 of 5 | 8% (0%–19%) | 12% | no |
| facing flop overbet multi | fold | 3 of 4 | 54% (32%–75%) | 45% | no |
| facing flop overbet multi | call | 1 of 4 | 38% (17%–58%) | 43% | no |
| facing flop overbet multi | raise | 0 of 4 | 9% (0%–20%) | 12% | no |
| facing flop small hu | fold | 1 of 6 | 34% (15%–53%) | 45% | no |
| facing flop small hu | call | 2 of 6 | 39% (20%–59%) | 43% | no |
| facing flop small hu | raise | 3 of 6 | 25% (8%–41%) | 12% | no |
| facing flop small multi | fold | 1 of 3 | 42% (21%–64%) | 45% | no |
| facing flop small multi | call | 2 of 3 | 48% (26%–70%) | 43% | no |
| facing flop small multi | raise | 0 of 3 | 10% (0%–22%) | 12% | no |
| facing river large hu | fold | 0 of 1 | 45% (22%–69%) | 50% | no |
| facing river large hu | call | 1 of 1 | 47% (24%–71%) | 42% | no |
| facing river large hu | raise | 0 of 1 | 7% (0%–19%) | 8% | no |
| facing river large multi | fold | 1 of 1 | 55% (31%–78%) | 50% | no |
| facing river large multi | call | 0 of 1 | 38% (15%–61%) | 42% | no |
| facing river large multi | raise | 0 of 1 | 7% (0%–19%) | 8% | no |
| facing river medium hu | fold | 3 of 6 | 50% (30%–70%) | 50% | no |
| facing river medium hu | call | 3 of 6 | 45% (25%–65%) | 42% | no |
| facing river medium hu | raise | 0 of 6 | 5% (0%–14%) | 8% | no |
| facing river medium multi | fold | 2 of 2 | 58% (36%–81%) | 50% | no |
| facing river medium multi | call | 0 of 2 | 35% (13%–57%) | 42% | no |
| facing river medium multi | raise | 0 of 2 | 7% (0%–18%) | 8% | no |
| facing river small hu | fold | 1 of 2 | 50% (27%–73%) | 50% | no |
| facing river small hu | call | 1 of 2 | 43% (21%–66%) | 42% | no |
| facing river small hu | raise | 0 of 2 | 7% (0%–18%) | 8% | no |
| facing turn large hu | fold | 0 of 2 | 38% (15%–60%) | 45% | no |
| facing turn large hu | call | 2 of 2 | 54% (31%–77%) | 45% | no |
| facing turn large hu | raise | 0 of 2 | 9% (0%–20%) | 10% | no |
| facing turn medium hu | fold | 10 of 16 | 56% (40%–71%) | 45% | no |
| facing turn medium hu | call | 4 of 16 | 33% (18%–48%) | 45% | no |
| facing turn medium hu | raise | 2 of 16 | 11% (2%–21%) | 10% | no |
| facing turn medium multi | fold | 6 of 8 | 58% (40%–77%) | 45% | no |
| facing turn medium multi | call | 2 of 8 | 36% (18%–54%) | 45% | no |
| facing turn medium multi | raise | 0 of 8 | 6% (0%–15%) | 10% | no |
| facing turn overbet hu | fold | 1 of 1 | 50% (26%–74%) | 45% | no |
| facing turn overbet hu | call | 0 of 1 | 41% (18%–64%) | 45% | no |
| facing turn overbet hu | raise | 0 of 1 | 9% (0%–22%) | 10% | no |
| facing turn small hu | fold | 2 of 3 | 50% (28%–72%) | 45% | no |
| facing turn small hu | call | 1 of 3 | 42% (21%–64%) | 45% | no |
| facing turn small hu | raise | 0 of 3 | 8% (0%–19%) | 10% | no |
| facing turn small multi | fold | 2 of 4 | 46% (25%–68%) | 45% | no |
| facing turn small multi | call | 2 of 4 | 46% (25%–68%) | 45% | no |
| facing turn small multi | raise | 0 of 4 | 8% (0%–18%) | 10% | no |
| open flop - hu | bet | 14 of 43 | 34% (23%–45%) | 40% | no |
| open flop - multi | bet | 11 of 47 | 26% (17%–36%) | 40% | yes |
| open river - hu | bet | 6 of 19 | 33% (19%–47%) | 35% | no |
| open river - multi | bet | 3 of 9 | 34% (17%–52%) | 35% | no |
| open turn - hu | bet | 12 of 30 | 40% (27%–52%) | 38% | no |
| open turn - multi | bet | 8 of 23 | 36% (22%–49%) | 38% | no |

### Hero's decisions after the flop

24 decisions (15 in the calibration part, 9 in the evaluation part). Version 3 applied to 15 (heads-up pots); the rest are multiway and use version 2.
Same class of action (fold / check / call / bet / raise): version 3 and version 2 13 of 15; Hero's actual action and version 2 now 21 of 24; the stored recommendation and version 2 now 23 of 24.

Situations (a decision can have several):

- large pot: 10
- multiway: 9
- delayed aggression opportunity: 4
- check-raise opportunity: 3
- river bluff-catch: 2
- Hero's bet was raised: 2
- unusual opponent size: 1
- Hero bet a middling made hand: 1

| Part | Hand | Street | Pos | Cards | Board | Pot (bb) | Facing | Situation | Hero did | Stored then | v2 now | v3 now | v3 plan |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| calibration | 13 | flop | HJ | Qs Ks | 7c 4c Tc | 10.0 | – |  | check | check | check | check | plan after check: on the turn, if the opponent bets small (1.65): fold with Hero's weakest holdings on that card, fold with Hero's weak holdings on that card, c |
| calibration | 13 | turn | HJ | Qs Ks | 7c 4c Tc Jc | 10.0 | – | delayed aggression opportunity | bet 4.0 bb | bet small (2) | bet small (2) | check | plan after check: on the river, if the opponent bets small (1.65): fold with Hero's weakest holdings on that card, call with Hero's weak holdings on that card,  |
| calibration | 17 | flop | BB | Ac 7s | 6s 6h 7h | 10.5 | – |  | bet 16.0 bb | bet overbet (8) | bet overbet (8) | bet overbet (7.88) | plan after bet overbet (7.88): if raised (large (26.79)): re-raise all-in (47.25) |
| calibration | 23 | flop | UTG+1 | Ac Ah | 3c Js 3s | 21.5 | – | multiway (4) | bet 32.0 bb | bet overbet (16) | bet overbet (16) | (v2) bet overbet (16) |  |
| calibration | 25 | flop | BB | Kc 2c | 8h Qc 4d | 11.5 | 3.0 bb | check-raise opportunity | fold | fold | fold | fold |  |
| calibration | 27 | flop | BTN | 8s 8h | 5d 9h Ah | 11.5 | – | multiway (3) | check | check | check | (v2) check |  |
| calibration | 27 | turn | BTN | 8s 8h | 5d 9h Ah Th | 11.5 | – | delayed aggression opportunity; multiway (3) | check | check | check | (v2) check |  |
| calibration | 27 | river | BTN | 8s 8h | 5d 9h Ah Th 8c | 20.1 | 8.6 bb | river bluff-catch; multiway (3) | raise 17.3 bb | call | call | (v2) call |  |
| calibration | 36 | flop | BTN | Qs Qd | As 9d 8s | 50.5 | – | large pot | check | check | check | check | plan after check: on the turn, if the opponent bets small (8.33): fold with Hero's weakest holdings on that card, fold with Hero's weak holdings on that card, c |
| calibration | 36 | turn | BTN | Qs Qd | As 9d 8s 5c | 50.5 | – | delayed aggression opportunity; large pot | check | check | check | check | plan after check: on the river, if the opponent bets small (8.33): fold with Hero's weakest holdings on that card, raise all-in (81.85) with Hero's weak holding |
| calibration | 36 | river | BTN | Qs Qd | As 9d 8s 5c 3d | 50.5 | – | delayed aggression opportunity; large pot | check | check | check | check |  |
| calibration | 44 | flop | BTN | Ts Qc | 2s 7h Th | 51.0 | 25.5 bb | large pot; multiway (3) | raise 68.0 bb | raise medium (34) | raise large (51) (close) | (v2) raise large (51) |  |
| calibration | 44 | turn | BTN | Ts Qc | 2s 7h Th 8c | 164.6 | 3.1 bb | unusual opponent size (2% of the pot); large pot | call | call | call | call |  |
| calibration | 45 | flop | CO | 2s 7c | Js 7s Kh | 19.0 | – | Hero bet a middling made hand | bet 6.0 bb | bet small (3) | check (close) | check | plan after check: on the turn, if the opponent bets small (3.14): call with Hero's weakest holdings on that card, call with Hero's weak holdings on that card, c |
| calibration | 45 | turn | CO | 2s 7c | Js 7s Kh 7h | 31.0 | – |  | bet 46.0 bb | bet overbet (23) | bet overbet (23) | bet large (15.5) | plan after bet large (15.5): if raised (large (60.03)): call |
| evaluation | 60 | flop | SB | 6h 8h | Qh 9s Ac | 27.0 | 8.0 bb | check-raise opportunity; multiway (3) | fold | fold | fold | (v2) fold |  |
| evaluation | 69 | flop | BTN | 6s Ts | Kh Qh 3s | 21.0 | – | multiway (3) | check | check | check | (v2) check |  |
| evaluation | 69 | turn | BTN | 6s Ts | Kh Qh 3s 4s | 36.7 | 15.7 bb |  | call | fold | fold | call | plan after call: on the river, if the opponent bets small (8.66): fold with Hero's weakest holdings on that card, call with Hero's weak holdings on that card, c |
| evaluation | 69 | river | BTN | 6s Ts | Kh Qh 3s 4s 9h | 78.7 | 26.2 bb | river bluff-catch; large pot | fold | fold | fold | fold |  |
| evaluation | 72 | flop | LJ | Kd Kc | 5c 5s 9d | 14.0 | – |  | bet 22.0 bb | bet overbet (11) | bet overbet (11) | bet overbet (10.5) | plan after bet overbet (10.5): if raised (large (35.7)): call |
| evaluation | 85 | flop | UTG+2 | Jh Jc | Qd 7c 8d | 198.6 | 37.5 bb | Hero's bet was raised; large pot | call | call all-in | call all-in | call all-in |  |
| evaluation | 86 | flop | UTG+1 | Jc Th | 9s Kh 8d | 54.5 | – | large pot; multiway (4) | check | check | check | (v2) check |  |
| evaluation | 86 | flop | UTG+1 | Jc Th | 9s Kh 8d | 133.0 | 60.0 bb | check-raise opportunity; large pot; multiway (3) | fold | fold | fold (close) | (v2) fold |  |
| evaluation | 99 | flop | SB | 2h 7h | 6d 5c 8h | 245.2 | 64.6 bb | Hero's bet was raised; large pot | call | call all-in | call all-in | call all-in |  |
