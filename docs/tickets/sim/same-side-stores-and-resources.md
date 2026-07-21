# Extend the same-side rule to store delivery, store fetching, and resource gathering

**Area:** sim (economy) · **Priority:** P2

The `sameSide` friend/foe rule (`components/ownership.ts`) is applied to the construction-site pick
(`nearestConstructionSite`), the site-delivery routing (`nearestConstructionSiteNeeding`), and the
JobSystem staffing/adoption. It is **not yet** applied to the general store and resource paths, so a
settler could still:

- deliver a harvested/hauled good into another player's warehouse (`nearestStoreFor` /
  `deliveryTargetFor` rungs 3/5, `packages/sim/src/systems/agents/economy/routing.ts`;
  `nearestStoreFor`/`nearestStoreHolding` in `targets/stores/stock.ts`),
- fetch construction material or a recipe input from another player's store
  (`nearestStoreHolding`, the builder self-supply in `economy/builder.ts` and the workshop supplier),
- gather from / haul another player's dropped piles or resource nodes (the gatherer/porter rungs).

The user's rule is "all logic" — a settler works only its own side. The reported cases (build,
farm/workshop staffing) are covered; this is the completeness sweep. (Absorbs the older
store-tribe-filter ticket, deleted 2026-07-14: same gap, pre-ownership vocabulary.)

## Scope

- Thread `owner` (already on `PlannerContext`) into the store scans (`nearestStoreFor`,
  `nearestStoreHolding`) and the resource/pile scans, gating each candidate with `ownersCompatible`
  (buildings/piles carry an `Owner`; a neutral one stays usable by anyone, keeping goldens intact).
- Make a settler's dropped pile inherit its owner, matching the original's ownership rule. Explicitly
  neutral drops remain usable by either side.
- Sweep every economy nearest-X pick under `agents/targets/*` and `agents/economy/*`, not just the
  three cases above; prefer gating at the candidate-collection seam so all picks inherit it, over
  per-scan filters. Check per pick whether the `tribe` gate that `nearestConstructionSite` already
  applies belongs there too (`tribe` decides look/rules, `Owner.player` decides side — they are separate axes).
- Add a two-player scene/test (like the `sameSide` construction test in
  `construction-system/delivery.cases.ts`) proving a hauler ignores an enemy store and an enemy pile.

## Verify

- `npm test` (goldens must not move — all golden fixtures are neutral); a two-player headless assertion.
