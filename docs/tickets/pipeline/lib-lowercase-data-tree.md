# Unify the lib-extracted lowercase `data/` tree with the `Data/` content routes

**Area:** pipeline + content-resolver · **Origin:** bug-hunt review, 2026-07-17 · **Priority:** P2

All `data0001.lib` member names are lowercase `data\engine2d\bin\...` (verified in the real
archive), and `libMemberRelPath` (`tools/asset-pipeline/src/stages/lib.ts:15-21`) preserves that
casing when extracting. The content routes resolve exact-case under `Data/engine2d/bin/...` via
plain `join` + `existsSync` (`packages/content-resolver/src/routes.ts:55-57,93` — `/bobs/`,
`/textures/`, `/sounds/`, and the bobs-index).

On case-insensitive filesystems (macOS/Windows defaults) the two case-fold together and everything
works. On a case-sensitive filesystem — the Linux AppImage target `npm run desktop:dist` ships, or
case-sensitive APFS — extraction creates a separate `content/data/` tree: every atlas
`writeAtlasBeside` emits (all creature/vehicle/landscape/building atlases, written beside the
extracted `.bmd`) and every extracted `.wav` (sounds are lib-only; no stage copies loose ones) land
where the routes never look. A Linux install converts "successfully", then boots with no
unit/building sprites and no audio. `npm run test:pipeline` is local-only and CI never runs a
real Linux conversion, so nothing catches it.

## Scope

- Normalize the extracted member paths into the canonical `Data/` casing at the extraction seam
  (`libMemberRelPath` mapping lib member segments onto the game copy's real directory casing), or
  make the content-route resolution tolerant of both trees — prefer one canonical on-disk tree over
  a dual-lookup.
- Coordinate with `docs/tickets/pipeline/loose-over-lib-precedence.md`: collision detection between
  loose and lib copies is itself a case-folding question; one shared path-normalization seam should
  serve both fixes.
- Pin it in a synthetic test that runs on the case-sensitive CI runners (extract a fixture lib with
  a lowercase member → the out-tree path the routes resolve exists).

## Verify

`npm test` (synthetic casing test must pass on Linux CI), `npm run check`, `npm run build`, and a
real `npm run test:pipeline` run. Full end-to-end Linux proof needs the desktop e2e harness
(`docs/tickets/tooling/desktop-e2e-harness.md`) or a manual Linux conversion + boot.
