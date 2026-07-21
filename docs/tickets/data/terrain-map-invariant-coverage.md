# Cover the terrain-map file invariants at their own loader boundary

**Area:** data (tests) · **Priority:** P2

`parseTerrainMap` is the loader boundary that must reject a malformed map rather than let it become an
out-of-bounds read in `buildTerrainGraph`. Its ten cross-lane rules live in the `INVARIANTS` table of
`packages/data/src/schema/maps/terrain/file.ts`, and seven of them are executed by no test in the
repository: only the `typeIds` length, elevation, and brightness rules are asserted, and those from
`packages/sim/test/world/terrain-map-loader.test.ts` rather than from this package.

The uncovered set includes both `placements` rules and the whole `placementsInRange` scanner, the most
intricate code in the package. Any edit to its stride constants or scan bound is currently
unverified, which is also why splitting `file.ts` into shape and invariants is not safe to attempt
first.

## Scope

Add `packages/data/test/terrain-map-file.test.ts` with one reject case per invariant plus an accept
case for a minimal valid grid, following the table-driven shape of `cross-references.test.ts`. Build
the fixtures synthetically; do not copy a decoded map from the owned copy.

Splitting `file.ts` into the field shape and an `invariants.ts` holding the table,
`placementsInRange`, and the stride constants becomes a verifiable follow-up once the rules are
pinned.

## Verify

`npm test`, `npm run check`, `npm run build`. Each case must fail against a deliberately broken
fixture and pass on the valid one, so the test proves the rule rather than the parse.
