# Skip an unreachable candidate when acquiring a target, not only when chasing it

**Area:** sim · **Priority:** P2

`chase` now refuses to walk toward a contact cell outside the chaser's walk component, so a fighter
that latches onto an enemy across water hands back to the economy instead of standing engaged. Target
*acquisition* is still connectivity-blind: `engageSpec`/`hunterEngageSpec`
(`packages/sim/src/systems/conflict/engagement.ts`, `hunting-ground.ts`) accept a candidate on
distance alone, so the nearest-first ring search re-picks the same unreachable candidate every tick
and never falls through to a reachable one farther out.

For a soldier that is an annoyance. For a hunter it is a permanent economic stall: a deer 20 nodes
away across a stream shadows a reachable deer at 30 nodes inside the same work flag
(`HUNTER_WORK_FLAG_RADIUS` is 64 nodes), the hunter acquires and breaks off each tick, and the hut
never gets meat.

`packages/sim/src/systems/settlers/targets/resources.ts` applies exactly this gate at the resource
picker, for exactly this reason ("the nearest-by-Manhattan pick can latch onto such a tree and the
flag-bound gatherer stalls forever"). The combat picker never got the twin.

## Scope

- Reject a candidate in another static walk component during acquisition - but only past weapon reach,
  so an in-band target across water is still shot at.
- Apply it to both the general spec and the hunter's prey filter; keep the accepted approximation that
  selection is otherwise nearest-first.
- While in `engageCombatant`: the break-off path does not stamp `HuntRest`, unlike the "found nothing"
  path two lines above, so a hunter that keeps re-acquiring pays a full ring search plus a band scan
  every tick. Rest it the same way.

## Verify

- Headless: a hunter with an unreachable near deer and a reachable far one inside its ground kills the
  far one; an archer keeps shooting an in-band target across water.
- `npm test`; combat goldens move only if a scenario with a water split exists.
