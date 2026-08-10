# Give the save list one view instead of two

**Area:** app · **Focus:** save/load, UI · **Priority:** P3

The slot list exists twice: `view/save-panels/` builds it for the in-game modal, and
`entries/main-menu/load-select.ts` builds a second one for the menu screen with different markup, its own
arrow-key handling, its own selection highlight, and weaker validation before launching. Every rule that
should hold for a save row (what a foreign world's row looks like, what a vanished slot does, which keys
move the selection) has to be written twice and has already drifted once.

## Scope

- Extract one save-list view both surfaces mount, owning rows, columns, selection, keyboard movement, and
  the empty and failed-listing states. Keep each surface's own actions outside it.
- Fold the menu screen's remaining gaps into the shared view: it validates less than the in-game panel
  before staging a save, and shows nothing where map-select shows a preview.
- Pin the shared view's selection and keyboard rules with a DOM test, the way the HUD panels are tested;
  none of the save UI has one today.

## Verify

- Both surfaces list, select, and act identically for the same store contents.
- Arrow keys, Enter, and Escape behave the same in both.
- `npm run check`, `npm run build`, `npm test`, plus a browser pass over both surfaces.
