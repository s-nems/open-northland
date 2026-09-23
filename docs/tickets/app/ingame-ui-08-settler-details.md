# Redesign the selected resident panel

**Area:** app · **Focus:** in-game UI redesign · **Priority:** P2

`hud/details-panel/layout/settler.ts` stacks general, work, experience and equipment sections in the bottom-right; the current model/actions must survive the new presentation.

Follow the [approved design and panel workflow](../../design/ingame-menu/README.md) and
[session instructions](../../design/ingame-menu/AGENTS.md). Re-check the cited paths
against this checkout before starting; the reference document describes an earlier implementation.

The profession and school choice windows are tracked in
[their focused task](ingame-ui-profession-school-picker.md); keep their actions integrated here.

## Scope

- Design actual information density using representative worker, soldier, hero, child and foreign-person states before implementing.
- Keep the bottom-right location, readable identity and needs, work/home assignment, experience/qualifications and equipment actions. Use shared chrome/icons and contextual Knowledge links.
- Expose actionable shortages with clear disabled reasons. Preserve ownership checks and command submission, and keep the world usable while the panel scrolls.
- Recheck existing details-panel work-controls and snapshot-indexes tickets, plus religion and tribe presentation tickets, before overlapping their code. Do not fold unrelated simulation changes into the visual redesign.

## Verify

Exercise work/home assignment, training/equipment actions, ownership, dead/removed targets and long content. Reuse model, hit-test, pointer-intent and click-action coverage; review representative real-map selections.

For player-visible work, provide the verified preview from the ticket's worktree. A mockup is design evidence,
not proof of runtime behavior. Apply the shared design-review step before implementation.
