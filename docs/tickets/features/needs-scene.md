# Add a ?scene=needs acceptance scene for the drain→starve→death chain

**Area:** app · **Origin:** original-ui plan reconciliation, 2026-07-12 · **Blocked by:**
[hunger-notifications](hunger-notifications.md) (the browser pass covers the warning it adds) · **Priority:** P3

The sim chain is fully implemented and unit-tested (`packages/sim/test/lifecycle/
needs-system.test.ts` starves a settler to a `settlerDied` with `cause:'starvation'`), and the
scene opt-in exists (`SceneDefinition.needs?: boolean`, `scenes/types.ts`; runtime boots needs OFF
by default) — but no registered scene sets it. The scene's value is the browser pass (the user
watching bars drain, the warning fire, and the death), not re-proving the mechanic.

## Scope

- `packages/app/src/scenes/needs.ts` with `needs: true`: a settler placed with no food; machine
  `checks` asserting drain → starve → `settlerDied(cause:'starvation')`. Register it in
  `scenes/index.ts` and add its short description to both locale catalogs.
- Add fed-but-tired stations so the REST half is visible too. Three distinct behaviours need eyes on
  them and no scene shows any of them today (the only way to watch is `?map=<id>`, where needs run by
  default):
  - a settler standing on a building's doorstep steps off into open ground before lying down
    (`systems/agents/rest-spot.ts`);
  - a settler **with a home** walks to its door, disappears inside, and comes back out rested on the
    short at-home clip (`systems/agents/sleep-at-home.ts`) — so the station needs a built home plus a
    `Residence`;
  - the sleep animation plays its authored shape ONCE — lie down, lie there breathing, get up — rather
    than replaying the strip.

## Verify

- `npm test` (`test/scenes.test.ts` auto-covers registered scenes).
- `?scene=needs` browser pass — **user's eyes**: draining bars, hunger warning, death, settlers
  walking aside to sleep rather than dropping where they stood, housed settlers going indoors, and one
  unbroken lie-down/get-up per sleep.
