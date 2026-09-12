# Route HUD pointer input through one ordered surface registry

**Area:** app · **Focus:** hud, view/runtime · **Priority:** P3

Two competing mechanisms arbitrate the same canvas mousedown. The tool panel and the minimap each
register their own listener and win by registration order plus `stopImmediatePropagation` (the
tool panel comments: "We register first (mounted before unit-controls), so this wins"), while
unit-controls run an explicit claim chain (`claimPointer` → panel → actions → pick mode). Because
mount order is not draw order, the minimap draws over the strip yet the strip got the click first;
instead of unifying, a patch predicate `deferToOverlay` was added to the tool panel and wired in
`game-view.ts` to `minimap.claimsPointer`. There are now five differently named predicates for one
concept (`claimsPointer`, `claimPointer`, `claimsWheel`, `claims`, `deferToOverlay`), hand-composed
in `game-view.ts`, plus a sixth seam carrying the same overlay as geometry rather than a predicate
(`overlayReserve` → `minimap.panelRect`, so pop-up lists size clear of what `deferToOverlay` takes)
and a seventh that hands a press the other way, from a surface back to the order layer (`onOrder` →
`controls.overviewPress`, the minimap's own orders). Every new HUD surface must reason about listener
registration order, which is invisible at the call site.

## Scope

- One ordered HUD surface registry (z-order + `claims(x, y)` + pointer handlers) and one canvas
  dispatcher that walks it top-down; surfaces stop registering their own competing canvas
  listeners.
- Delete `deferToOverlay` and the `stopImmediatePropagation` arbitration; the claim-chain
  predicates collapse into the registry entries.
- Non-goal: changing which surface wins any current click. Existing pointer precedence must be
  preserved exactly.

## Verify

`npm test`, `npm run check`, `npm run build`. Human seam: in `?scene=sandbox` click the tool-panel
strip, the minimap (including where it overlaps the strip's lower buttons), the details panel, and
unit selection/orders; each must behave as today.
