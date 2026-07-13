# Cover the goods-stage emit and `writeIr` orchestrators

Two pipeline orchestrators have no direct test coverage. Their pure inner joins are tested, but the
emit/assembly wrappers around them are only exercised by a full `npm run pipeline` run against the
owned game copy (not by CI, which has no game assets):

- `convertGoodsStage` (`tools/asset-pipeline/src/stages/goods.ts`) — only the pure joins
  `resolveGoodIcons` / `resolveGoodNames` are unit-tested. The stage's atlas + palette-LUT + manifest
  emit (icon packing, the `paletteAliasMap` resolution, the good-icon LUT PNG, the manifest JSON) is
  untested.
- `writeIr` (`tools/asset-pipeline/src/stages/ir.ts`) — `buildIr`'s extractors are covered via the
  split `ir` spec, but the `writeIr` wrapper (build → `JSON.stringify` → write `<out>/ir.json`) has no
  test asserting it writes a parseable, `parseContentSet`-valid file.

## Why deferred

Filed out of the data+pipeline `/refactor-cleanup` test pass, which covered the three untested
modules with pure-logic gaps (`maps/case-path`, `maps/meta`, `player-colors`). These two need a
synthetic **game-tree** fixture (a directory of `.ini`/`.cif`/`.pcx` inputs) large enough to drive a
whole stage end-to-end — a bigger fixture-building effort than the isolated-module tests, better done
as its own focused session.

## Scope

- Build a minimal synthetic game tree under a temp dir (reuse the shared `test/fixtures/` byte-buffer
  builders — palette/pcx/bmd/cif) sufficient to drive each stage.
- `convertGoodsStage`: assert it emits the icon atlas PNG + `.atlas.json`, the goods palette LUT, and
  a manifest whose good→icon/name joins match the fixture inputs; assert a missing-palette carrier
  degrades to a neutral row (matching the warn-and-skip contract) instead of aborting.
- `writeIr`: assert `<out>/ir.json` is written, round-trips through `parseContentSet` (zod +
  cross-reference validation), and carries the fixture's tables.

## Verify

`npm test` green with the new specs; the specs use only synthetic fixtures (no copyrighted bytes —
`content/` and real assets never enter the repo, root `AGENTS.md` Legal).

Source basis: test-coverage gap observed during the data+pipeline refactor diagnosis.
