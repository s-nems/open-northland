# Implement the approved shared in-game UI foundation

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

The visual direction is approved: see the
[foundation reference and specification](../../design/ingame-menu/FOUNDATION.md) (B · Leśny łupek
slate with wood, bronze and parchment chrome, tokens, geometry and confirmed imagery). Approval is
not permission to merge into main.

Follow the [design and panel workflow](../../design/ingame-menu/README.md) and
[shared-worktree instructions](../../design/ingame-menu/AGENTS.md). Continue the existing
`design/ingame-ui` worktree.

## Scope

- Inspect current UI/rendering seams and implement only the shared visual primitives the shell and
  first panel need: tokens, panel surface, framed window, medallion button, parchment catalogue
  surface, wax seal, section title and ledger row. Do not copy the standalone HTML page into the
  game or regenerate accepted art.
- Establish production ownership/export for the action-icon atlas and the surface texture; validate
  used atlas cells at actual size (50 px navigation, 43 px window title, 29 px resources).
- Bundle the review fonts (Alegreya Sans, Almendra SC or its fallback) with the app instead of
  Google Fonts; state the licence in the asset record.
- Verify focus, contrast, long labels and viewport/scale limits in the real renderer. Mockup scale
  controls and illustrative states are design evidence, not implemented game capabilities.
- Preserve the dual original/own asset requirement. Original Cultures imagery is local review data
  only; do not commit decoded assets. Current walk clips are illustrative, not entity-state bindings.
- Keep panel contents for their owner tickets. Building thumbnails and counts remain placeholders;
  selected-settler contents are explicitly not a complete specification.

## Verify

Apply docs/TESTING.md to runtime changes. Review normal/enlarged scale over light/dark terrain,
long Polish/English labels, focus visibility, actual-size icons and alpha. Provide a verified worktree
preview. Remove this ticket only after the remaining implementation is actually complete.
