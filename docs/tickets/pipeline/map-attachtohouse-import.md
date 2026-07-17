# Import the map `attachtohouse` verb (a settler's authored home / workplace)

**Area:** pipeline + app · **Origin:** discovered while importing `setproducedgood`, 2026-07-17 · **Priority:** P2

A decoded map binds a settler to a building with `attachtohouse <hx> <hy> <slot>` inside its `sethuman`
block, e.g.

```
sethuman 0 "saracen" "fisher" 359 366 0 0
setproducedgood "fish"
attachtohouse 359 358 2
```

The map decoder drops the verb (`extractStaticObjects`, `tools/asset-pipeline/src/decoders/ini/maps.ts`),
so every imported settler starts homeless and unemployed even where the map authored its hut. The
sibling pick verb `setproducedgood` now imports (see that commit for the whole chain to copy: decoder →
`packages/data/src/schema/maps/entities.ts` → `packages/app/src/slice/authored-placements.ts` → a
`spawnSettler` field).

## Investigate first

- **What the slot column means.** Observed shape across the unpacked `staticobjects.inc` corpus is
  `<hx> <hy> <slot>` with slot 1 and 2 (read as home / workplace), and the coords name the target
  house's anchor — **re-verify both against the corpus before coding**, do not trust this line.
- Whether the target resolves by anchor half-cells against the `sethouse` rows of the same map (the
  natural join), and what to do when it names no authored house.

## Scope

- Capture the verb onto the enclosing `sethuman` (the `producedGood` pattern: a placement verb ends the
  block; the uncaptured modifiers must not retarget it).
- Carry it through the schema + the authored-placement join, resolving the target to the placed
  building entity.
- Bind on spawn via the existing employment/housing commands (`assignWorker` / `assignHouse`) rather
  than a new stamp, so the flag-less employed-gatherer path and its `GatherSelection` rules apply as
  they do for a hand-assigned worker.
- **Interaction with the gather pick:** an employed gatherer keeps its pick in `GatherSelection`, not
  `WorkFlag.goodType`, and `assignWorker` drops the auto-planted flag — and job/employment changes REMOVE
  `GatherSelection` (`packages/sim/src/systems/economy/jobs/system.ts`). So a settler carrying both verbs
  must be attached FIRST and picked SECOND, or the pick is wiped. Cover this ordering in a test.

## Verify

- `npm test`; decoder cases in `tools/asset-pipeline/test/ini-maps.test.ts` pinning the real grammar.
- `npm run test:pipeline`, then a real-content test in `packages/app/test/content/` asserting an
  authored settler binds to its authored house (the `authored-map-gather-good.test.ts` shape).
- Browser pass on a map with `attachtohouse` rows: the settler shows its workplace/home in the details
  panel.
