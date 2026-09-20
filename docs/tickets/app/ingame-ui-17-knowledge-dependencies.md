# Add production and progression dependencies to Knowledge

**Area:** app, data · **Focus:** in-game UI redesign · **Priority:** P2

**Blocked by:** [16-knowledge-reference](ingame-ui-16-knowledge-reference.md)

`game/technology.ts` and the progression data supply potential evidence, but the original Technology Tree action is not connected. A mock diagram is not a gameplay dependency model.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[session instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

## Scope

- Design readable graph/list navigation for the ten original domains, including zoom/scroll or a simpler equivalent, selected-item detail and unmet conditions.
- Derive building/good/profession dependencies and locked/available/not-yet-available states from verified content and progression probes, not hand-authored IDs.
- Explain required profession, good, prior profession and experience; distinguish map restrictions from unmet requirements.
- Implement in Knowledge's existing Produkcja i rozwój tab. Link bidirectionally to encyclopedia and contextual requirements; retain last tab and relevant navigation state.
- Keep progression calibration in its existing ticket; document the evidence limit instead of changing balance to match an illustration.

## Verify

Test known and unmet requirements, map locks, cyclic/large data, live unlocks and direct links. Inspect real content and run applicable content tests for new joins.

For player-visible work, provide the verified preview from the ticket's worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
