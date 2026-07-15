# Split the oversized view/settler-actions module

**Area:** app · **Origin:** /ticket-scout structure sweep, 2026-07-14 · **Priority:** P3

The remaining oversized `npm run scan:structure` hit in `packages/app` that mixes concerns and has
a clean seam (a verbatim-move packaging split, no rewrite):

## Scope

- `view/unit-controls/settler-actions.ts` (~355 lines) — `mountSettlerActions` mixes the pure
  selection-centroid projection (`selectionCentre`), the profession-picker window lifecycle, and
  the pointer/keyboard input controller. Promote to a `view/unit-controls/settler-actions/` feature
  folder whose `index.ts` re-exports `mountSettlerActions` (single consumer: the sibling
  `unit-controls/index.ts`); `selectionCentre` becomes separately unit-testable.

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
