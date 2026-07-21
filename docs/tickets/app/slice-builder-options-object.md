# Replace the slice builders' optional positional tails

**Area:** app · **Priority:** P3

`runSlice`, `runBareMap`, and `runAuthoredSlice` take opaque optional tails for owner, footprints,
names, and content. Callers pass `undefined` placeholders, and the three functions repeat content
fallback resolution. `createSceneSim` has the same shape and silently drops extras when explicit content
is present.

## Scope

Use one named options object for the optional inputs and one shared content-resolution helper. Keep
required seed/map/tick inputs positional and preserve the existing public behavior.

## Verify

`npm test`, `npm run check`, and `npm run build`; sim goldens and the deterministic shot remain unchanged.
