# Stop the marry button re-scanning the whole map every frame

**Area:** app (action ring) · **Priority:** P2

`hasEligiblePartner` in `packages/app/src/game/snapshot-family.ts` answers "may this settler marry?"
with a `snapshot.entities.some(...)` over every entity, to grey one ring button. It is reached every
frame the settler action ring is open: `settler-actions.ts:214` → `menuStateFor` →
`menu-state.ts:48`. On a decoded map that is a full pass over tens of thousands of entities per
frame; measured at ~0.37 ms/frame for 50 000 entities with a trivial predicate, and the real
predicate is heavier. `packages/app/AGENTS.md` requires HUD controls not to scan the full world.

Its per-spouse lookups are already O(log n) through the shared `entityById`; this outer pass is what
remains.

## Scope

- Memoize the answer on snapshot object identity, the way
  `packages/render/src/data/scene/snapshot-index.ts` memoizes its pre-scans with a
  `WeakMap<WorldSnapshot, ...>`. The ring's inputs change per tick, so the pass should run once per
  tick, not once per frame. The answer depends on the seeker, so the memo is keyed per snapshot and
  per seeker id.
- Non-goal: changing which settlers count as eligible. The filters mirror the sim's `mayMarry` +
  `findPartnerFor`, and the KNOWN GAP recorded in the function's doc stays as it is.

## Verify

`menuStateFor` and `hasEligiblePartner` have no direct test today. Add one that pins the eligibility
verdict for a marriageable and a non-marriageable settler, and one that a second call against the
same snapshot object does not repeat the pass while a new snapshot does. `npm test`,
`npm run check`, `npm run build`. Human seam: open the settler action ring in `?scene=family` and
confirm the marry button greys and lights exactly as before.
