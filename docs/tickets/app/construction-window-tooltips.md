# Construction window: good-name hover tooltip parity with the stock rows

**Area:** app (details panel) · **Origin:** construction-panel work, 2026-07-14 · **Priority:** P3

The Magazyn stock rows name their good in a hover tooltip (`panel.ts` `hitStockGood`, probing the
same `stockSlotRects` the draw uses). The Construction window's material rows
(`sections/building.ts`, drawn from `model.construction.rows`) have no such probe — hovering a
"delivered / needed" row names nothing, though the icon is the only identifier.

## Scope

- Extract the Construction rows' geometry into a shared helper (like `stockSlotRects`) so the draw
  and the hover probe read one source, then add a `hitConstructionGood` probe to `updateTooltip`.
- Keep strings English (the i18n pass owns localization).

## Verify

- Unit test the probe like the existing layout tests; hover check in `?scene=construction` with a
  site selected.
