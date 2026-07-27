# Stop the action ring's centroid re-scanning the whole map every frame

**Area:** app (action ring) · **Priority:** P2

`selectionCentre` (`packages/app/src/view/unit-controls/action-ring/selection-centre.ts:25`) walks
every entity in the snapshot and keeps the ones `selection.has(e.id)` matches, to average the ring's
anchor. It runs once per RAF for as long as the ring is open (`settler-actions.ts:189` → the
`update` on `unit-controls/index.ts:301`, driven by `frame-loop.ts:206`), so on a decoded map it is a
full pass over tens of thousands of entities to place a menu around a selection that is usually one
settler. `packages/app/AGENTS.md` requires HUD controls not to scan the full world.

The sibling scan on the same path (`hasEligiblePartner`) was memoized per snapshot; this one differs
because it must re-read positions per FRAME, not per tick, so a memo is the wrong instrument. The
selection is the small side: iterate it through `entityById` instead of the world.

## Scope

- Iterate `selection` and resolve each id with `entityById`, dropping the pass over `snapshot.entities`.
- Preserve the current output: `ids` is built in snapshot order (ascending id) because the entity loop
  drives it, and it reaches the multi-scout erect-signpost order as a whole array (`input.ts:81`). A
  `Set` iterates in insertion (click) order, so sort the resolved ids before returning them.
- Non-goal: changing the centroid maths, the mixed-trade rule, or what the ring does with `ids`.

## Verify

`selectionCentre` has no direct test today. Add one that pins the centroid, the shared-vs-mixed
`jobType`, and the ascending `ids` order for a selection whose insertion order is not ascending.
`npm test`, `npm run check`, `npm run build`. Human seam: open the ring on a multi-settler selection
in `?scene=family` and confirm it still centres where it did.
