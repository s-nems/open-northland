# Design and approve the shared in-game UI language

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2


The approved wireframe establishes navigation, not production artwork or component states. Its CSS and placeholder figures are prototypes, while the current HUD uses original GUI frames.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[shared-worktree instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Create a detailed visual proposal for the bottom bar, an open building window, a selection panel, a loose notification and a resource tooltip together on a real-world background.
- Define palette, type, spacing, dimensions, icon family, panel chrome, tabs, focus, hover, selected, disabled, warning and empty states. Establish a proposed minimum viewport and UI-scale range for user review.
- Get approval of the concrete style sheet and representative panel before runtime implementation. Save the accepted design and source basis in docs/design/ingame-menu; do not declare the current wireframe final artwork.
- Implement only the shared visual primitives actually needed by the shell and first panel. Reuse the project's UI/rendering approach after inspecting its seams; do not copy the standalone HTML application into the game.

## Verify

Review normal and enlarged UI scale over light/dark terrain; long Polish and English labels, focus visibility, actual-size icons and generated alpha. Run applicable checks from docs/TESTING.md for any runtime primitives.

For player-visible work, provide the verified preview from this worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
