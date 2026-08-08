# Stop allocating two objects per actor per minimap dot plot

**Area:** app · **Focus:** hud/minimap · **Priority:** P3

`forEachMinimapDot` calls `positionOf` and `tileToScreen` once per actor, and both return a fresh
object: `packages/app/src/game/snapshot-base.ts` builds `{x, y}` to restore the `Fixed` brand, and
`packages/render/src/data/projection/iso.ts` builds `{x, y}` for the screen offset. At a late-game
roster that is two short-lived objects per owned settler and building on every plot.

`tileToScreenX` / `tileToScreenY` already exist for exactly this, and their JSDoc says so: "split out
so a per-entity hot loop allocates no `{x,y}` per call".

The re-plot cadence gate cut how often the pass runs; this is the other axis, the per-plot cost.

## Scope

- `packages/app/src/hud/minimap/dots.ts`: read the position components without minting a wrapper and
  project through the split `tileToScreenX` / `tileToScreenY` helpers.
- A non-allocating position read is only worth adding to `snapshot-base.ts` if a second caller needs
  it; otherwise keep it local to the dot pass.
- The plotted dots must not move: `packages/app/test/minimap-dots.test.ts` already pins the projection.

## Verify

- `npm test`, `npm run check`, `npm run build`.
- The existing dot projection tests still pass unchanged.
