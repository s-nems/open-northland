# Move the signpost and palisade selections to the DOM panel family

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

A selected signpost (tear down) and a palisade, gate or road site (health, build progress,
open/close, demolish, withdraw) are the last selections the legacy Pixi `mountUnitPanel` draws
(`hud/details-panel/` `sections/`, `layout/`, `bake.ts`, `stage.ts`, `pointer-intent.ts`,
`click-actions.ts`). Every other selection uses the DOM panels in `hud/dom/` (settler, vehicle,
building and group panels).

## Scope

- Give the signpost and the palisade family DOM panels in the bottom-right panel family, with the
  same orders the Pixi panel sends today. Follow the HUD panel rules in `packages/app/AGENTS.md`.
- Remove the Pixi panel's drawing, layout, hit-testing and their tests, keeping only the model derive
  and the rebuild gate the DOM panels read.

## Verify

Select a signpost, a palisade under construction, a finished gate and a road site; press every order
and check the pointer no longer falls through to the map. Provide the verified preview.
