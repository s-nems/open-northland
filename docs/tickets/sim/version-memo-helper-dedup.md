# Fold the hand-rolled version-keyed WeakMap memos into one helper

**Area:** packages/sim · **Origin:** perf/incremental-spatial-memos review battery, 2026-07-18 · **Priority:** P3

Five sites hand-roll the same rebuild-on-version-bump skeleton — a `WeakMap<World, {key fields, value}>`,
a freshness guard, one derive path shared with a registered `verifyCaches` verifier:

- `signposts/placement.ts` (the probe memo, pre-existing)
- `footprint/placement/work-flag.ts` (`blocksMemo`)
- `movement/collision/bodies.ts` (`zonesMemo`)
- `footprint/building-blocked-cache.ts` and `footprint/resource-blocked-cache.ts`

Each is ~12 lines with a slightly different key tuple (version string plus content/terrain identity,
sometimes a player). The incremental family already has its scaffold (`systems/spatial-memo.ts`); the
version-memo family is the remaining copy-paste, and each new memo re-decides which key fields and
verifier shape to include.

## Scope

Extract one `createVersionMemo`-style helper: a version-string function plus identity fields for the
key, a single derive function feeding both the rebuild and the verifier's reference, an equality
compare, and the verifier label. Port the five sites. Pure refactor — goldens must not move and each
site's key must stay exactly as strong (no key field dropped, no verifier weakened).

## Verify

`npm test` (goldens byte-identical), `npm run check`, `npm run build`.
