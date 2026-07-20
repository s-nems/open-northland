# Make an AI seat collect iron, gold and mushrooms

**Area:** packages/sim · **Origin:** fix/iron-pickup diagnostic soak, 2026-07-20 · **Priority:** P2

Over 20 000 ticks of `?map=magiczny_las&ai=0,1,2,3,4,5` (six AI seats, the `realMapWorld` harness the
gatherer soak uses), the standing-resource totals for iron (good 6), gold (7) and mushroom (14) did
**not move at all** — 15716 / 11316 / 7383 units at tick 0 and at tick 20 000 — while mud, stone and
wood drained steadily. No unit of those three goods ever reached a store, a carried load, or a ground
pile. Every smithy (`work_smithy_00`) and mint (`work_coin_mint`) an AI seat founds therefore stalls
one iron / one gold short of its extracted `LogicConstructionGoods` bill forever.

The likely cause is the workforce allocator, not the gatherer: `COLLECTED_GOOD_IDS`
(packages/sim/src/systems/ai-player/workforce.ts) is `['mud', 'stone', 'wood']`, and the only other
source of wanted collector goods is `collectorGoodsWanted` — the build order's reached `collector`
entries. Whether any seat's build order actually reaches an iron/gold/mushroom `collector` entry
within a normal game was **not** verified; that is the first thing to check. A second candidate is the
`needforgood` XP gate (`meetsNeed` / the veteran re-post loop) refusing every spare, though the map's
authored settlers start with `collector_mud` XP 10, which already clears iron's and gold's threshold
(tribe `jobRequirements`: good 6 and 7 need 10 XP summed over tracks 4+5; mushroom is ungated).

## Scope

Diagnose which of the two it is, then make an AI seat post a collector for the goods its own build
order needs. Keep the allocator's existing shape: one flag-bound gatherer per wanted good, the
`meetsNeed` gate intact (never post a collector the harvest pick would refuse), and the veteran
re-post path for XP-gated goods. Do not widen `COLLECTED_GOOD_IDS` blindly — the opening plan
(clay/stone/wood first) is a user decision, 2026-07-17; the gap is that the later goods never arrive.

## Verify

`npm test`; then re-run the diagnostic shape above (a `*.soak.ts` against `realMapWorld`, six AI
seats, ≥20 000 ticks) and assert the iron/gold node totals fall and at least one smithy completes.
Real-content only — the soak is local, never CI.
