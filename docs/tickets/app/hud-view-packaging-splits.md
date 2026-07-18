# Split the oversized view/settler-actions module

**Area:** app · **Origin:** /ticket-scout structure sweep, 2026-07-14 · **Priority:** P3

An oversized `npm run scan:structure` hit in `packages/app` that mixes concerns and has
a clean seam (a verbatim-move packaging split, no rewrite):

## Scope

- `view/unit-controls/action-ring/settler-actions.ts` (~444 lines) — `mountSettlerActions` mixes the
  pure selection-centroid projection (`selectionCentre`), the profession-picker window lifecycle, and
  the pointer/keyboard input controller. Split it within the existing `action-ring/` package (which
  already holds `action-ring-visuals.ts` and `profession-picker.ts` behind an `index.ts` barrel);
  `selectionCentre` becomes separately unit-testable.

Path/size corrected 2026-07-17 (refactor/app-cleanup grouped the action ring into `action-ring/`; the
file was ~355 lines when this was filed). Its "the remaining oversized hit" claim was also wrong then
and is wrong now — `scan:structure` currently lists `details-panel/panel.ts` (557),
`details-panel/model/settler.ts` (415), `details-panel/chrome.ts` (413) and
`content/ir.ts` (418) alongside it, each tracked by its own ticket (`view/camera.ts` was split by
concern into the `view/camera/` package and no longer appears). `content/gui-atlas-map.ts` (1486)
tops the list but is deliberately whole and is NOT a split target: its load-bearing invariant is
array index === atlas frame index === original gfx id, which any split by role would destroy.

The sibling `hud/details-panel/sections/building.ts` split (the other half of the original ticket)
is done — the six section renderers now live under `sections/building/` with an `index.ts` barrel.

Deliberately excluded (riskier refactors, not moves — boy-scout them when their code is touched):
`hud/details-panel/panel.ts` and `view/admin-debug/index.ts`, whose concerns share heavy closure
state.

## Verify

`npm test`, `npm run check`, `npm run build`, `npm run scan:structure` (the file leaves the
oversized list). Pure move — no golden/behavior change.

## Source basis

Pure structural refactor; no mechanic or visual change intended.
