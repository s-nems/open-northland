# Build Knowledge with encyclopedia and gameplay guidance

**Area:** app, data · **Focus:** in-game UI redesign · **Priority:** P2

The beam's Wiedza entry opens a pending note. Encyclopedia, rules and shortcut help have no player surface; the administrative item palette the old Help button opened is gone and spawning stays in `view/admin-debug/`.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[session instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Design one window with Produkcja i rozwój, Encyklopedia and Jak grać tabs. Implement encyclopedia/help here; ticket 17 owns the interactive dependency view.
- Remember the last tab during the session; F1 opens Jak grać, F8 opens Produkcja i rozwój. Contextual question marks open the relevant entry without losing its identity.
- Cover building/good/profession entries, general rules, controls, search/index and previous/next navigation using verified content and authored text; localize user-facing strings.
- Create concrete cross-link targets for construction, selection details and the dependency view. Do not expose admin spawning through any player help route.
- Use one shared window/navigation owner so ticket 17 extends this surface instead of creating a separate UI.

## Verify

Test direct vs contextual open, selected-tab memory, missing entries, links/back navigation, localization and keyboard access. Confirm reading Help never submits a world-mutating command.

For player-visible work, provide the verified preview from the ticket's worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
