# Route the details panel's work controls through one callback seam

**Area:** app · **Focus:** hud/details-panel · **Priority:** P3

The settler panel's four work controls are now one `WorkControlRow` list built in `layout/settler.ts`
and consumed by a single loop in the section draw, the hit-test, and `mapLayout`. What is still
tripled by hand is the seam below the layout: `click-actions.ts` carries one optional callback and one
switch arm per control, `pointer-intent.ts` maps each `WorkControlAction` to its own `PanelClick` kind, and
`view/unit-controls/index.ts` wires each callback separately. Adding a control still means four
coordinated edits across three files.

## Scope

- Collapse the per-control callbacks into one `onWorkAction(action: WorkControlAction, entityId:
  number)` seam, so `PanelClick` carries the action rather than a kind per control.
- Move the per-action `glyph`, label id, and hint key onto the row, replacing the three parallel
  switches in `sections/settler.ts`, `hit-test.ts`, and `pointer-intent.ts` with row data.
- Non-goal: adding or removing any control, or changing visuals, positions, or wording.

## Verify

`npm test`, `npm run check`, `npm run build`. Human seam: in `?scene=sandbox` exercise all four
buttons (assign workplace, remove work place, assign home, remove dwelling) including disabled states
and tooltips; behavior and pixels unchanged.
