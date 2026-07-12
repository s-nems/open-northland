# Make authored bridges walkable so river banks join into one nav component

**Area:** app (+ sim nav input) · **Origin:** gathering-economy plan reconciliation, 2026-07-12

On imported maps, authored bridge objects do not open a crossing: the app's object→collision pass
only ADDS blocking (`packages/app/src/...collision.ts` — "objects only ADD blocking"), so the two
banks stay separate nav components and gatherers/carriers never route across. Named as "a
separate, larger gap" during the far-zoom gathering work.

## Scope

- Investigate-first: how the original marks bridge walkability (the decoded ground lanes vs the
  bridge object's footprint — check OpenVikings for a walk-unblock lane before inventing one).
- Let bridge objects clear/override water blocking along their span; feed the sim's `TerrainGraph`
  through the existing `halfCellMapFromCells` seam.
- Reachability caches must see the join (static component ids are precomputed — re-derive after
  the override pass).

## Verify

- Unit test: two banks + a bridge = one component; without the bridge = two.
- `?map=specjalna_mosty_na_rzece`: a settler ordered across the river routes over the bridge —
  **user's eyes**.
