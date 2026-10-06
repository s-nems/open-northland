# Route long walks over a cluster graph before refining them

**Area:** sim · **Focus:** nav, movement · **Priority:** P3

A walker crossing the map runs one weighted A* over the half-cell lattice (`nav/pathfinding/find-path.ts`)
that settles 25,000-46,000 nodes and takes 15-35 ms of one tick. These searches top most of the late
game's slowest pathfinding ticks. Measured on the six-AI `magiczny_las` session (seed 2547456892, tribes
`0:4,1:2,2:3,3:4,4:2,5:7`, progression and needs on) over 3000 ticks from the t120000 checkpoint:

- 41 searches settled over 8,000 nodes, 433 ms in total; 30 of them economy walkers (carriers and
  gatherers crossing 150-200 rows), 197 ms.
- Only 1 of the 30 repeated an earlier (start, goal) pair, so caching routes does not pay.
- On 60 logged long routes the path runs 1.05-1.35 times the straight lattice distance and weighs
  1.7-1.9 per unit of length (22-38% road). The settles come from the road-aware weighted heuristic
  over mixed road and grass, not from detours round obstacles. Landmark (ALT) lower bounds over the
  static lattice left the settles unchanged (1,110,508 against 1,110,295 on those 60 routes).

## Scope

- A two-level search for walks whose straight lattice distance exceeds a threshold: fixed square
  clusters on the half-cell lattice, portals on their shared borders, portal-to-portal costs inside a
  cluster found by the existing A* under the walk-block mask and route weights, an abstract search over
  the portals with the same heuristic, then each leg refined by `findPath` inside the clusters the
  abstract route crosses. Shorter walks keep the current search.
- Hold a cluster's portal costs until a node of that cluster flips on the walk-block mask (its flip
  stamps, `nav/change-stamps.ts` through `WalkBlockMask.flippedSince`) or its roads change (the road
  lane revision the route memo already keys on).
- Ghost (non-colliding) walkers only: a collider's overlay adds standing bodies that change every tick.
  Group orders keep their own path (`movement/group-routes.ts`); the
  [mass-order design](mass-order-movement-design.md) covers armies.
- Reuse what exists: static components (`TerrainGraph.componentOf`) to refuse a walk across water at
  once, the road networks and their gaps (`nav/terrain/road-networks.ts`) for the heuristic, and the
  corridor join (`nav/pathfinding/corridor.ts`) as the pattern for refining inside a corridor. The
  route-region labels (`footprint/route-regions.ts`) only prove pockets under 512 nodes, so they are no
  partition to build clusters on.
- Route quality changes: two-level routes run a few percent over the cheapest before the refine
  smooths them (the current weighted A* runs 1.9-2.7% over), and equal-cost alternatives break
  differently, so walkers take visibly similar but different paths and state hashes move. Measure the
  cost ratio against the current search and get the owner's sign-off on it before merging.

## Verify

- A replay of logged long routes on the t120000 checkpoint: settles and ms per route, and route cost
  against the current `findPath`, before and after.
- `bench:map` from t100000 and t120000: pathfinding mean, p95 and max, and ticks over 16 and 33 ms
  topped by pathfinding.
- Determinism: same-seed runs and a save/restore round trip hash identically; a cluster's held costs
  answer as fresh ones after random mask flips (randomized test).
- `npm test`, `npm run check`, `npm run build`.
