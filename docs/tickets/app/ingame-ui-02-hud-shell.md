# Implement the approved HUD regions and direct navigation

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

**Blocked by:** [01-visual-foundation](ingame-ui-01-visual-foundation.md)

`hud/tool-panel/layout.ts`, `button-effects.ts`, and `view/game-tool-panel.ts` still implement the old vertical strip. Window geometry and selection details have independent placement rules.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[shared-worktree instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Design the exact region layout and window/selection/input state transitions before implementing. Use the accepted shared style.
- Replace the strip with seven direct entries: Buduj, Mieszkańcy, Asystent, Statystyki, Misja, Dyplomacja, Wiedza. Keep system controls top-right, notifications left above minimap, central windows, and selection details bottom-right.
- Define close/reopen, Esc hierarchy, focus return, local scroll vs camera scrolling, click-through prevention, placement cancellation and independent selection behavior. Ordinary information windows must not silently change simulation pause.
- Preserve working legacy panel contents behind the new navigation until their owner tickets replace them. Clearly identify temporary missing functionality in review; never substitute the administrative goods palette for Help.
- Resolve real region collisions across the approved viewport/scale range. Recheck existing tickets docs/tickets/app/tool-panel-window-placement-vs-minimap.md and tool-panel-named-gui-frames.md; delete or narrow them only if their exact remaining work is satisfied.

## Verify

Exercise each entry, close/reopen, Esc, simultaneous selection, map clicks, placement and resize. Add focused layout/input tests and inspect the verified real-map preview.

For player-visible work, provide the verified preview from this worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
