# Add a ?scene=needs acceptance scene for the drain→starve→death chain

**Area:** app · **Origin:** original-ui plan reconciliation, 2026-07-12 · **Blocked by:**
[hunger-notifications](hunger-notifications.md) (the checklist references the warning it adds)

The sim chain is fully implemented and unit-tested (`packages/sim/test/lifecycle/
needs-system.test.ts` starves a settler to a `settlerDied` with `cause:'starvation'`), and the
scene opt-in exists (`SceneDefinition.needs?: boolean`, `scenes/types.ts`; runtime boots needs OFF
by default) — but no registered scene sets it. The scene's value is the **browser checklist** (the
user watching bars drain, the warning fire, the death), not re-proving the mechanic.

## Scope

- `packages/app/src/scenes/needs.ts` with `needs: true`: a settler placed with no food; machine
  `checks` asserting drain → starve → `settlerDied(cause:'starvation')`; a human `checklist`
  (draining bars, the hunger warning, the death). Register in `scenes/index.ts`.

## Verify

- `npm test` (`test/scenes.test.ts` auto-covers registered scenes).
- `?scene=needs` browser checklist — **user's eyes**.
