# Split the two oversized app view modules (building sections, settler-actions)

**Area:** app · **Origin:** /ticket-scout structure sweep, 2026-07-14 · **Priority:** P3

The two largest `npm run scan:structure` hits in `packages/app` that mix concerns and have clean
seams (both are verbatim-move packaging splits, no rewrite):

## Scope

- `hud/details-panel/sections/building.ts` (391 lines) — `drawBuilding` is already a pure
  dispatcher over six independent section renderers (`drawGeneralSection`, `drawConstructionSection`,
  `drawDefenceSection`, `drawProductionSection`, `drawStockSection` + `drawStockTabs`,
  `drawWorkersSection`). Move each to `sections/building/<section>.ts` with an `index.ts` barrel
  keeping the `drawBuilding` export path stable — mirroring the per-building split the sibling
  `model/` and `layout/` folders already use. Coordinate with
  [construction-window-tooltips](construction-window-tooltips.md), which edits the construction
  section: land this split first or rebase that work onto the new file.
- `view/settler-actions.ts` (354 lines, flat file) — `mountSettlerActions` mixes the pure
  selection-centroid projection (`selectionCentre`), the profession-picker window lifecycle, and
  the pointer/keyboard input controller. Promote to a `view/settler-actions/` feature folder whose
  `index.ts` re-exports `mountSettlerActions` (single consumer: `view/unit-controls/index.ts`);
  `selectionCentre` becomes separately unit-testable.

Deliberately excluded (riskier refactors, not moves — boy-scout them when their code is touched):
`hud/details-panel/panel.ts` and `view/admin-debug/index.ts`, whose concerns share heavy closure
state.

## Verify

`npm test`, `npm run check`, `npm run build`, `npm run scan:structure` (both files leave the
oversized list). Pure moves — no golden/behavior change; `npm run shot` of a selected building to
confirm the panel still draws.

## Source basis

Pure structural refactor; no mechanic or visual change intended.
