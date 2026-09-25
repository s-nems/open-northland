# Give projectile flight a screen-aware metric

**Area:** sim · **Priority:** P3
**Needs user:** yes for the final pick - both options change what a shot looks like, and pixels are
not decidable by test.

`flightStep` (`packages/sim/src/systems/conflict/projectile.ts`) steps a shot toward its release-time
aim with a plain Euclidean step over `Position` x and y, but those axes are not the same length on
screen: a column step is 68 px and a row step 38 (`packages/render/src/data/projection/iso.ts`). `worldDistance`
(`packages/sim/src/nav/world-metric.ts`) exists precisely to reconcile them and is what movement
uses. Two consequences, both pre-existing and both made more visible when
`PROJECTILE_TILES_PER_SPEED_UNIT` was halved to ⅛ (a bow now flies 1 tile/tick, not 2):

**Anisotropic pace.** The calibration constant is eye-tuned, but "1 tile/tick" only means 68 px/tick
east-west; the same value draws 38 px/tick north-south, ~1.8x slower. Tick counts stay isotropic
(the engage band is a node-metric ring search), so nothing about hit rates changes - only the drawn
speed the constant was tuned against.

**Lateral weave near due north/south.** `rowStagger` interpolates the half-cell parity as a triangle
wave, so a straight line in cell space is a zigzag on screen - by design, and the diagonal every
walker follows. Measured deviation from the straight screen chord, old step vs new:

| shot (Δcol, Δrow) | 2 tiles/tick | 1 tile/tick |
| --- | --- | --- |
| (0, 10) pure N/S | 0.0 px, 0 sign swings | 34.0 px, 4 sign swings |
| (1, 10) near N/S | 1.7 px, 0 swings | 33.3 px, 0 swings |
| (4, 8) diagonal | 21.4 px, 0 swings | 22.7 px, 0 swings |
| (8, 0) pure E/W | 0.0 px | 0.0 px |

The bow along the lattice diagonal is old news. What is new is the pure-N/S column: a 2-row step
sampled only even rows and aliased the weave to exactly zero, and a 1-row step samples alternate
parities, giving a ±34 px wobble at 6 Hz that `snapDistanceForKind`'s `Infinity` band interpolates
smoothly rather than hiding. Only near-N/S headings are affected.

## Scope

Pick one and name it as the approximation it is:

- **sim-side** - step in world-metric units the way movement does, so the pace is isotropic. Changes
  hashes for ranged scenarios only (no golden launches a shot). Fixes the pace, and re-phases but
  does not remove the weave.
- **render-only** - draw the arrow along the origin→target screen chord at the fraction flown `p`
  that `packages/render/src/data/scene/projectile-arc.ts` already computes, leaving the sim position
  alone. Removes the weave; leaves the sim pace anisotropic. The chord is the one frozen at release
  (`Projectile.originX/Y` to `aimX/Y`).

Re-tune `PROJECTILE_TILES_PER_SPEED_UNIT` by eye afterwards either way.

## Verify

`npm test`, `npm run check`, `npm run build`, plus a human look at a north/south bow shot in
`?scene=battle` - the artifact is only visible in motion.
