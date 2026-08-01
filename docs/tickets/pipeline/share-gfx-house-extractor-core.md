# Share the GfxHouse winner walk across building extractors

**Area:** pipeline · **Priority:** P3

`collectGfxHouseWinner` owns the walk, tribe/size winner, level resolution, and collapse used by
construction costs and hit points. Upgrade targets and footprints copy that preamble instead of
supplying only their record-specific output.

## Scope

- Give `collectGfxHouseWinner` a typed record callback.
- Move upgrade targets and footprints onto it with no schema or output change.
- Keep case-sensitive parsing and winner order in the shared core.

## Verify

- Existing extractor tests cover all four consumers.
- Byte-compare `content/ir.json` before and after; run `npm run test:pipeline`, `npm test`,
  `npm run check`, and `npm run build`.
