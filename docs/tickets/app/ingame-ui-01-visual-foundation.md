# Finish the shared in-game UI foundation

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

The visual direction is approved: see the
[foundation reference and specification](../../design/ingame-menu/FOUNDATION.md). The runtime
foundation exists as a DOM plane over the Pixi canvas: `packages/app/src/hud/dom/` (tokens and
primitives in `foundation.css`, the scaled plane in `root.ts`, shared SVG symbols), the `ui/foundation`
art package with its `ui` recipe kind, and the gallery board at `?art=gallery&tab=hud`. Approval is
not permission to merge into main.

Follow the [design and panel workflow](../../design/ingame-menu/README.md) and
[shared-worktree instructions](../../design/ingame-menu/AGENTS.md). Continue the existing
`design/ingame-ui` worktree.

## Scope

- Publish the chrome pack: a human reviews the `ui/foundation` candidate (`npm run art -- review
  ui/foundation`) and records the approval, then `npm run art -- publish ui/foundation`. Until then
  the plane runs with flat fallback surfaces and empty icon slots, and the preview needs
  `ART_CANDIDATE`.
- Bundle a display face for window titles: the reference uses Almendra SC (SIL OFL) from Google
  Fonts; the runtime falls back to the bundled Cinzel. Add the subset and licence beside the other
  fonts in `packages/app/public/fonts/`, or record Cinzel as the final choice in FOUNDATION.md.
- Verify focus order, contrast, long labels and the 0.75–1.875 scale range on the real renderer once
  the shell (ticket 02) mounts regions on the plane; the gallery board only proves the primitives.
- Keep panel contents for their owner tickets. Building thumbnails, counts and the selected-settler
  contents on the board are placeholders, not specifications.

## Verify

Apply docs/TESTING.md to runtime changes. Review normal/enlarged scale over light/dark terrain,
long Polish/English labels, focus visibility, actual-size icons and alpha. Provide a verified worktree
preview. Remove this ticket only after the remaining work is actually complete.
