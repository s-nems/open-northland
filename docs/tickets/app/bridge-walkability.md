# Make authored bridges walkable so river banks join into one nav component

**Area:** app (+ sim nav input) · **Priority:** P2

On imported maps, authored bridge objects do not open a crossing: the app's object→collision pass
in `packages/app/src/content/collision.ts` can stamp object blocking but cannot clear the decoded
water class, so the two banks stay separate nav components and gatherers/carriers never route across.

## Scope

- Investigate first how the original marks bridge walkability: compare decoded ground lanes and the
  bridge object's footprint, then observe routing in the running original before inventing an override.
- Let bridge objects clear/override water blocking along their span; feed the sim's `TerrainGraph`
  through the existing `halfCellMapFromCells` seam.
- Reachability caches must see the join (static component ids are precomputed — re-derive after
  the override pass).

## Verify

- Unit test: two banks + a bridge = one component; without the bridge = two.
- `?map=specjalna_mosty_na_rzece`: a settler ordered across the river routes over the bridge —
  **user's eyes**.
