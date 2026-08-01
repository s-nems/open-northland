# Generalize the details panel's work buttons into a control list

**Area:** app · **Focus:** hud/details-panel · **Priority:** P3

The settler panel's three work controls (assign-workplace, assign-home, unassign-home) are one
control shape (round glyph button + label + enabled + tooltip + callback) tripled by hand at every
seam: nine named rect fields in `layout/settler.ts` plus repeated top-offset blocks, nine mapping
lines in `layout/index.ts` `mapLayout`, three near-identical draw triplets in
`sections/settler.ts`, two hardcoded three-way lists in `hit-test.ts`, three intent kinds mapped
one by one in `pointer-intent.ts`, and three optional callbacks plus their switch arms in
`panel.ts`. Adding a fourth control (the feature backlog
has candidates) means about seven coordinated edits, and a missed one compiles clean and fails
silently.

## Scope

- Model the controls as `readonly workControls: readonly WorkControl[]` with
  `{ action, enabled, glyph, labelKey, hintKey, rect }`, built once in the layout and consumed by
  one loop in the section draw, the hit-test, and a single `onWorkAction(action, entityId)`
  callback seam.
- Non-goal: adding or removing any control, or changing visuals/positions.

## Verify

`npm test`, `npm run check`, `npm run build`. Human seam: in `?scene=sandbox` exercise all three
buttons (assign workplace, assign home, unassign home) including disabled states and tooltips;
behavior and pixels unchanged.
