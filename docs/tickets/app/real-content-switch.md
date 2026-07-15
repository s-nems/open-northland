# Run the sim on real content: reconcile the terrain/navigation landscape first

**Area:** sim (nav/terrain) + app · **Origin:** real-content chain; blocker found in-browser 2026-07-15 ·
**Priority:** P1

The economy is already migrated: the sandbox ids are re-keyed to the real ir.json numbering (collector 8,
carrier 24, wood 5, stone 3, …), and `content/real-content.ts` `mergeRealContent` completes the real
content's gathering data + surfaces its gaps (built + unit-tested in `test/real-content-merge.test.ts`).
Wiring the interactive entries (`entries/scene.ts`, `entries/map.ts`) and `createSceneSim` / `runSlice`
at a `loadRuntimeRealContent()` loader is a small change — but it **crashes the sim**, because the terrain
layer speaks a different landscape id space than real content. That mismatch is the real work here.

## The blocker (verified in the browser, both `?scene=` and `?map=<real map>`)

The sim navigates on a 5-value **semantic collision-class** landscape, not the detailed landscape types:
`catalog/terrain.ts` — `TERRAIN_OPEN=0, TERRAIN_IMPASSABLE=1, TERRAIN_BLOCKED=2, TERRAIN_MARGIN=3,
TERRAIN_BARREN=4`. Both `grassTerrain` (scenes) and `buildCollisionTerrain` (`content/collision.ts`, the
decoded-map join) emit a grid in this class space, and `buildTerrainGraph`
(`packages/sim/src/nav/terrain/map.ts`) throws unless every map typeId is a `content.landscape` entry.
The sandbox's `landscape` **defines** these classes (0..4); real ir.json's `landscape` is the **detailed
types** (1..87: 1=void, 2=well, 3=water, 4=tree, …). So the class ids conflict with real types at 1..4
(different meanings) and class 0 is absent — `new Simulation` throws
`terrain map references landscape typeId 0 absent from content`.

## Scope — pick one reconciliation (the change lives in the sim/terrain layer)

- **A — navigate on real detailed types.** A real-content collision builder that keeps the raw real
  landscape typeIds (a real map is 1..36) and reads walkable/buildable from real content's own landscape
  flags, replacing `buildCollisionTerrain`'s class collapse for the real path. Scenes' synthetic grass
  (typeId 0) still needs a named synthetic walkable base, since real content has no typeId 0.
- **B — re-band the collision classes.** Move `TERRAIN_*` into a non-colliding id band (e.g. ≥ 1000) in the
  collision grid **and** both contents' landscape tables, so the class space never overlaps real detailed
  types. Lower blast radius on real content, but touches the whole terrain layer + the sandbox.

Then wire the entries: rebuild `loadRuntimeRealContent(goodNames)` + `logRealContentGaps` + a `goodNames`
param on `mergeRealContent` (localizes real machine-id good names) + a `content?` override on
`createSceneSim` / `runSlice` / `runBareMap` / `runAuthoredSlice`, and pass the merged real content from
`entries/scene.ts` + `entries/map.ts` (drive the `?map=` sprite sheet off the real goods too). Keep `?shot`
and every headless test on the clean-room sandbox. `?map=<real decoded map>` is real content's natural home
(real terrain); `?scene=` (synthetic terrain) may only work under approach A's synthetic base ground.

This is also where the app-test id moves the retired `real-content-goldens` ticket tracked land: the
re-key already updated the app tests it broke (details-panel worker label, professions), so the only
further golden moves are whatever the real-content browser path changes — none until this ticket lands.

## Verify

- Headless: sim-package goldens byte-identical — real content is browser-only; tests stay clean-room.
- Browser `?map=<real map>`: real buildings place, Magazyn shows a real store's larder with icons, the
  economy runs, no terrain crash — **user's eyes** (screenshot first yourself).
- The gap log (`mergeRealContent` → `logRealContentGaps`) already prints the 5 unbalanced gathered goods +
  14 uncataloged buildings; keep it.
