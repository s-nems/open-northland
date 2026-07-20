# Fold the three copies of the ring-search BFS onto one predicate-driven helper

**Area:** sim · **Origin:** needs-pacing worktree review, 2026-07-20 · **Priority:** P3

Three functions now run structurally identical breadth-first ring searches over
`terrain.walkableNeighbours` — same `seen`/`frontier`/`visited` loop, same visit cap, same
`spacing.claimed` + `occupancy.at(x, y)` accept test:

- `nearestFreeCell` — `systems/agents/destack.ts`
- `nearestFreeCellOutside` — `systems/movement/evict.ts`
- `restingCell` — `systems/agents/rest-spot.ts` (the third caller, added on the needs-pacing branch)

Everything that differs is a *predicate*: whether the search traverses blocked nodes, what makes a node
acceptable to land on, whether a `NavigationLimit` gates it, and whether the failed-route memo is
consulted. That is the shape of one helper — `ringSearch(terrain, from, cap, { traverse, accept })` in
`systems/spatial.ts` — with three call sites passing predicates. AGENTS.md deduplicates at the second
real caller; this is the third.

Two smaller things to fold in while there:

- `REST_SPOT_SEARCH_CAP` (`rest-spot.ts`) is `192`, the same value as `SPACING_SEARCH_CAP`
  (`destack.ts`), and its comment says it matches the de-stack search. Reuse the constant instead of
  restating the number.
- The accept predicates themselves overlap — see
  [spacing-drives-avoid-doors-and-nooks](spacing-drives-avoid-doors-and-nooks.md), which asks for the
  same "unblocked neighbour" clearance rest-spot already implements.

**Constraint:** the winner must stay canonical. Each search picks the first acceptable node at minimum
distance in `walkableNeighbours` order; any refactor that reorders expansion changes picks and moves
goldens. Prove it by keeping the existing suites green with no golden movement — a moved golden here
means the refactor changed behaviour.

## Verify

- `npm test` with **no** golden movement (this is a pure refactor).
- The existing `destack`, `evict` and `rest-spot` suites all still pass unchanged.
