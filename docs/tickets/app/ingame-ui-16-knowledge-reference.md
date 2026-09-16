# Build Knowledge with encyclopedia and gameplay guidance

**Area:** app, data · **Focus:** in-game UI redesign · **Priority:** P2

**Blocked by:** [02-hud-shell](ingame-ui-02-hud-shell.md)

`button-effects.ts` maps Help to an administrative item-spawning palette. The accepted replacement is one Knowledge window, not two menu buttons.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[shared-worktree instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Design one window with Produkcja i rozwój, Encyklopedia and Jak grać tabs. Implement encyclopedia/help here; ticket 17 owns the interactive dependency view.
- Remember the last tab during the session; F1 opens Jak grać, F8 opens Produkcja i rozwój. Contextual question marks open the relevant entry without losing its identity.
- Cover building/good/profession entries, general rules, controls, search/index and previous/next navigation using verified content and authored text; localize user-facing strings.
- Create concrete cross-link targets for construction, selection details and the dependency view. Do not expose admin spawning through any player help route.
- Use one shared window/navigation owner so ticket 17 extends this surface instead of creating a separate UI.

## Verify

Test direct vs contextual open, selected-tab memory, missing entries, links/back navigation, localization and keyboard access. Confirm reading Help never submits a world-mutating command.

For player-visible work, provide the verified preview from this worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
