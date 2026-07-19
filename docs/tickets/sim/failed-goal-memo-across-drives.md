# Extend the failed-goal memo to the eat / store / site target picks

**Area:** sim · **Origin:** gatherer idle-loop soak review, 2026-07-19 · **Priority:** P2

`releaseStaleIntent` (`packages/sim/src/systems/agents/replan.ts`) stamps the failed-goal memo
(`UnreachableGoals`) for **every** shed route, but only the resource scans read it
(`nearestHarvestableFor`, `nearestCollectablePileFor`, `nearestOwnDropFor` in
`systems/agents/targets/resources.ts`). Every other pick still re-runs the same deterministic
nearest-first scan after a shed route and re-chooses the identical unreachable goal — the exact
park→re-pick→fail loop the memo was added to break for collectors:

- `targets/food.ts` — `nearestFood` / `nearestFoodStore`
- `targets/stores/stock.ts` — `nearestStoreFor`
- `targets/stores/buildings.ts` — `nearestConstructionSite`
- `targets/stores/outputs.ts` — `nearestWorkplaceOutput`
- `farming/targets.ts` — `nearestFarmSheaf`
- `economy/workshop/supply.ts` — the supply errand's pick

**The eat drive is the sharp one.** `nearestFoodStore` (`targets/food.ts`) applies no `componentOf`
gate at all — its bush sibling does — and starvation is lethal (`lifecycle/needs.ts`). A settler whose
nearest food store is route-blocked can loop until it dies beside a second, reachable granary. That is
the collector bug with a fatal outcome, and it is pre-existing rather than introduced by the memo.

Not reproduced in a run yet: the 40k soak only classifies gatherer trades, so it would not have seen a
starving settler. Reproducing it is part of the work.

## Scope

- Read the memo in the picks above, starting with `nearestFood`/`nearestFoodStore`, and give
  `nearestFoodStore` the `componentOf` reachability gate its bush sibling already has.
- Decide whether the memo stays drive-agnostic. It is keyed by cell alone, which is defensible (routing
  failed to reach that node, whoever wanted it) but has a cost at `UNREACHABLE_GOAL_MEMO_SIZE` = 8: a
  settler cycling through several failing delivery goals evicts its harvest exclusions and re-admits the
  doomed harvest goal early. Either accept and document it, or tag entries with the drive kind.
- Do not widen `UNREACHABLE_GOAL_MEMO_SIZE` as the answer — see
  `dynamic-route-reachability.md` for why the bound is not the lever.

## Verify

- A `packages/sim/test/agents/` scenario: a settler whose nearest food store is walled off eats from the
  second store instead of starving. Must fail without the fix.
- `npm test` — a moved golden means a pick changed for a world that already exercised one of these
  drives; name the mechanic if intended.
