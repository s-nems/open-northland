# Derive signpost board nodes through the half-cell conversion seam

**Area:** render · **Priority:** P2

The signpost board projection reconstructs a node from visual cell coordinates without the odd-row
stagger. Boards on alternating rows therefore resolve the wrong direction/anchor even though sim
commands and navigation use `nav/halfcell.ts`. This is a coordinate-space defect, not visual
calibration.

## Scope

Replace the local arithmetic with the shared cell-to-half-cell conversion and keep bearing-to-frame
selection unchanged. Audit the signpost render path for any second manual conversion, but do not alter
the signpost mechanic or board art.

## Verify

Projection tests cover adjacent even and odd rows and match the sim node. Run `npm test`,
`npm run check`, and `npm run build`, then inspect signposts on both row parities.
