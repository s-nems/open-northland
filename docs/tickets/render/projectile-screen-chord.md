# Draw a flying shot along its screen chord

**Area:** render · **Priority:** P3
**Needs user:** yes for the final look - pixels are not decidable by test.

A shot's flight time is the original's (`d * 8 / speed` ticks over `d` map points), and the sim
places it on the straight line from `Projectile.originX/Y` to `aimX/Y` in `Position` space
(`packages/sim/src/systems/conflict/projectile.ts`). Under the staggered raster that line is not
straight on screen: `rowStagger` interpolates the half-cell parity as a triangle wave, so a shot
heading near due north or south weaves up to about 34 px sideways as it crosses rows.

## Scope

Draw the arrow on the origin-to-aim screen chord at the fraction flown `p` that
`packages/render/src/data/scene/projectile-arc.ts` already computes, leaving the sim position alone.
Name it as a presentation choice; the sim flight time stays the original's.

## Verify

`npm test`, `npm run check`, `npm run build`, plus a human look at a north/south bow shot in
`?scene=battle` - the artifact is only visible in motion.
