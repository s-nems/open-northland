# Keep an idle builder's plan from scanning every waiting wall segment

**Area:** sim · **Focus:** settlers/drives/economy · **Priority:** P2

`planBuilder` (`systems/settlers/drives/economy/builder.ts`) looks for a wall segment with work through
`nearestInTurn` → `nearestBuilderSite` over `targets.wallSiteCells`. While no segment has work, which is
the usual state when no wood is in store or every segment waits for its wood, each of these queries
misses. `InteractionCellIndex.nearest` then runs its accept over every wall site. An idle builder asks
this on every plan: once for a task (`hasTask`), then twice more for a staging site. The tick cost is
therefore O(idle builders × waiting segments). A player who lays long wall lines ahead of their wood
pays it every tick until the wood arrives.

Measured on the development machine, 30 builders, mean of 200 ticks after 200 warm-up ticks:

| Wall sites | No wood | 10 wood in store |
|---|---|---|
| 0 | 0.15 ms | 0.12 ms |
| 200 | 4.1 ms | 3.1 ms |
| 800 | 15.1 ms | 11.0 ms |

The profile at 800 walls puts almost all of it in the per-candidate accept:
- `materials.has` (`site-supply.ts`: `neededConstructionGoods`, `fetchableMaterial`);
- the `nearestBuilderSite` side filter (`constructionTribeOf`, `ownersCompatible`);
- `canStandAt` → `builderCanReach` → `PlannerSpacing.workCells`.

Bucketing wall sites by their anchor in the ring index made it slower. A miss sweeps the ring to
`NEAREST_RING_MAX_RADIUS` and then falls back to the same linear scan.

## Scope

- Make an idle builder's plan cost scale with the segments that can have work, not with every waiting
  segment. Two routes, for example:
  - answer "no segment has work this pass" once per planner pass for a builder's side and material
    sources, before any per-segment scan;
  - or keep the builder-independent part of the accept (hammer work, material need) in a pass-level
    set, so only candidates in it reach the per-builder checks.
- Keep the owner rules unchanged:
  - walls wait until no building or upgrade site a builder could stand at is left;
  - one builder per new segment;
  - one mender per damaged wall;
  - the claim flag stays until the wall stands.
- State hashes must not move. A change to how often idle builders re-plan is a gameplay change and is
  out of scope unless the owner approves it.

## Verify

- Benchmark scenario. It is not committed yet; add it as a sim bench or a timed scratch test.
  - Map: `grassNodeMap(160, 160)` with a single-node wall type, seed 1.
  - Content:
    - goods `none`, `stone`, `wood`;
    - job `builder` with atomics 39 and 42;
    - an unplaced `home_small` building type;
    - a `headquarters` store at node (4, 4) holding 0 or 10 wood, owned by player 0.
  - Walls: wall sites placed with `placePalisade` and `underConstruction: true`, tribe 1, owner 0.
    Rows start at y = 20 and step by 4; within a row, x starts at 20 and steps by 3, while x < 150.
  - Builders: 30 builders owned by player 0, at (10 + i % 10, 10 + ⌊i / 10⌋).
  - Result: at 800 walls with no wood the tick drops well below the 15 ms above and stays roughly flat
    from 200 to 800 walls, with identical `hashState()` at tick 400.
- `npm test` passes and the goldens are unchanged. `packages/sim/test/systems/palisade-builders.test.ts`
  covers the owner rules above.
