## Version 2 against version 1 at tables of independent opponents

Seed 8800, about 2400 hands per table and engine, duplicate rotation, paired by deal. bb/100 with 95% intervals; * marks a difference whose interval excludes zero.

| Table | Opponents | Hands | Version 1 | Version 2 | Version 2 minus version 1 | v1 bets when checked to / folds to a bet | v2 bets when checked to / folds to a bet |
|---|---|---|---|---|---|---|---|
| hu-caller | pot-odds-caller | 2400 | +219.5 ± 74.8 | +239.9 ± 63.4 | +20.4 ± 48.6 | 75% / 68% | 49% / 72% |
| hu-mdf | mdf-defender | 2400 | +18.9 ± 58.0 | +74.9 ± 43.7 | +56.0 ± 42.8 * | 85% / 63% | 48% / 73% |
| hu-trapper | trapper | 2400 | +19.1 ± 64.9 | +105.5 ± 46.4 | +86.4 ± 54.7 * | 83% / 56% | 49% / 65% |
| hu-maniac | maniac | 2400 | +358.4 ± 106.4 | +378.7 ± 102.1 | +20.2 ± 79.3 | 74% / 51% | 58% / 63% |
| hu-nit | nit | 2400 | +60.8 ± 29.8 | +43.3 ± 31.3 | -17.4 ± 24.7 | 91% / 54% | 89% / 49% |
| hu-punisher | adaptive-punisher | 2400 | +31.2 ± 93.6 | +119.0 ± 52.7 | +87.8 ± 77.9 * | 78% / 56% | 49% / 71% |
| six-independent | pot-odds-caller, mdf-defender, trapper, maniac, nit | 2400 | +148.3 ± 85.1 | +164.4 ± 75.6 | +16.1 ± 62.7 | 71% / 54% | 48% / 68% |
| six-punishers | adaptive-punisher, trapper, mdf-defender, adaptive-punisher, trapper | 2400 | -12.6 ± 78.3 | +56.4 ± 59.7 | +69.1 ± 58.0 * | 74% / 58% | 48% / 69% |
