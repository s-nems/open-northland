# Confine the remaining autonomous drives to the signpost navigation area

**Area:** sim (signposts / agents) · **Origin:** signposts feature branch audit, 2026-07-16 · **Priority:** P2

Full audit result (2026-07-16, feature branch): the confinement seam (`navigationLimitFor` /
`cellGateOf`, built once per settler as `plan.limit` in `agents/ai.ts`) is threaded end-to-end into
the builder site+fetch picks, the gatherer harvest/collect picks, the producer/workshop-supplier
input fetch, and the `moveUnit`/`setWorkFlag` order gates. Scouts and fighters are exempt by design.
These drive families still search with NO gate — the query functions do not even take one:

- **Needs satisfiers** (`drives-needs.ts`): eat — `nearestFoodStore` + wild-bush fallback
  `nearestRipeBush` (`targets/food.ts`); pray — `nearestTemple` (`targets/stores/buildings.ts`).
  A hungry settler walks to any food on the map.
- **Empty-handed hauler pickups**: porter `nearestGroundPile` (`economy/haul-targets.ts`) and
  carrier `nearestWorkplaceOutput` (`targets/stores/outputs.ts`). These are fresh target
  acquisitions, not carried-load exemptions.
- **Carried-load delivery sinks** (`routing.ts` `deliveryTargetFor`, `delivery.ts` `planDelivery`):
  `nearestStoreFor`, `nearestConstructionSiteNeeding`, `nearestFreeYardNode`. Deliberately ungated
  today (named approximation in `planner-context.ts`: goods must not strand mid-haul); confining
  needs an explicit stranding decision (drop in place? hold?).
- **Job/workplace assignment** (`economy/jobs/system.ts` `openJobAt`/`openPostFor`, plus the player
  `assignWorker` path in `orders/work.ts`): first-open-match in canonical id order — not spatial at
  all, and unconfined. A settler can be employed by a workplace outside its area.
- **Gatherer own-drop pickup** `nearestOwnDropFor` (`targets/resources.ts`): no gate parameter;
  low-risk (matches only drops the gatherer itself made) but inconsistent.
- Farmer field-loop targets are unconfined but intrinsically bounded to the bound farm's
  `fieldRadius` — fine as-is unless a farm can be bound across the area edge.

Source basis: observed original behaviour — settlers do not act outside the guidepost network at
all; every split above is ours, not the original's.

## Scope

- Thread `cellGateOf(plan.limit)` (or `navigationLimitFor`) into each family above, with an explicit
  decision on the delivery stranding case and on job assignment (skip out-of-area openings vs.
  leave assignment global).
- Keep default-off behaviour byte-identical (goldens untouched); extend
  `packages/sim/test/signposts/navigation.test.ts` per family.

## Verify

`npm test` (goldens unmoved), new navigation tests cover each family on/off.
