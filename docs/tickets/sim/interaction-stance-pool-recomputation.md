# Reuse interaction stance pools across repeated target checks

**Area:** sim · **Focus:** footprint, settler targets · **Priority:** P2

`positionedStanceCells` (`systems/footprint/interaction.ts`) constructs an anchor or neighbour array
and filters it through `standableOnly` on every call. `resourceStanceCells` also translates and filters
the footprint again. The pool does not depend on the seeking unit; only the later nearest-cell and
route checks depend on its origin. `strandedPile` rebuilds this pool when checking whether a loose
stockpile is usable, and interaction-cell selection repeats the same work.

On the [late-game reference](../../perf/magiczny-las-late-game.md), `magiczny_las`, seed 7,
AI seats 0-6, restoring tick 97200 and warming for 200 ticks, a 500-tick allocation profile attributes
243 KiB per tick directly to `positionedStanceCells`, 341 KiB including its callees, and 115 KiB
inclusive to `resourceStanceCells`. The matching 2000-tick CPU profile puts `strandedPile` at
2.3% inclusive and `interactionCell` at 6.6%. The latter includes route-region work owned by the
[AI traversal ticket](ai-decision-tick-slicing.md); these percentages overlap and are not additive.

## Scope

- Reuse the origin-independent stance pool for repeated target checks. Measure calls, distinct
  targets and cache hits before choosing per-pass reuse or a longer-lived cache.
- Cover target position, resource footprint, resource blocking, building blocking and landscape
  topology. A ground drop also depends on its selected stocked good, drop type and the resource at
  its tile. Do not invalidate every target merely because an unrelated stock amount changed.
- Keep `nearestOpenStance` and its origin-dependent pocket and route veto outside the pool cache.
  Preserve anchor fallback, empty pools, resource work-cell precedence and node-id tie-breaking.
- Reuse arrays without exposing mutable cache ownership. Add the cache verifier if the result survives
  a planner pass. Do not change target selection rules or retry cadence.

## Verify

- Repeat the reference's CPU and allocation profiles from the same checkpoint. Reduce stance-pool
  allocations and `strandedPile` CPU cost; measure cache hit rate and storage size.
- Compare state hashes over the reference's 2000 measured ticks. Test moving a target, placing and
  removing a blocking structure, exhausting a resource, changing a ground drop's good and editing
  landscape topology between queries; cached results equal a fresh derivation.
- Existing footprint, resource-work-cell, ground-drop and stockpile target tests, `npm test`,
  `npm run check`, `npm run build`.
