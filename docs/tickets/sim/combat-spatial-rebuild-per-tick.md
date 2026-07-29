# Build the combat target index and presence grid in one walk

**Area:** sim · **Priority:** P2

`combatSystem` (`systems/conflict/combat.ts`) builds two spatial structures per tick from the same
target list, with the same `nodesOf` resolver:

```ts
const index = new NodeBuckets(world, targets, undefined, nodesOf);
const presence = new HostilePresence(world, targets, undefined, nodesOf, wildClassOf);
```

Both iterate `targets` through `forEachIndexNode`, so every combatant and every attackable building
resolves its node set twice per tick. A building resolves to *every* wall cell, so the duplicated work
scales with footprint perimeter, not with headcount. The memoized `bodyNodes` cache spares the
footprint translation but not the second walk, the second `terrain.coordsOf` per node, or the second
visitor dispatch.

The two structures already agree by construction: `NodeBuckets`'s own doc states the presence grid
tallies the same node ladder, and that "`othersWithin` stays a superset of what a ring search can
find" depends on it. One walk feeding both visitors would make that shared invariant structural
instead of a comment two classes apart.

## Evidence

V8 CPU profile of `Simulation.step` over ticks 2000-4000 of
`?map=magiczny_las&ai=0,1,2,3,4,5&fog=reveal` at bf13ebdc, 5.83 ms per tick on an idle box
(0.56-0.63 load per cpu). `combatSystem` is now the **heaviest schedule slot at 31.0% of step**, ahead
of `plannerSystem`'s 24.4%. Of that:

| term | share of step |
| --- | --- |
| `forEachIndexNode`, all callers | 20.6% |
| → under `NodeBuckets` | 10.8% |
| → under `HostilePresence` | 9.8% |
| `NodeBuckets` construction under `combatSystem` | 7.9% |
| `HostilePresence` construction | 10.7% |

The two builds are within a point of each other, which is what a duplicated walk looks like. A
sampling profile inflates absolute time and over-weights tight loops; treat the share as a ranking and
pin the real number with the A/B below.

## Scope

Feed both tallies from a single pass over `targets`. `forEachIndexNode` already takes a visitor, so
the shape is one walk dispatching to both, not a new index type.

Do not change what either structure holds. `HostilePresence` discounts wildlife through `wildClassOf`
and `NodeBuckets` does not; the merged walk must keep each visitor's own filtering. Bucket order must
stay ascending-id, since `NodeBuckets.nearest`'s first-accepted-per-node shortcut is only canonical
because of it.

Non-goal: the planner's own occupancy build (`PlannerSpacing.forTick`, 1.0% of step) and the
production operator index. They are separate lists with separate lifetimes.

## Verify

`npm test` with no golden or atomic-trace movement: a moved golden means a target pick changed, which
this must not do. The combat suites and the presence early-out tests must pass unchanged.

`npm run bench:compare` before and after on `magiczny_las` with fighters present, reporting the
`combat` slot. Take it on an idle box, or the report flags itself void. `npm run check` and
`npm run build`.
