# Strategy library: packs, import formats, and the data that is missing

The library is how strategy data gets into the engine. A **pack** is one local file holding strategy data together with its source and the assumptions it was produced under. Packs are bundled into the extension when it is built. Nothing is fetched at runtime, and no player data leaves the machine.

Code: `src/bot/strategy/library/` (`types.ts`, `validate.ts`, `import.ts`, `library.ts`, `builtin.ts`). Tool: `sim/bot/ranges.ts`.

```
npm run bot:ranges -- validate my-ranges.txt     # check a file, print every issue
npm run bot:ranges -- import my-ranges.txt       # validate, add to src/bot/strategy/packs/, regenerate the index
npm run bot:ranges -- remove <pack-id>
npm run bot:ranges -- list                       # packs and spots registered now
npm run bot:ranges -- coverage                   # which preflop situations have data, by table size
npm run build                                    # bundle the imported packs; then reload the extension
```

## What ships

| Pack | Content | Source label | Assumptions |
|---|---|---|---|
| `greenline-6max-100bb` | 42 preflop spots: open, isolate, big blind over limpers, defend against an open, facing a 3-bet, facing a 4-bet | chart, **not verified** | cash, six players, 60 to 150bb, no ante |
| `pekarstas-6max-100bb` | 46 preflop spots, same kinds | chart, **not verified** | same |

Both are the chart sets already present in `src/core/ranges/`. Their solver origin and licence cannot be established from this repository, and every decision that uses them says "source not verified". No solver-derived data ships. No postflop reference ships.

Two tables the engine also uses are not yet in pack form and are cited by file name in the explanation: the heads-up table (`src/core/ranges/preflop-charts.ts`) and the heads-up push/fold table (`pushfold-nash.ts`).

## How a pack is used

For Hero's own preflop decision the engine describes the actual situation: scenario, players dealt in, Hero's seat and the raiser's seat measured as players left to act, callers, limpers, effective stack, antes. The library returns the best matching spot and how well it matches:

- **exact**: every assumption of the pack holds.
- **approximation**: the spot is used outside its assumptions. Each departure is listed and shown, for example `APPROXIMATION: 6-handed data used at a 9-handed table (same number of players left to act); made for 60-150bb, effective stack is 164bb`.

It never returns a spot for a different scenario, a different Hero seat or a different raiser seat, never lends ring data to a two-player table, and never blends frequencies between spots. One documented exception: when the raiser sits earlier than the earliest seat any pack covers, the earliest covered seat is used and the explanation says so. Where nothing matches, the percentile rules decide and the explanation says `heuristic`.

Order of preference: exact before approximation, then solver data before chart data, then verified before unverified, then the pack registered first (imported packs are registered before the built-in ones).

Opponents' preflop ranges use the same packs: an open takes the raising hands of the `rfi` spot for that seat, a call or 3-bet of an open the calling or raising hands of the `vs-open` spot, and so on, widened or narrowed by the opponent's measured tendencies. A line no pack covers falls back to percentile bands.

## Pack format (version 1)

```json
{
  "format": "poker-bot-strategy-pack",
  "version": 1,
  "id": "my-6max-100bb",
  "name": "My six-max ranges",
  "revision": "2026-11-13",
  "source": { "kind": "solver", "tool": "<solver and version>", "license": "<why you may use it>", "obtained": "2026-11-01", "verified": true, "notes": "tree, sizes, accuracy" },
  "assumptions": { "format": "cash", "players": 6, "stackBB": [80, 120], "anteBB": 0, "rake": "5% capped 3bb", "openSizeBB": 2.5 },
  "positions": ["UTG", "MP", "CO", "BTN", "SB", "BB"],
  "spots": [
    { "id": "UTG-rfi", "scenario": "rfi", "hero": "UTG", "hands": { "AA": { "raise": 1 }, "A5s": { "raise": 0.5 }, "AhKd": { "raise": 1 } } },
    { "id": "BB-vs-open-BTN", "scenario": "vs-open", "hero": "BB", "villain": "BTN", "sizing": { "raiseMult": 4 }, "hands": { "KQs": { "call": 0.7, "raise": 0.3 } } }
  ],
  "references": [ { "scenario": "oop-caller-bottom-pair-dry", "frequencies": { "check": 0.97, "bet-small": 0.03 }, "setup": "ranges, bet sizes and rake of the solve" } ],
  "principles": [ { "id": "p1", "topic": "leads", "statement": "...", "source": "...", "appliedIn": "tests/bot/..." } ]
}
```

- `source.kind`: `solver`, `chart`, `calculated` (by this repository's code) or `heuristic`. `solver` and `chart` must state a licence or permission; `solver` must name the tool. `verified` is true only when you have checked the data against its source.
- `positions`: one name per player in preflop order, first to act first, blinds last. A seat is identified by how many players are left to act behind it, so a six-handed pack's `UTG` is also the seat with five players behind at a nine-handed table (as an approximation).
- `scenario`: `rfi`, `vs-limp`, `bb-vs-limp`, `vs-open`, `vs-open-call` (an open plus callers: overcall or squeeze), `vs-3bet`, `vs-squeeze`, `vs-4bet`, `cold-4bet`, `push-fold`. Optional `callers`, `limpers` and a per-spot `stackBB` narrow a spot.
- `sizing`: the raise size the frequencies assume. It is stored with the spot for reference; the engine currently uses its own sizes (2.5bb opens, 3x or 4x 3-bets), which is a known mismatch when a pack assumes others.
- `hands`: keys are hand classes (`AKs`, `77`, `T9o`) or exact combos (`AhKd`). A combo entry overrides its class, which is how combo-level mixed frequencies are stored. Frequencies are 0 to 1 and may sum to less than 1; the remainder folds. A hand that is not listed folds.
- `references`: solver action frequencies for a scenario of the scenario suite (`sim/bot/scenarios.ts`). `npm run bot:scenarios` prints them next to the engine's decision.
- `principles`: sourced postflop notes. They carry no numbers the engine acts on; they exist so that a statement taken from study material is written down with its source and the test that encodes it.

A pack with any validation error is rejected whole.

### Text format

```
@pack id=my-6max name="My six-max ranges" revision=1
@source kind=solver tool="<solver>" license="own solve" verified=yes
@assume format=cash players=6 stack=80-120 ante=0 open=2.5
@positions UTG MP CO BTN SB BB

@spot rfi hero=UTG
raise: 66+, ATs+, KTs+, QTs+, JTs, AQo+, A5s:0.5

@spot vs-open hero=BB villain=BTN raisemult=4
raise: QQ+, AKs, A5s:40%
call:  22-JJ, A2s+, K9s-K2s, 98s-65s, AhKd:0.5
```

Range syntax: `77`, `77+`, `77-44`; `ATs+`; `K9s-K6s` (same high card); `98s-65s` (same gap); `AK` (suited and offsuit); exact combos; a weight after a colon as 0 to 1 or a percentage. `#` starts a comment. An unreadable token is an error with its line number; nothing is skipped silently.

### CSV format

```
#@pack id=my-pack name="..." revision=1
#@source kind=solver tool="..." license="..." verified=yes
#@assume format=cash players=6 stack=80-120
#@positions UTG MP CO BTN SB BB
scenario,hero,villain,callers,limpers,hand,fold,call,raise,allin
rfi,UTG,,,,AA,0,0,1,0
vs-open,BB,BTN,,,KQs,0,0.7,0.3,0
```

If a row gives a fold frequency, the row must sum to 1.

## Missing data

`npm run bot:ranges -- coverage` prints the current state. In words:

| Needed | Status | What would fill it |
|---|---|---|
| Open, defend, 3-bet, 4-bet ranges for 2 to 5 and 7 to 10 players | Six-handed charts applied as approximations; seats earlier than six-max UTG by percentile rule | One pack per table size, or at least 8 to 9 handed with UTG, UTG+1, UTG+2 |
| Open plus callers (overcall, squeeze), facing a squeeze, cold 4-bet | None; percentile rule | `vs-open-call`, `vs-squeeze`, `cold-4bet` spots |
| Limped pots (iso from each seat by number of limpers, over-limp) | Raising hands only from the six-handed charts; over-limping by rule | `vs-limp` spots with `call` frequencies and `limpers` |
| Stack depths other than about 100bb (20, 30, 40, 60, 150, 200bb) | 100bb charts applied with a stated departure; 16bb and below by push/fold rules | Packs with `stackBB` per depth |
| Short-stack push/fold with more than one player behind | Stack-depth curve (heuristic) | `push-fold` spots by seat and depth |
| Antes, straddles | None | Packs with `anteBB`; straddle is not yet a pack assumption |
| Tournament play (ICM) | None; chip EV | Packs with `format: tournament`; the engine has no ICM term |
| Heads-up table | Hand-encoded table, not in pack form | A two-player pack |
| **Any postflop reference** | **None** | `references` for the scenario suite, or new scenarios with references |
| Measured population frequencies (continuation bet, fold to bet, by size and street) | Round figures | Would replace the constants in `range-model.ts` |

Nothing above has been filled with invented numbers.

## Where such data can legitimately come from

These are pointers, not endorsements; check each licence yourself before importing.

- **Your own solver runs.** Open-source solvers you can run locally: TexasSolver (postflop, AGPL), b-inary's `postflop-solver` (Rust, AGPL), and for push/fold and preflop trees commercial tools you hold a licence for (for example HoldemResources Calculator, MonkerSolver, PioSOLVER, GTO+, Simple Preflop). Export ranges as text and convert them to the text format above. Record the tree, sizes, rake and accuracy in `source.notes`.
- **Published charts** whose author permits reuse. State the permission in `source.license`.
- **This repository's preflop solver** (`src/solver/preflop/`, `npm run solve:preflop`) for heads-up trees; label the result `calculated`.

Do not scrape commercial solver sites or copy their databases. The importer has no network code and will not help with that.
