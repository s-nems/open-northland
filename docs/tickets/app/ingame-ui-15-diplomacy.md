# Redesign diplomacy with actionable relations and tribute

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

**Blocked by:** [02-hud-shell](ingame-ui-02-hud-shell.md)

`hud/tool-panel/diplomacy/` shows relations/tribute but the reference identifies missing attitude changes and nation-map presentation.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[shared-worktree instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Design encountered-nation rows/details, both directions of attitude, trade eligibility, script locks, tribute costs/available warehouse goods and feedback.
- Open Dyplomacja directly. Inspect actual diplomacy commands before wiring friendly/neutral/hostile changes; preserve script authority and multiplayer ownership.
- Present nation locations only to the extent legitimately known. Check original nation-map uncertainty separately rather than inventing information visibility.
- Coordinate with docs/tickets/features/map-scripts-runtime-fidelity.md for tribute semantics; do not duplicate its observation work.

## Verify

Test unmet nations, asymmetric relations, locks, insufficient tribute, repeated payment and stock scope. Inspect ownership and command results in the diplomacy scene/real map.

For player-visible work, provide the verified preview from this worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
