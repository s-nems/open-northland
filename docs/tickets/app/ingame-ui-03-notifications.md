# Build the narrow frameless notification column

**Area:** app, render · **Focus:** in-game UI redesign · **Priority:** P2

`hud/tool-panel/messages/strip.ts` draws overlapping top notes; `portrait.ts` freezes the standing pose. The accepted layout calls for separate cards down the left edge.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[shared-worktree instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Design populated, empty, filtered, overflow, expired-target and urgent-card states. No enclosing panel background or border; retain only a compact count/filter when empty.
- Keep count and three priorities above an independently scrolling list that ends before the minimap. Preserve access to every event and supported dismiss/target gestures; do not silently discard overflow.
- Use the referenced settler's appearance, equipment and team colour, with subtle animation when visible; support non-settler and missing/dead targets without a misleading portrait.
- Inspect current event/feed behavior before modifying it: another session may have changed main since this worktree fork. Preserve user work and avoid duplicating semantic fixes.
- Keep rendering and animation bounded by visible cards; define notification motion behavior during pause and reduced motion in the design.

## Verify

Test zero, three and many events, all priorities, target selection, dismissal and disappearance. Inspect scroll isolation, no overlay on minimap, and animation cost for off-screen entries using the existing message tests.

For player-visible work, provide the verified preview from this worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
