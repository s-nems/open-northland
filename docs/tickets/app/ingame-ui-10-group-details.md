# Move the signpost and palisade selections to the DOM panel family

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

The group panel (`hud/dom/group-panel/`, FOUNDATION.md "Group panel") is on the DOM plane. A selected
signpost (tear down) and a palisade, gate or road site (health, build progress, open/close, demolish,
withdraw) are the last selections the legacy Pixi `mountUnitPanel` draws (`hud/details-panel/`
`sections/`, `layout/`, `bake.ts`, `stage.ts`, `pointer-intent.ts`, `click-actions.ts`).

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[session instructions](../../design/ingame-menu/AGENTS.md).

## Scope

- Give the signpost and the palisade family DOM panels in the bottom-right component family, with the
  same orders the Pixi panel sends today.
- Remove the Pixi panel's drawing, layout, hit-testing and their tests, keeping only the model derive
  and the rebuild gate the DOM panels read.

## Verify

Select a signpost, a palisade under construction, a finished gate and a road site; press every order
and check the pointer no longer falls through to the map. Provide the verified preview from the
ticket's worktree.
