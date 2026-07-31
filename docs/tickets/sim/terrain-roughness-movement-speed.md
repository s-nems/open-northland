# Terrain roughness does not slow movement

**Area:** sim · **Priority:** P3

The original stores a per-node roughness value (`lmpr`, 0..5) that slows units crossing it. Per the
CulturesNation dat-format derivation (`Cultures2-dat-format/sections/arrays/roughness.py`, replayed
byte-identically against original maps), it averages a per-`LogicType` table over the node's
adjacent triangles and forces 1 on water and road nodes; roads therefore read as the fast surface.
Our movement has per-entity pace only (`components/movement.ts` `movespeed`); nothing in
`packages/sim/src/nav` or the movement system models terrain cost, so mountains, swamps, and roads
all walk the same.

The strength of the slowdown per roughness level is not represented in map data and needs
observation of the running original.

## Scope

- Import `lmpr` per map rather than deriving it: it is present in every owned map and skips
  reimplementing the LogicType table.
- Apply a per-node speed factor at step time in the movement system; leave the pathfinder's edge
  costs alone until observation shows the original routes around rough terrain rather than just
  slowing through it.
- Calibrate the level-to-speed mapping by observation and name it an approximation until pinned.

## Verify

A unit test on the cost lookup, a headless scenario timing a unit over rough vs smooth terrain, and
a side-by-side observation run against the original for the calibration.
