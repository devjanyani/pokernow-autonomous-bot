# Hero image baseline (version 2, 200 samples per decision)

Hero statistics computed by the same profile code the extension uses for opponents (opponents/profile.ts), plus river, steal and defence counts from sim/bot/v4-baseline.ts. Short sessions: rates carry wide sampling error.

### Six players: 3000 hands, seed 31000

Opponents: tight-aggressive, loose-passive, mdf-defender, raiser, nit. Hero result +152.2 bb/100 (one short session: not a strength measurement). Style label as the extension would show it: **TAG 100%**.

| statistic | Hero (raw, n/d) |
|---|---|
| vpip | 27% (764/2821) |
| pfr | 24% (667/2821) |
| rfi | 27% (464/1724) |
| limp | 0% (3/1953) |
| threeBet | 15% (127/825) |
| coldCall | 11% (94/825) |
| foldTo3Bet | 55% (46/84) |
| fourBet | 17% (14/84) |
| cbetFlop | 58% (130/223) |
| cbetTurn | 73% (61/83) |
| foldToCbetFlop | 77% (24/31) |
| checkRaise | 3% (4/122) |
| aggFreq | 66% (482/733) |
| aggVsCall | 87% (1163/1342) |
| wtsd | 39% (198/502) |
| wsd | 58% (115/198) |
| foldVsBetFlop | 71% (132/185) |
| foldVsBetTurn | 51% (35/68) |
| foldVsBetRiver | 80% (28/35) |
| betWhenCheckedToRiver | 44% (83/190) |
| raiseVsBetFlop | 13% (24/185) |
| steal (CO/BTN/SB first in) | 37% (284/758) |
| BB defends vs a single CO/BTN/SB open | 44% (42/96), mean open size 2.8bb |
| turn barrel after a flop bet | 76% (101/133) |
| river: bets/raises that are bluffs (made-hand percentile < 0.5) | 15% (13/85) |
| river: weak hand (pct < 0.35) checked to / first: bet | 11% (5/44) |
| river: facing a bet: fold | 80% (28/35) |
| river: marginal hand (0.45-0.75) facing a bet: fold | 90% (9/10) |
| river calls that won the pot | 60% (3/5) |
| showdowns won | 58% (115/198) |

| first-in raise by position | rate |
|---|---|
| BTN | 44% (119/270) |
| CO | 26% (91/346) |
| HJ | 24% (110/466) |
| SB | 52% (74/142) |
| UTG | 14% (70/500) |

Opponents in the same session (raw VPIP / PFR / aggFreq): tag 23/16/64; lp 49/7/54; mdf 30/17/20; raiser 33/19/40; nit 11/7/40

### Nine players: 3000 hands, seed 31001

Opponents: tight-aggressive, loose-passive, mdf-defender, raiser, nit, loose-aggressive, trapper, pot-odds-caller. Hero result +80.8 bb/100 (one short session: not a strength measurement). Style label as the extension would show it: **TAG 100%**.

| statistic | Hero (raw, n/d) |
|---|---|
| vpip | 17% (513/2947) |
| pfr | 14% (426/2947) |
| rfi | 16% (181/1104) |
| limp | 0% (7/1711) |
| threeBet | 12% (128/1111) |
| coldCall | 7% (80/1111) |
| foldTo3Bet | 38% (23/60) |
| fourBet | 23% (14/60) |
| cbetFlop | 60% (106/178) |
| cbetTurn | 81% (56/69) |
| foldToCbetFlop | 88% (14/16) |
| checkRaise | 3% (2/77) |
| aggFreq | 65% (370/570) |
| aggVsCall | 84% (810/963) |
| wtsd | 42% (163/387) |
| wsd | 55% (90/163) |
| foldVsBetFlop | 71% (98/138) |
| foldVsBetTurn | 56% (31/55) |
| foldVsBetRiver | 78% (31/40) |
| betWhenCheckedToRiver | 43% (57/133) |
| raiseVsBetFlop | 14% (20/138) |
| steal (CO/BTN/SB first in) | 38% (46/121) |
| BB defends vs a single CO/BTN/SB open | 39% (12/31), mean open size 2.6bb |
| turn barrel after a flop bet | 76% (79/104) |
| river: bets/raises that are bluffs (made-hand percentile < 0.5) | 5% (3/59) |
| river: weak hand (pct < 0.35) checked to / first: bet | 7% (2/28) |
| river: facing a bet: fold | 78% (31/40) |
| river: marginal hand (0.45-0.75) facing a bet: fold | 83% (15/18) |
| river calls that won the pot | 43% (3/7) |
| showdowns won | 55% (89/163) |

| first-in raise by position | rate |
|---|---|
| BTN | 44% (16/36) |
| CO | 32% (21/66) |
| HJ | 21% (25/121) |
| LJ | 16% (21/128) |
| MP | 15% (25/164) |
| SB | 47% (9/19) |
| UTG+1 | 14% (32/237) |
| UTG | 10% (32/333) |

Opponents in the same session (raw VPIP / PFR / aggFreq): tag 18/12/60; lp 36/5/46; mdf 26/15/23; raiser 29/15/38; nit 10/5/44; lag 32/20/63; trapper 35/10/24; poc 38/9/35

### Heads-up table: 3000 hands, seed 31002

Opponents: tight-aggressive. Hero result +62.5 bb/100 (one short session: not a strength measurement). Style label as the extension would show it: **LAG 100%**.

| statistic | Hero (raw, n/d) |
|---|---|
| vpip | 66% (1648/2510) |
| pfr | 46% (1157/2510) |
| rfi | 65% (981/1500) |
| limp | 0% (0/1588) |
| threeBet | 10% (88/922) |
| coldCall | 53% (491/922) |
| foldTo3Bet | 57% (27/47) |
| fourBet | 0% (0/47) |
| cbetFlop | 65% (35/54) |
| cbetTurn | 62% (8/13) |
| foldToCbetFlop | 56% (45/81) |
| checkRaise | 4% (12/286) |
| aggFreq | 63% (895/1414) |
| aggVsCall | 77% (2052/2669) |
| wtsd | 19% (170/882) |
| wsd | 64% (109/170) |
| foldVsBetFlop | 66% (217/330) |
| foldVsBetTurn | 74% (134/182) |
| foldVsBetRiver | 75% (63/84) |
| betWhenCheckedToRiver | 35% (81/230) |
| raiseVsBetFlop | 17% (55/330) |
| steal (CO/BTN/SB first in) | 65% (981/1500) |
| BB defends vs a single CO/BTN/SB open | 63% (579/922), mean open size 2.5bb |
| turn barrel after a flop bet | 53% (155/291) |
| river: bets/raises that are bluffs (made-hand percentile < 0.5) | 23% (20/86) |
| river: weak hand (pct < 0.35) checked to / first: bet | 22% (18/81) |
| river: facing a bet: fold | 75% (63/84) |
| river: marginal hand (0.45-0.75) facing a bet: fold | 72% (23/32) |
| river calls that won the pot | 56% (9/16) |
| showdowns won | 53% (90/170) |

| first-in raise by position | rate |
|---|---|
| BTN | 65% (981/1500) |

Opponents in the same session (raw VPIP / PFR / aggFreq): tag 58/39/43


---

# Hero image baseline (version 3, 200 samples per decision)

Hero statistics computed by the same profile code the extension uses for opponents (opponents/profile.ts), plus river, steal and defence counts from sim/bot/v4-baseline.ts. Short sessions: rates carry wide sampling error.

### Heads-up table: 3000 hands, seed 31002

Opponents: tight-aggressive. Hero result +69.2 bb/100 (one short session: not a strength measurement). Style label as the extension would show it: **LAG 100%**.

| statistic | Hero (raw, n/d) |
|---|---|
| vpip | 66% (1648/2510) |
| pfr | 46% (1157/2510) |
| rfi | 65% (981/1500) |
| limp | 0% (0/1588) |
| threeBet | 10% (88/922) |
| coldCall | 53% (491/922) |
| foldTo3Bet | 57% (27/47) |
| fourBet | 0% (0/47) |
| cbetFlop | 57% (31/54) |
| cbetTurn | 64% (7/11) |
| foldToCbetFlop | 25% (34/137) |
| checkRaise | 24% (89/373) |
| aggFreq | 63% (949/1497) |
| aggVsCall | 76% (2106/2785) |
| wtsd | 20% (177/882) |
| wsd | 62% (109/177) |
| foldVsBetFlop | 48% (182/376) |
| foldVsBetTurn | 57% (128/223) |
| foldVsBetRiver | 72% (71/99) |
| betWhenCheckedToRiver | 50% (138/274) |
| raiseVsBetFlop | 30% (114/376) |
| steal (CO/BTN/SB first in) | 65% (981/1500) |
| BB defends vs a single CO/BTN/SB open | 63% (579/922), mean open size 2.5bb |
| turn barrel after a flop bet | 40% (105/263) |
| river: bets/raises that are bluffs (made-hand percentile < 0.5) | 41% (60/148) |
| river: weak hand (pct < 0.35) checked to / first: bet | 56% (49/88) |
| river: facing a bet: fold | 72% (71/99) |
| river: marginal hand (0.45-0.75) facing a bet: fold | 76% (28/37) |
| river calls that won the pot | 44% (8/18) |
| showdowns won | 53% (93/177) |

| first-in raise by position | rate |
|---|---|
| BTN | 65% (981/1500) |

Opponents in the same session (raw VPIP / PFR / aggFreq): tag 58/39/45

