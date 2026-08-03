# Tie the pipeline's served roots to the routes that serve them

**Area:** pipeline · **Priority:** P3

The four subtrees the app addresses by a fixed route are spelled twice, in packages that share no
type: `BOBS_DIR`, `TEXTURES_DIR`, `SOUNDS_DIR` and `GUI_BITMAPS_DIR`
(`tools/asset-pipeline/src/stages/content-tree.ts:11-20`) against `BOBS_ROOT` and the `FILE_ROUTES`
literals (`packages/content-resolver/src/routes.ts:43,57-65`). `servedRelPath` now writes every derived
file at the pipeline's spelling, and `resolveFileUnderRoot` matches case-sensitively, so a one-sided
edit moves a whole route's output outside it and every loader reads the 404 as absent content. The
pipeline test pins its own four literals, which catches a drift on the pipeline side only.

`tools/asset-pipeline` depends on `@open-northland/data`; `@open-northland/content-resolver` has no
dependencies and is a dev dependency of `packages/app`. Sharing the table therefore needs a
dependency-direction decision rather than a mechanical move.

## Scope

- Give the served-root table one owner both packages read, or a test that fails when the two tables
  disagree. Prefer whichever keeps `content-resolver` host-neutral and free of a pipeline dependency.
- Keep the served spellings byte-identical; this is a drift guard, not a layout change.

## Verify

`npm test`, `npm run check`, `npm run build`. A deliberate one-sided edit to either table must fail a
test.
