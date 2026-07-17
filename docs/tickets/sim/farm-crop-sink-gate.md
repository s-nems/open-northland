# Count the farm's own store in the crop-sink reap gate

**Area:** sim · **Origin:** bug-hunt review, 2026-07-17 · **Priority:** P1

`planFarmer`'s reap/carry pause gate (`packages/sim/src/systems/agents/farming/planner.ts:176-208`,
`cropSinkExists`) asks `targets.sinks.has(spec.goodType)`. `SinkAvailability` resolves through
`canStoreGood` (`targets/stores/stock.ts:64-80`), which **unconditionally** rejects any store whose
merged recipe *outputs* the good (line 76 — this runs even with `excludeProducers = false`), so the
farm's own crop slot never counts as a sink. Yet the farmer's actual delivery routes the sheaf into
the farm's own store (`routing.ts` case 3b uses `hasRoom`/`stockCapacity` and accepts it), and the
gate's own comment says it should count "the farm's own slot, or any warehouse".

Failure scenario (unverified against real content — verify first): with pipeline-extracted content
the pipeline synthesizes a recipe for every producing building (stated at
`targets/stores/workplace.ts:44-54` and the `routing.ts` case-3 comment), so the farm's recipe
outputs its crop. If no non-producing store in range can stock the crop (no warehouse/HQ slot),
`sinks.has(crop)` stays false forever: ripe fields stand unreaped and cut sheaves lie uncollected
while the farm's own 25-unit slot sits empty — the farm sows/waters to its cap and idles, stalling
the food economy. Sandbox farms have no recipe, so goldens and scenes never see it.

## Scope

- First re-verify the premise against generated `ir.json`: does the extracted farm building carry a
  recipe outputting its crop good? If not, rewrite this ticket with the corrected fact.
- Fix the gate to match its comment and the delivery rung, e.g.
  `hasRoom(farm, good) || sinks.has(good)` (the farm's own slot short-circuits the sink probe).
- Add a headless test: a farm with a synthetic recipe outputting wheat, no other store — the farmer
  must still reap ripe fields and bank sheaves into the farm store until the slot is full, then
  pause.

## Verify

`npm test`, `npm run check`, `npm run build`; `npm run test:content` where local `content/` exists
(the real-content join is the trigger condition). Goldens should not move unless a sandbox farm
gains a recipe.
