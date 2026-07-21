# The sow lattice abandons a point whose one jittered node is walled, instead of trying the free ground beside it

**Area:** sim · **Origin:** dense-settlement farming review, 2026-07-21 · **Priority:** P2

`nextSowNode` (`packages/sim/src/systems/agents/farming/targets.ts`) derives exactly ONE candidate per base
lattice point: `base + sowJitter(base)`, where the jitter is a pure hash with no seed input. Every rejection
is a bare `continue`, so a base point whose single jittered node is covered by a wall is dead for that farm
permanently — even when the other three half-cell phases of the same point are open ground.

In a farm boxed into a town centre that turns blocked coverage into candidate loss at roughly 1:1, which is
exactly the "scattered free tiles between the houses" case the original handles well: observed there, a farm
keeps roughly its usual output whether it stands in the open or hemmed in by buildings.

Candidate slack looks large and is not. On the shipped balance (`FARM_FIELD_RADIUS = 16`,
`FARM_MAX_FIELDS = 24`, `FIELD_LATTICE_STEP = 2`) the ring holds 133-136 candidates, but `nextSowNode` is
strictly nearest-first, so a healthy plot lives inside d≈7 — 24 fields drawn from 28 candidates, ~15% slack.
Blocking the inner rings does not starve the farm; it pushes every field out to d=11-16 and roughly doubles
the watering round-trip, which is a silent rate cut while the plot still reports a full 24.

## Why it is not already done

A four-phase fallback was written and reverted during the field-obstruction fix. Two findings from that
attempt should shape the next one:

- **It must not fire on a point that is merely OCCUPIED.** Falling through to another phase when the
  preferred node holds a standing field lets one base point carry several fields and silently packs the plot
  tighter than the spacing the pacing is calibrated against. Only GROUND rules (out of bounds, outside the
  radius, unwalkable, blocked, unplantable) may advance the phase.
- **Even so limited, it shifts real-content pacing.** Every real farm blocks its own footprint cells, so the
  fallback fires around the farm itself, not only in dense towns. Measured on the real-content scenario
  (`packages/app/test/content/farming-scenario.test.ts`, lone farmer): first grain moved 7038 → 8200 ticks,
  while plot-full (≈2430) and total yield over 24000 ticks (25 grain) were unchanged. So it is a re-shuffle
  of which node ripens first rather than a slowdown — but it must be measured, not assumed.

It was reverted because no cheap fixture test could be made to discriminate it: the fixture's plot cap (6)
is reached on the preferred phase alone in every pocket tried, so the fallback made no difference to any
assertion.

## Scope

- Re-land the ground-rules-only phase fallback, with the preferred phase still tried first so open ground
  keeps its current pattern exactly.
- Pin it with a test that FAILS without it. The fixture farm's `maxFields` is the obstacle — a case needs a
  plantable pocket tight enough that the preferred phase alone cannot reach the cap. Consider a
  farming-local content override with a larger `maxFields`/smaller radius rather than contorting the map.
- Re-measure the real-content first-grain figure and update the `FARM_TICKS` note in
  `farming-scenario.test.ts` if it moves.

## Verify

- The new fixture case fails with the fallback disabled and passes with it.
- `packages/app/test/farm-pacing.test.ts` stays green (it runs on sandbox footprints, which block nothing,
  so the fallback must not perturb it at all).
- `npm run test:content` — the real-content farming scenario still banks wheat.
