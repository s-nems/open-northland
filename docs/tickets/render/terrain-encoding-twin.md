# Use the shared terrain-transition encoding in render

**Area:** render + data · **Priority:** P3

`packages/data/src/schema/maps/terrain/encoding.ts` owns `TRANSITION_NONE` and `TRANSITION_PAIRS`, but
`packages/render/src/data/terrain/transitions.ts` redeclares both values. Pipeline validation and render
decoding can drift while each package still type-checks.

## Scope

Import the encoding constants from `@open-northland/data` at the pure render-data seam, or move the
minimal encoding module to a dependency-neutral package if bundle inspection proves the import pulls
runtime schema code. Keep `transitionRef` and all rendering behavior in render.

## Verify

Terrain-transition tests use one authoritative constant set. Run `npm test`, `npm run check`, and
`npm run build`; confirm the app bundle does not gain an unintended schema payload.
