# Let needs preempt a long chase

**Area:** sim · **Priority:** P2

`systems/orders/combat.ts` documents the attack order as a soft override - "the economy leaves an
engaged unit alone, but needs still preempt" - but a chasing unit never reaches the needs rungs.
`settlers/planner/replan.ts` returns false while `isTravelling(world, e)`, and `conflict/chase.ts`
keeps a live route the whole way (`redirectRoute` every `REPATH_CADENCE`), so the drive ladder - and
with it the eat/rest rungs - is skipped for the entire march. `lifecycle/needs.ts` drains a fighter's
hunger regardless (only `enjoyment` is frozen for fighter jobs). A besieger between swings can
re-plan (`swingAt` clears the nav state) and then walks all the way home to eat.

Rare while attack orders were hand-issued over short distances; routine now that the strategic AI
sends waves across a map (`systems/ai-player/military/`).

## Scope

1. Measure it first: how many ticks of continuous travel a settler survives against a march across a
   real decoded map. If the march is short against the starvation clock, correct the docstring in
   `orders/combat.ts` and close this - the contradiction is then only in the prose.
2. Otherwise let a starving chaser break off: a needs threshold that outranks the travel gate, or a
   feeding rung the chase itself yields to. Keep the economy gate as it is - an engaged unit must
   still not be reclaimed for work.

## Verify

- Headless: a unit under an `attackUnit` order marching a long distance either eats or is proven to
  arrive with hitpoints intact; a short chase is unchanged.
- `npm test` - goldens move only if the break-off changes behavior deliberately.
