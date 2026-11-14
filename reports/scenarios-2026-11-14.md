# Decision scenarios

36 scenarios, 3000 Monte Carlo deals per postflop decision, blinds 10/20. EV in chips relative to folding.
Solver references available: 0 of 36 (none imported; see docs/bot/STRATEGY_LIBRARY.md for the data needed).

## Design set (looked at while changing the engine)

| Scenario | Board, hand, pot | Version 1 | Version 2 | Properties (v1) | Properties (v2) | Solver reference |
|---|---|---|---|---|---|---|
| BB called a BTN open, flop K95 rainbow, bottom pair, first to act | Kh 9d 5s, 5c 4c, 110 | bet small (36) | bet small (36) | 3/4 | 4/4 | none |
| Mirror: Hero is the BTN raiser with the same bottom pair, checked to | Kh 9d 5s, 5c 4c, 110 | bet large (110) | bet small (36) | 2/2 | 2/2 | none |
| Three-way single-raised pot, flop Kh 9h 5d, bottom pair in the big blind | Kh 9h 5d, 5c 4c, 160 | bet small (53) | check | 2/3 | 3/3 | none |
| Limped pot, checked to Hero on the button with bottom pair, flop K95 rainbow | Kh 9d 5s, 5c 4c, 70 | bet large (70) | bet small (23) | 2/2 | 2/2 | none |
| The recorded hand rebuilt: UTG limp-called a MP raise with 5d 3h, BB also called; flop 5h 9d Kh; BB checks | 5h 9d Kh, 3h 5d, 280 | bet small (92) | check (bets 25%) | 3/5 | 5/5 | none |
| BTN raiser, AQ on Q72 rainbow, checked to | Qs 7d 2c, Ah Qd, 110 | bet overbet (165) | bet overbet (165) | 2/2 | 2/2 | none |
| BTN raiser, AQ on Qh Jh 9c, checked to | Qh Jh 9c, As Qd, 110 | bet overbet (165) | bet medium (73) | 2/2 | 2/2 | none |
| Turn, gutshot only, opponent moves all-in for more than half the pot (no implied odds exist) | Ah Td 6s Kd, 8c 7c, 360 | fold | fold | 3/3 | 3/3 | none |
| BB with an open-ended straight flush draw facing a continuation bet | 9h 6h 2c, 8h 7h, 180 | raise large (320) | raise large (320) | 2/2 | 2/2 | none |
| Five-way limped pot, BB with middle pair on T98 (the recorded 8d 3s hand, simplified) | 9d 8c Th, 8d 3s, 100 | bet small (33) | check | 2/3 | 3/3 | none |
| BTN raiser with J9 high on A72 rainbow, checked to (continuation bet spot) | Ah 7d 2s, Jc 9c, 110 | bet overbet (165) | check | 2/3 | 3/3 | none |
| BB caller with the same J9 high on A72 rainbow, first to act into the raiser | Ah 7d 2s, Jc 9c, 110 | check | check | 2/2 | 2/2 | none |
| CO raiser bet the flop with top pair and was called; blank turn; out of position against the button | Kh 8d 3s 2c, Ac Kd, 250 | bet overbet (375) | bet overbet (375) | 3/3 | 3/3 | none |
| Same line with ace-queen high (missed) | Kh 8d 3s 2c, Ac Qd, 250 | bet small (83) | check | 2/2 | 2/2 | none |
| BB with second pair facing a half-pot river bet after two checked streets | Ks Jc 4d 7h 2s, Jd Th, 170 | raise medium (187) | raise medium (187) | 3/3 | 3/3 | none |
| Seven high facing a three-times-pot river bet after two checked streets | Ah Kd Qc Js 4h, 7s 2d, 530 | fold | fold | 4/4 | 4/4 | none |
| Hero cold-called a raise with 9s 2s (advice was fold) and flops two pair; facing a bet | 9h Kh 2c, 9s 2s, 190 | raise large (310) | raise large (310) | 2/3 | 3/3 | none |
| Same call with 9s 2s, flop A K 7 without a spade; facing a bet | Ah Kd 7c, 9s 2s, 190 | fold | fold | 2/3 | 3/3 | none |
| Missed continuation-bet spot against a player who folds 5% of the time | Ah 7d 2s, Jc 9c, 110 | check (bets 24%) | check | 2/2 | 2/2 | none |
| Same spot against a player who folds 85% of the time | Ah 7d 2s, Jc 9c, 110 | bet overbet (165) | bet overbet (165) | 3/3 | 3/3 | none |
| Top pair top kicker on the river against the calling station | Qs 7d 2c 4h 9c, Ah Qd, 470 | bet large (470) | bet overbet (705) | 2/2 | 2/2 | none |
| Same river against the frequent folder | Qs 7d 2c 4h 9c, Ah Qd, 470 | bet large (470) | check (bets 7%) | 3/3 | 3/3 | none |
| BB with top pair on a dry board against a raiser who has bet 5% of flops in 200 hands | Kh 8d 3s, Kc Jd, 110 | bet overbet (165) | bet overbet (165) | 3/3 | 3/3 | none |
| Same spot against an unknown raiser | Kh 8d 3s, Kc Jd, 110 | bet overbet (165) | bet overbet (165) (bets 95%) | 2/2 | 2/2 | none |
| CO raiser with ace-queen high on J72, one caller, out of position | Jh 7d 2s, Ac Qd, 130 | bet small (43) | bet small (43) (bets 93%) | 2/2 | 2/2 | none |
| Same hand and board with three callers | Jh 7d 2s, Ac Qd, 200 | bet small (66) | check | 2/2 | 2/2 | none |

## Held-out set (written afterwards, not used for tuning)

| Scenario | Board, hand, pot | Version 1 | Version 2 | Properties (v1) | Properties (v2) | Solver reference |
|---|---|---|---|---|---|---|
| BB flops bottom set on K95 two-tone against a BTN raiser | Kh 9h 5s, 5c 5d, 110 | bet overbet (165) | bet overbet (165) | 4/4 | 4/4 | none |
| Same spot with bottom pair | Kh 9h 5s, 5c 4c, 110 | bet small (36) | bet small (36) | 3/3 | 3/3 | none |
| Nut flush on the river facing a pot-sized bet | Kh 9h 4s 2c 7h, Ah 5h, 470 | raise all-in (1890) | raise large (950) | 3/3 | 3/3 | none |
| Nut flush draw facing an all-in on the flop from a short stack: a pure pot-odds decision | Ks 9s 2d, As 4s, 340 | fold | call | 1/3 | 3/3 | none |
| The raiser checked the flop back; BB on the turn with middle pair (probe spot) | Qs Th 4c 3d, Td 9d, 110 | bet large (110) | bet medium (73) | 2/3 | 3/3 | none |
| Hero raised, checked the flop back, and is checked to again on the turn | Ks 8h 4c 3d, Ad Jd, 110 | bet small (36) | bet small (36) | 2/2 | 2/2 | none |
| Three-bet pot, Hero (BB, the 3-bettor) with queens on J-high dry board | Jh 6d 2s, Qc Qd, 450 | bet overbet (675) | bet overbet (675) | 3/4 | 4/4 | none |
| Same three-bet pot with ace-king high | Jh 6d 2s, Ac Kd, 450 | bet small (149) | bet small (149) | 2/2 | 2/2 | none |
| Four-way pot, middle pair facing a bet and a call with one player behind | Kd 9h 4s, 9c 8c, 450 | call | fold | 1/1 | 1/1 | none |
| Two-player table: BB with top pair facing a continuation bet | Kh 8d 3s, Kc 7d, 160 | raise large (280) | raise medium (181) (bets 59%) | 2/2 | 2/2 | none |

## Property checks

Version 1: 85 of 97 hold. Version 2: 97 of 97 hold.

Failed under version 1:
- oop-caller-bottom-pair-dry: explanation names the raiser, the betting lead and Hero being out of position
- bottom-pair-wet-multiway: EV(check) >= 0: checking cannot be worth less than folding
- recorded-bottom-pair-lead: flags that Hero's hand is outside the range of the line taken
- recorded-bottom-pair-lead: identifies the preflop raiser as holding the lead
- middle-pair-5way-limped: EV(check) >= 0: checking cannot be worth less than folding
- air-with-initiative: explanation says Hero holds the lead
- off-range-call-hits-two-pair: flags the hand as outside the range of the line
- off-range-call-misses: flags the hand as outside the range of the line
- ho-allin-flop-draw: closing call: EV(call) equals equity x (pot + call) - call within sampling error
- ho-allin-flop-draw: closing call: calls when equity beats the price, folds when it does not (raising aside)
- ho-probe-after-check-back: explanation says nobody holds the lead after the flop was checked through
- ho-3bet-pot-overpair: recognises the three-bet pot and Hero as aggressor

Failed under version 2:
- none

## Observations (plausible comparisons that are not theorems; reported, not asserted)

Version 1: 5 of 5 hold. Version 2: 3 of 5 hold.

Not holding under version 2:
- ip-raiser-bottom-pair-dry: betting is at least as attractive with the lead and position as leading into the raiser out of position
- bottom-pair-limped-ip: bottom pair is at least as keen to bet in position in a limped pot (nobody has the lead) as into a raiser out of position

## Detail (version 2)

### oop-caller-bottom-pair-dry: BB called a BTN open, flop K95 rainbow, bottom pair, first to act
- v1: check 26.4, bet small (36) 36.7, bet medium (73) 28.6, bet large (110) 19.8, bet overbet (165) 1.9
- v2: check 27.1, bet small (36) 41.8, bet medium (73) 34.9, bet large (110) 26.9, bet overbet (165) 12.7
  - spot: single-raised pot, last preflop raiser P0; P0 holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 17.7
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: lead (donk bet); purpose: thin bet: marginal against the hands that call
  - modelled responses: all fold 30%, call 60%, raise 10%; Hero wins 43% at showdown against the hands that call; plan: fold if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- property holds: does not fold when checking is free
- property holds: explanation names the raiser, the betting lead and Hero being out of position

### ip-raiser-bottom-pair-dry: Mirror: Hero is the BTN raiser with the same bottom pair, checked to
- v1: check 72.9, bet small (36) 90.6, bet medium (73) 97.2, bet large (110) 98.8, bet overbet (165) 96.3
- v2: check 60.2, bet small (36) 68.3, bet medium (73) 65.0, bet large (110) 58.2, bet overbet (165) 47.1
  - spot: single-raised pot, Hero was the last preflop raiser; Hero holds the betting lead; Hero is in position against 1 opponent(s); stack-to-pot 17.7
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: continuation bet; purpose: thin bet: marginal against the hands that call
  - modelled responses: all fold 43%, call 48%, raise 9%; Hero wins 50% at showdown against the hands that call; plan: fold if raised
  - out-of-distribution: Hero's hand is not in the range the model gives this preflop line (open). No chart is looked up for it: the decision is an explicit range and equity calculation for the cards actually held. Opponents are modelled as if they did not know this, so treat it as lower confidence
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- observation DOES NOT HOLD: betting is at least as attractive with the lead and position as leading into the raiser out of position

### bottom-pair-wet-multiway: Three-way single-raised pot, flop Kh 9h 5d, bottom pair in the big blind
- v1: check -3.8, bet small (53) 6.5, bet medium (106) -18.6, bet large (160) -46.5, bet overbet (240) -89.6
- v2: check 18.6, bet small (53) 8.3, bet medium (106) -16.6, bet large (160) -42.1, bet overbet (240) -80.5
  - spot: single-raised pot, last preflop raiser P5; P5 holds the betting lead; Hero is out of position against 2 opponent(s); stack-to-pot 12.2
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 2 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - check: an opponent bets behind in 55% of deals; plan: fold if an opponent bets
  - out-of-distribution: Hero's hand is not in the range the model gives this preflop line (bb-defend). No chart is looked up for it: the decision is an explicit range and equity calculation for the cards actually held. Opponents are modelled as if they did not know this, so treat it as lower confidence
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- property holds: does not fold when checking is free

### bottom-pair-limped-ip: Limped pot, checked to Hero on the button with bottom pair, flop K95 rainbow
- v1: check 34.1, bet small (23) 46.7, bet medium (46) 51.9, bet large (70) 52.2, bet overbet (105) 48.4
- v2: check 27.8, bet small (23) 32.1, bet medium (46) 30.1, bet large (70) 24.3, bet overbet (105) 15.2
  - spot: limped pot (no preflop raiser); nobody holds the betting lead; Hero is in position against 2 opponent(s); stack-to-pot 28.3
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 2 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: bet (no aggressor); purpose: protection / thin value bet: ahead of the ranges now, about even or behind when called
  - modelled responses: all fold 19%, call 67%, raise 14%; Hero wins 49% at showdown against the hands that call; plan: fold if raised
  - out-of-distribution: Hero's hand is not in the range the model gives this preflop line (limp). No chart is looked up for it: the decision is an explicit range and equity calculation for the cards actually held. Opponents are modelled as if they did not know this, so treat it as lower confidence
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- observation DOES NOT HOLD: bottom pair is at least as keen to bet in position in a limped pot (nobody has the lead) as into a raiser out of position

### recorded-bottom-pair-lead: The recorded hand rebuilt: UTG limp-called a MP raise with 5d 3h, BB also called; flop 5h 9d Kh; BB checks
- v1: check 29.7, bet small (92) 45.0, bet medium (185) 13.5, bet large (280) -22.1, bet overbet (420) -84.9
- v2: check 32.3, bet small (92) 30.3, bet medium (185) -8.8, bet large (280) -50.5, bet overbet (420) -105.6
  - spot: single-raised pot, last preflop raiser P5; P5 holds the betting lead; Hero is in between against 2 opponent(s); stack-to-pot 9.7
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 2 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - check: an opponent bets behind in 52% of deals; plan: fold if an opponent bets
  - out-of-distribution: Hero's hand is not in the range the model gives this preflop line (call-open). No chart is looked up for it: the decision is an explicit range and equity calculation for the cards actually held. Opponents are modelled as if they did not know this, so treat it as lower confidence
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- property holds: does not fold when checking is free
- property holds: flags that Hero's hand is outside the range of the line taken
- property holds: identifies the preflop raiser as holding the lead

### top-pair-dry-ip: BTN raiser, AQ on Q72 rainbow, checked to
- v1: check 98.0, bet small (36) 124.3, bet medium (73) 133.6, bet large (110) 138.7, bet overbet (165) 141.2
- v2: check 127.2, bet small (36) 148.5, bet medium (73) 168.0, bet large (110) 181.5, bet overbet (165) 198.5
  - spot: single-raised pot, Hero was the last preflop raiser; Hero holds the betting lead; Hero is in position against 1 opponent(s); stack-to-pot 17.7
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: continuation bet; purpose: value bet: ahead of the hands that call
  - modelled responses: all fold 65%, call 28%, raise 7%; Hero wins 86% at showdown against the hands that call; plan: continue if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- observation holds: betting top pair top kicker for value is worth more than checking it

### top-pair-wet-ip: BTN raiser, AQ on Qh Jh 9c, checked to
- v1: check 84.8, bet small (36) 109.5, bet medium (73) 123.6, bet large (110) 130.8, bet overbet (165) 134.6
- v2: check 95.0, bet small (36) 98.5, bet medium (73) 99.7, bet large (110) 98.9, bet overbet (165) 97.5
  - spot: single-raised pot, Hero was the last preflop raiser; Hero holds the betting lead; Hero is in position against 1 opponent(s); stack-to-pot 17.7
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: continuation bet; purpose: value bet: ahead of the hands that call
  - modelled responses: all fold 52%, call 41%, raise 7%; Hero wins 66% at showdown against the hands that call; plan: fold if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding

### gutshot-allin-bad-price: Turn, gutshot only, opponent moves all-in for more than half the pot (no implied odds exist)
- v1: fold 0.0, call -89.7
- v2: fold 0.0, call -84.9
  - spot: single-raised pot, last preflop raiser P0; P0 holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 0.0
  - calculated approximation: Monte Carlo EV of 2 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
- property holds: returns a legal action with frequencies summing to 1
- property holds: closing call: EV(call) equals equity x (pot + call) - call within sampling error
- property holds: closing call: calls when equity beats the price, folds when it does not (raising aside)

### combo-draw-facing-cbet: BB with an open-ended straight flush draw facing a continuation bet
- v1: fold 0.0, call 59.9, raise medium (208) 73.8, raise large (320) 78.3
- v2: fold 0.0, call 63.8, raise medium (208) 95.9, raise large (320) 108.3
  - spot: single-raised pot, last preflop raiser P0; P0 holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 10.4
  - calculated approximation: Monte Carlo EV of 4 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: raise; purpose: value bet: ahead of the hands that call
  - modelled responses: all fold 45%, call 46%, raise 9%; Hero wins 59% at showdown against the hands that call; plan: continue if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: does not fold a 15-out draw getting better than 2 to 1

### middle-pair-5way-limped: Five-way limped pot, BB with middle pair on T98 (the recorded 8d 3s hand, simplified)
- v1: check -15.5, bet small (33) -8.9, bet medium (66) -30.3, bet large (100) -52.8, bet overbet (150) -83.3
- v2: check 6.5, bet small (33) -10.7, bet medium (66) -33.0, bet large (100) -55.4, bet overbet (150) -88.4
  - spot: limped pot (no preflop raiser); nobody holds the betting lead; Hero is in between against 4 opponent(s); stack-to-pot 19.8
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 4 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - check: an opponent bets behind in 61% of deals; plan: fold if an opponent bets
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- property holds: does not fold when checking is free

### air-with-initiative: BTN raiser with J9 high on A72 rainbow, checked to (continuation bet spot)
- v1: check 43.7, bet small (36) 49.7, bet medium (73) 51.8, bet large (110) 56.2, bet overbet (165) 66.3
- v2: check 27.5, bet small (36) 25.2, bet medium (73) 15.6, bet large (110) 8.9, bet overbet (165) -2.1
  - spot: single-raised pot, Hero was the last preflop raiser; Hero holds the betting lead; Hero is in position against 1 opponent(s); stack-to-pot 17.7
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - check: nobody is left to bet behind Hero on this street
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- property holds: explanation says Hero holds the lead

### air-without-initiative: BB caller with the same J9 high on A72 rainbow, first to act into the raiser
- v1: check 9.3, bet small (36) -0.8, bet medium (73) -18.0, bet large (110) -29.9, bet overbet (165) -43.8
- v2: check 13.7, bet small (36) 10.4, bet medium (73) -3.8, bet large (110) -15.1, bet overbet (165) -30.0
  - spot: single-raised pot, last preflop raiser P0; P0 holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 17.7
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - check: an opponent bets behind in 61% of deals; plan: fold if an opponent bets
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- observation holds: a pure bluff is no more attractive when leading into the raiser than as a continuation bet in position

### turn-barrel-value: CO raiser bet the flop with top pair and was called; blank turn; out of position against the button
- v1: check 292.1, bet small (83) 314.7, bet medium (165) 359.2, bet large (250) 388.5, bet overbet (375) 424.7
- v2: check 321.1, bet small (83) 316.6, bet medium (165) 353.2, bet large (250) 375.7, bet overbet (375) 387.3
  - spot: single-raised pot, Hero was the last preflop raiser; Hero holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 7.6
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: continuation bet; purpose: value bet: ahead of the hands that call
  - modelled responses: all fold 59%, call 33%, raise 8%; Hero wins 89% at showdown against the hands that call; plan: continue if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- property holds: top pair top kicker is worth at least as much as ace high in the same spot

### turn-barrel-air: Same line with ace-queen high (missed)
- v1: check 68.5, bet small (83) 101.8, bet medium (165) 76.9, bet large (250) 46.7, bet overbet (375) 1.4
- v2: check 54.2, bet small (83) 28.1, bet medium (165) -7.8, bet large (250) -36.1, bet overbet (375) -58.7
  - spot: single-raised pot, Hero was the last preflop raiser; Hero holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 7.6
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - check: an opponent bets behind in 40% of deals; plan: fold if an opponent bets
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding

### river-bluffcatch-halfpot: BB with second pair facing a half-pot river bet after two checked streets
- v1: fold 0.0, call 151.6, raise medium (187) 155.5, raise large (290) 145.0
- v2: fold 0.0, call 124.9, raise medium (187) 138.9, raise large (290) 130.1
  - spot: single-raised pot, last preflop raiser P0; nobody holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 11.1
  - calculated approximation: Monte Carlo EV of 4 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: raise; purpose: value bet: ahead of the hands that call
  - modelled responses: all fold 48%, call 45%, raise 7%; Hero wins 71% at showdown against the hands that call; plan: fold if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: closing call: EV(call) equals equity x (pot + call) - call within sampling error
- property holds: closing call: calls when equity beats the price, folds when it does not (raising aside)

### river-nothing-overbet: Seven high facing a three-times-pot river bet after two checked streets
- v1: fold 0.0, call -400.0, raise medium (912) -60.7, raise large (1330) -81.3, raise all-in (1940) -109.7
- v2: fold 0.0, call -371.3, raise medium (912) -377.0, raise large (1330) -529.0, raise all-in (1940) -721.0
  - spot: single-raised pot, last preflop raiser P0; nobody holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 2.9
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - out-of-distribution: Hero's hand is not in the range the model gives this preflop line (bb-defend). No chart is looked up for it: the decision is an explicit range and equity calculation for the cards actually held. Opponents are modelled as if they did not know this, so treat it as lower confidence
- property holds: returns a legal action with frequencies summing to 1
- property holds: closing call: EV(call) equals equity x (pot + call) - call within sampling error
- property holds: closing call: calls when equity beats the price, folds when it does not (raising aside)
- property holds: does not bluff-raise on the strength of a range that the narrowing has collapsed

### off-range-call-hits-two-pair: Hero cold-called a raise with 9s 2s (advice was fold) and flops two pair; facing a bet
- v1: fold 0.0, call 131.1, raise medium (198) 214.9, raise large (310) 252.2
- v2: fold 0.0, call 176.5, raise medium (198) 223.6, raise large (310) 243.4
  - spot: single-raised pot, last preflop raiser P4; P4 holds the betting lead; Hero is in position against 1 opponent(s); stack-to-pot 9.9
  - calculated approximation: Monte Carlo EV of 4 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: raise; purpose: value bet: ahead of the hands that call
  - modelled responses: all fold 46%, call 47%, raise 7%; Hero wins 71% at showdown against the hands that call; plan: continue if raised
  - out-of-distribution: Hero's hand is not in the range the model gives this preflop line (call-open). No chart is looked up for it: the decision is an explicit range and equity calculation for the cards actually held. Opponents are modelled as if they did not know this, so treat it as lower confidence
- property holds: returns a legal action with frequencies summing to 1
- property holds: flags the hand as outside the range of the line
- property holds: still plays the actual hand: does not fold two pair to a half-pot bet

### off-range-call-misses: Same call with 9s 2s, flop A K 7 without a spade; facing a bet
- v1: fold 0.0, call -53.1, raise medium (198) -178.4, raise large (310) -265.5
- v2: fold 0.0, call -51.4, raise medium (198) -78.7, raise large (310) -111.6
  - spot: single-raised pot, last preflop raiser P4; P4 holds the betting lead; Hero is in position against 1 opponent(s); stack-to-pot 9.9
  - calculated approximation: Monte Carlo EV of 4 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - out-of-distribution: Hero's hand is not in the range the model gives this preflop line (call-open). No chart is looked up for it: the decision is an explicit range and equity calculation for the cards actually held. Opponents are modelled as if they did not know this, so treat it as lower confidence
- property holds: returns a legal action with frequencies summing to 1
- property holds: flags the hand as outside the range of the line
- property holds: self-consistent

### bluff-vs-station: Missed continuation-bet spot against a player who folds 5% of the time
- v1: check 44.0, bet small (36) 43.3, bet medium (73) 37.5, bet large (110) 34.0, bet overbet (165) 37.1
- v2: check 30.2, bet small (36) 16.6, bet medium (73) 0.5, bet large (110) -17.7, bet overbet (165) -41.8
  - spot: single-raised pot, Hero was the last preflop raiser; Hero holds the betting lead; Hero is in position against 1 opponent(s); stack-to-pot 17.7
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - check: nobody is left to bet behind Hero on this street
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding

### bluff-vs-nit: Same spot against a player who folds 85% of the time
- v1: check 44.1, bet small (36) 70.7, bet medium (73) 80.3, bet large (110) 86.6, bet overbet (165) 92.0
- v2: check 29.7, bet small (36) 53.2, bet medium (73) 52.6, bet large (110) 52.1, bet overbet (165) 53.2
  - spot: single-raised pot, Hero was the last preflop raiser; Hero holds the betting lead; Hero is in position against 1 opponent(s); stack-to-pot 17.7
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: continuation bet; purpose: bluff or semi-bluff: behind when called, profit comes from folds
  - modelled responses: all fold 85%, call 8%, raise 6%; Hero wins 3% at showdown against the hands that call; plan: fold if raised
  - model-dependent: this bet is profitable only if opponents fold as often as the heuristic model predicts
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- property holds: a bluff is at least as attractive against the frequent folder as against the calling station

### value-vs-station: Top pair top kicker on the river against the calling station
- v1: check 470.0, bet small (155) 540.4, bet medium (310) 551.5, bet large (470) 550.4, bet overbet (705) 542.5
- v2: check 463.3, bet small (155) 562.3, bet medium (310) 623.5, bet large (470) 663.7, bet overbet (705) 698.8
  - spot: single-raised pot, Hero was the last preflop raiser; Hero holds the betting lead; Hero is in position against 1 opponent(s); stack-to-pot 3.8
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: continuation bet; purpose: value bet: ahead of the hands that call
  - modelled responses: all fold 63%, call 35%, raise 1%; Hero wins 98% at showdown against the hands that call; plan: continue if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding

### value-vs-nit: Same river against the frequent folder
- v1: check 470.0, bet small (155) 508.2, bet medium (310) 511.0, bet large (470) 511.8, bet overbet (705) 501.8
- v2: check 420.3, bet small (155) 413.1, bet medium (310) 395.2, bet large (470) 381.0, bet overbet (705) 358.0
  - spot: single-raised pot, Hero was the last preflop raiser; Hero holds the betting lead; Hero is in position against 1 opponent(s); stack-to-pot 3.8
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - check: nobody is left to bet behind Hero on this street
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- property holds: the value bet earns no more against the folder than against the station

### lead-vs-passive-raiser: BB with top pair on a dry board against a raiser who has bet 5% of flops in 200 hands
- v1: check 96.3, bet small (36) 106.2, bet medium (73) 122.9, bet large (110) 135.7, bet overbet (165) 148.5
- v2: check 128.5, bet small (36) 140.1, bet medium (73) 161.0, bet large (110) 178.1, bet overbet (165) 191.7
  - spot: single-raised pot, last preflop raiser P0; P0 holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 17.7
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: lead (donk bet); purpose: value bet: ahead of the hands that call
  - modelled responses: all fold 30%, call 62%, raise 9%; Hero wins 84% at showdown against the hands that call; plan: continue if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- property holds: leading is at least as attractive against a raiser who rarely bets as against the default raiser

### lead-vs-default-raiser: Same spot against an unknown raiser
- v1: check 101.3, bet small (36) 105.9, bet medium (73) 120.0, bet large (110) 129.8, bet overbet (165) 139.2
- v2: check 129.1, bet small (36) 119.7, bet medium (73) 129.5, bet large (110) 135.6, bet overbet (165) 138.0
  - spot: single-raised pot, last preflop raiser P0; P0 holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 17.7
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: lead (donk bet); purpose: value bet: ahead of the hands that call
  - modelled responses: all fold 56%, call 33%, raise 12%; Hero wins 79% at showdown against the hands that call; plan: continue if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding

### cbet-air-heads-up: CO raiser with ace-queen high on J72, one caller, out of position
- v1: check 34.7, bet small (43) 44.8, bet medium (86) 36.4, bet large (130) 26.0, bet overbet (195) 7.8
- v2: check 41.1, bet small (43) 43.2, bet medium (86) 32.3, bet large (130) 18.0, bet overbet (195) 2.0
  - spot: single-raised pot, Hero was the last preflop raiser; Hero holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 15.0
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: continuation bet; purpose: thin bet: marginal against the hands that call
  - modelled responses: all fold 27%, call 63%, raise 10%; Hero wins 38% at showdown against the hands that call; plan: fold if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding

### cbet-air-four-way: Same hand and board with three callers
- v1: check 6.4, bet small (66) 18.5, bet medium (132) -6.9, bet large (200) -36.4, bet overbet (300) -75.2
- v2: check 19.8, bet small (66) -4.7, bet medium (132) -42.8, bet large (200) -83.6, bet overbet (300) -137.9
  - spot: single-raised pot, Hero was the last preflop raiser; Hero holds the betting lead; Hero is in between against 3 opponent(s); stack-to-pot 9.8
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 3 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - check: an opponent bets behind in 32% of deals; plan: fold if an opponent bets
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- observation holds: a continuation bet without a made hand is no more attractive against three opponents than against one (as a fraction of the pot)

### ho-set-oop-vs-raiser: BB flops bottom set on K95 two-tone against a BTN raiser
- v1: check 120.2, bet small (36) 132.6, bet medium (73) 159.5, bet large (110) 180.6, bet overbet (165) 205.6
- v2: check 166.8, bet small (36) 181.2, bet medium (73) 218.1, bet large (110) 247.9, bet overbet (165) 287.5
  - spot: single-raised pot, last preflop raiser P0; P0 holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 17.7
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: lead (donk bet); purpose: value bet: ahead of the hands that call
  - modelled responses: all fold 51%, call 36%, raise 13%; Hero wins 92% at showdown against the hands that call; plan: continue if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- property holds: does not fold when checking is free
- property holds: a set is worth at least as much as bottom pair on the same board

### ho-bottom-pair-same-board: Same spot with bottom pair
- v1: check 24.2, bet small (36) 34.7, bet medium (73) 26.8, bet large (110) 18.2, bet overbet (165) 2.0
- v2: check 26.8, bet small (36) 40.3, bet medium (73) 32.2, bet large (110) 24.5, bet overbet (165) 11.6
  - spot: single-raised pot, last preflop raiser P0; P0 holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 17.7
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: lead (donk bet); purpose: thin bet: marginal against the hands that call
  - modelled responses: all fold 27%, call 60%, raise 12%; Hero wins 44% at showdown against the hands that call; plan: fold if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- property holds: does not fold when checking is free

### ho-river-closing-call-nuts: Nut flush on the river facing a pot-sized bet
- v1: fold 0.0, call 470.0, raise medium (631) 832.5, raise large (950) 916.7, raise all-in (1890) 933.1
- v2: fold 0.0, call 470.0, raise medium (631) 833.6, raise large (950) 948.8, raise all-in (1890) 924.3
  - spot: single-raised pot, last preflop raiser P0; nobody holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 3.5
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: raise; purpose: value bet: ahead of the hands that call
  - modelled responses: all fold 43%, call 49%, raise 8%; Hero wins 100% at showdown against the hands that call; plan: continue if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: closing call: EV(call) equals equity x (pot + call) - call within sampling error
- property holds: never folds the nuts

### ho-allin-flop-draw: Nut flush draw facing an all-in on the flop from a short stack: a pure pot-odds decision
- v1: fold 0.0, call -2.9
- v2: fold 0.0, call 54.3
  - spot: single-raised pot, last preflop raiser P5; P5 holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 0.0
  - calculated approximation: Monte Carlo EV of 2 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - call: needs 40% of the pot, raw showdown equity 50%
- property holds: returns a legal action with frequencies summing to 1
- property holds: closing call: EV(call) equals equity x (pot + call) - call within sampling error
- property holds: closing call: calls when equity beats the price, folds when it does not (raising aside)

### ho-probe-after-check-back: The raiser checked the flop back; BB on the turn with middle pair (probe spot)
- v1: check 98.2, bet small (36) 104.6, bet medium (73) 109.4, bet large (110) 109.2, bet overbet (165) 105.8
- v2: check 86.0, bet small (36) 89.6, bet medium (73) 89.2, bet large (110) 84.7, bet overbet (165) 76.8
  - spot: single-raised pot, last preflop raiser P0; nobody holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 17.7
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: probe bet; purpose: value bet: ahead of the hands that call
  - modelled responses: all fold 48%, call 42%, raise 10%; Hero wins 72% at showdown against the hands that call; plan: fold if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- property holds: explanation says nobody holds the lead after the flop was checked through

### ho-delayed-cbet: Hero raised, checked the flop back, and is checked to again on the turn
- v1: check 83.8, bet small (36) 94.0, bet medium (73) 93.5, bet large (110) 91.9, bet overbet (165) 90.5
- v2: check 68.0, bet small (36) 73.6, bet medium (73) 67.5, bet large (110) 59.3, bet overbet (165) 47.6
  - spot: single-raised pot, Hero was the last preflop raiser; nobody holds the betting lead; Hero is in position against 1 opponent(s); stack-to-pot 17.7
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: delayed continuation bet; purpose: value bet: ahead of the hands that call
  - modelled responses: all fold 42%, call 52%, raise 6%; Hero wins 51% at showdown against the hands that call; plan: fold if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding

### ho-3bet-pot-overpair: Three-bet pot, Hero (BB, the 3-bettor) with queens on J-high dry board
- v1: check 419.2, bet small (149) 452.2, bet medium (297) 528.2, bet large (450) 613.4, bet overbet (675) 642.1
- v2: check 508.5, bet small (149) 509.4, bet medium (297) 560.4, bet large (450) 599.1, bet overbet (675) 613.6
  - spot: 3-bet pot, Hero was the last preflop raiser; Hero holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 4.0
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: continuation bet; purpose: value bet: ahead of the hands that call
  - modelled responses: all fold 57%, call 35%, raise 8%; Hero wins 83% at showdown against the hands that call; plan: continue if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding
- property holds: recognises the three-bet pot and Hero as aggressor
- property holds: an overpair is worth at least as much as ace-king high in the same spot

### ho-3bet-pot-air: Same three-bet pot with ace-king high
- v1: check 156.8, bet small (149) 197.6, bet medium (297) 185.3, bet large (450) 155.4, bet overbet (675) 88.9
- v2: check 159.8, bet small (149) 212.0, bet medium (297) 183.8, bet large (450) 147.4, bet overbet (675) 91.7
  - spot: 3-bet pot, Hero was the last preflop raiser; Hero holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 4.0
  - calculated approximation: Monte Carlo EV of 5 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: continuation bet; purpose: thin bet: marginal against the hands that call
  - modelled responses: all fold 34%, call 58%, raise 8%; Hero wins 42% at showdown against the hands that call; plan: fold if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: EV(check) >= 0: checking cannot be worth less than folding

### ho-multiway-middle-pair-facing-bet: Four-way pot, middle pair facing a bet and a call with one player behind
- v1: fold 0.0, call 23.3, raise medium (434) -123.1, raise large (690) -248.3
- v2: fold 0.0, call -63.2, raise medium (434) -194.7, raise large (690) -306.0
  - spot: single-raised pot, last preflop raiser P4; P4 holds the betting lead; Hero is in position against 3 opponent(s); stack-to-pot 4.3
  - calculated approximation: Monte Carlo EV of 4 candidate actions over 3000 joint deals vs 3 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - out-of-distribution: Hero's hand is not in the range the model gives this preflop line (call-open). No chart is looked up for it: the decision is an explicit range and equity calculation for the cards actually held. Opponents are modelled as if they did not know this, so treat it as lower confidence
- property holds: returns a legal action with frequencies summing to 1

### ho-heads-up-table-flop: Two-player table: BB with top pair facing a continuation bet
- v1: fold 0.0, call 90.8, raise medium (181) 109.4, raise large (280) 111.5
- v2: fold 0.0, call 122.9, raise medium (181) 123.4, raise large (280) 118.0
  - spot: single-raised pot, last preflop raiser P0; P0 holds the betting lead; Hero is out of position against 1 opponent(s); stack-to-pot 11.8
  - calculated approximation: Monte Carlo EV of 4 candidate actions over 3000 joint deals vs 1 opponent range(s), this street and the next street's betting played out
  - heuristic: opponent ranges, their responses and Hero's own play on the next street come from the range-aware behaviour model (ranges/range-model.ts), not from a solver
  - bet type: raise; purpose: value bet: ahead of the hands that call
  - modelled responses: all fold 41%, call 52%, raise 7%; Hero wins 70% at showdown against the hands that call; plan: fold if raised
- property holds: returns a legal action with frequencies summing to 1
- property holds: does not fold top pair to a half-pot bet heads-up
