# Re-derive calm zones on building changes, not every tick

**Area:** sim · **Origin:** blocked-overlay-profile-hotspots profile (done 2026-07-18) · **Priority:** P3
(measured perf — no behavior change)

`calmZonesByPlayer` (`packages/sim/src/systems/movement/collision/bodies.ts`) memoizes per
`(world, tick)`, so every tick re-fills a Manhattan diamond of `CALM_ZONE_RADIUS_NODES = 8`
(~145 nodes) per building — ~24k set inserts per tick at the bench's 164 buildings. Measured on the
4-settlement + 200v200-fighter bench window: 784 ms self / 864 ms inclusive of a 13.8 s profile
(~6%), split between `unitWalkBlocks` (routing) and `isGhostMover` (separation) because the
first caller of the tick pays the derivation.

The inputs — buildings, their owners, their positions — change on placement/completion/destruction,
not per tick. Key the memo on that instead: e.g. `componentGeneration(Building)` (+ Owner if
ownership can change without a Building store bump), the `memoizedPlacementGrid` pattern. The zones
are membership-only derived state (never hashed), so a longer-lived memo cannot move a golden as
long as every real input is in the key; if the memo becomes incrementally maintained instead of
rebuild-on-bump, register it in `World.verifyCaches()`.

## Done when

- One zone derivation per building-set change, not per tick, verified by a test that a building
  add/remove invalidates the memo and a building-less stretch of ticks derives nothing.
- `npm test` green with zero golden movement; `npm run check`, `npm run build`.
