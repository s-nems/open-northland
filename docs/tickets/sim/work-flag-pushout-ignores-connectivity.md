# Decide whether a pushed-out work flag must land on REACHABLE ground

**Area:** packages/sim · **Origin:** fix/evict-work-flag-from-footprint review battery, 2026-07-17 · **Priority:** P3
**Blocked by:** docs/tickets/sim/work-flag-placement-whole-map-scan.md (do the ring search first — this is a
rule decision to make while that code is open, not a second rewrite of the same function)

`nearestWorkFlagPlacement` (packages/sim/src/systems/footprint/placement/work-flag.ts) ranks candidates by
pure Manhattan distance, gated only on `terrain.isWalkable(candidate)` — it never checks that the winner is
*reachable* from the origin. The settler twin it sits beside does: `nearestFreeCellOutside`
(packages/sim/src/systems/movement/evict.ts) is a BFS over `walkableNeighbours`, so its pick is connected by
construction.

`evictWorkFlagsFromFootprint` (packages/sim/src/systems/economy/flags.ts) raised the stakes on this
pre-existing gap. `plantWorkFlagAtFeet` pushes from a settler's feet, where the nearest legal cell is
typically one step away; the push-out starts from inside a building's family body, and real bodies run to a
median of 50 cells (max 388 — `content/ir.json`, 2026-07-17), so the flag may need 4–5 cells to escape — far
enough to hop a narrow river or land past a neighbouring house.

Failure scenario: a gatherer's flag on a riverside strip; the player drops a home over it; the
Manhattan-nearest legal node is 3 cells away across the water while the near-bank field is 4. The flag lands
on the far bank. The gatherer is not wedged (its own flag is an ungated bound target, so it still routes
there the long way round, and a genuinely unreachable flag degrades to a failed `YardDeliveryRoute` rather
than a hang) — but its harvest radius now covers the wrong ground and production quietly stalls.

Unmeasured: nobody has confirmed this fires on a real map. Establish that first — if it cannot happen at the
distances the push actually travels, close this ticket instead of changing the rule.

## Scope

Decide, and apply the decision to `nearestWorkFlagPlacement` so BOTH callers (auto-plant and push-out) agree:

- **Keep Manhattan** — simplest, matches the flag rule's existing tie-break `(distance, lowest node id)`, and
  the whole-map-scan ticket's ring search is already specified to preserve it exactly. Then say in the
  function's doc that a disconnected pick is accepted and why.
- **Switch to reachable-first** — a BFS ring like `nearestFreeCellOutside`, which changes which node wins on
  irregular terrain. This **moves goldens** and diverges from the whole-map-scan ticket's "goldens must not
  move" constraint, so it must be a deliberate, named behavior change, not folded into a perf pass.

Source basis to establish first: the original's rule for where a displaced collector flag lands is
**unobserved**. Neither option can claim fidelity until someone observes it; whichever is chosen gets named
as an approximation in the code (as the push-out itself already is).

## Verify

`npm test`, `npm run check`, `npm run build`. If the rule changes, expect golden movement and name the
mechanic in the commit. Add a sim test with a river between the flag and its Manhattan-nearest legal node,
asserting the chosen rule. Player-facing check (human eyes): place a home over a riverside flag in
`?scene=sandbox` and confirm the flag lands on the bank the player expects.
