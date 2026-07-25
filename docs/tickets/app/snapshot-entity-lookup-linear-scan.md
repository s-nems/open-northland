# Stop the app's per-frame snapshot entity lookups from scanning the whole map

**Area:** app (game/snapshot reads) · **Priority:** P2

`packages/app/src/game/snapshot-base.ts` exports `entityById` as `snapshot.entities.find(...)`, a
linear scan over every entity on the map. It is called several times per resolve from
`menu-state.ts`, `house-highlight.ts`, `assign-highlight.ts` and `hud/details-panel/model/index.ts`,
and `settler-actions.ts` reaches that path every frame while the action ring is open;
`snapshot-family.ts` `hasEligiblePartner` adds a full `snapshot.entities.some(...)` per such frame.
On a decoded map that is tens of thousands of iterations per frame to resolve a handful of ids.

`packages/render/src/data/scene/snapshot-index.ts` now has a binary-search `entityById` over the
canonical ascending-id `entities` array (`World.canonicalEntities()` sorts and freezes; the order is
documented on `WorldSnapshot`). App already depends on render, so this is the second real caller of
one concept, currently living under the same name in two packages.

## Scope

- Give the lookup one home and delete the duplicate. `packages/sim/src/inspect/snapshot.ts` owns the
  ascending-order invariant and both packages depend on sim, so that is the natural owner.
- Two preconditions must be fixed first, or the shared binary search silently returns `undefined`:
  - `packages/app/src/hud/details-panel/worker-sprites.ts` builds a narrowed
    `{ ...snapshot, entities: workerEntities }` whose entities come from `worker-selection.ts` in
    family-group order, not ascending id.
  - `packages/app/test/support/snapshot.ts` `snapshotOf` does not canonicalize; e.g.
    `packages/app/test/house-highlight.test.ts` builds ids `[1, 10, 2, 3]`. Sort there the way
    `packages/render/test/support/fixtures.ts` does.
- Non-goal: changing what any panel or highlight resolves.

## Verify

Existing app suites cover the callers; add a unit test that the shared lookup answers a sparse,
non-contiguous id set and returns `undefined` for a despawned id. `npm test`, `npm run check`,
`npm run build`. Human seam: open the details panel and the settler action ring in `?scene=sandbox`
and confirm highlights, worker overlay, and partner eligibility are unchanged.
