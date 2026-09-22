# Move the AI opening build order from code data into a content-IR profile

**Area:** sim, data · **Priority:** P3

`DEFAULT_BUILD_ORDER` (`packages/sim/src/systems/ai-player/build-order/entries.ts`) is a const
table of stable content ids inside the sim - data in shape, but not authorable per scenario. A
validated IR profile would allow map and difficulty variants. No extraction source exists for the
original strategic AI's internals, so this is authored content, not pipeline output.

## Scope

Add a strict content schema mirroring the ordered `BuildOrderEntry` union: `place` with its affinities
and ground rule, `upgrade`, `collector`, and `towerCoverage`. Move the current authored table into the
committed fallback catalog, resolve the selected profile once per AI seat, and leave no content-id table
in sim source. Workforce policy remains separate in
[ai-workforce-content-profile](ai-workforce-content-profile.md).

## Verify

- Schema round-trips through `parseContentSet`; a fixture profile drives the executor in the existing
  module tests; fallback content preserves the current command sequence and goldens; `npm test`,
  `npm run check`, `npm run build`.
