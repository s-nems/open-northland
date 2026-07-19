# Merge combat's two-tier target search into one ring walk

**Area:** sim · **Origin:** attack-enemy-buildings review, 2026-07-19 · **Priority:** P3
(perf — no behavior change; canonical winners must stay byte-identical)

`resolveTarget` (`packages/sim/src/systems/conflict/engagement.ts`) acquires a target in two priority
tiers — tier 1 (units + HQ + towers) then, only if that finds nothing, tier 2 (plain buildings) — by
running **two full `index.nearest` ring searches** over the same band:

```ts
const primary = index.nearest(x, y, minDist, searchRadius, t => accept(t) && !isLowPriorityBuildingTarget(...));
if (primary !== null) return ...;
const fallback = index.nearest(x, y, minDist, searchRadius, t => accept(t) && isLowPriorityBuildingTarget(...));
```

When tier 1 is empty (a base of plain buildings with no defenders left — the common late-siege
state), every seeker walks the rings to full `searchRadius` **twice** each tick. At the doctrine
scale (thousands of besiegers on an undefended base) that doubles the ring-walk cost for exactly the
scenario the feature creates.

## Scope

Replace the two passes with a single ring walk that remembers, per ring, the first (distance, id)
tier-1 hit AND the first tier-2 hit; return the tier-1 winner if any ring produced one, else the
tier-2 winner. The nearest-tier-1-else-nearest-tier-2 winner must be **byte-identical** to today's
two-pass result — the ring search already finishes the whole minimum-distance band and picks
(distance, then id), so a merged pass with two running bests preserves both canonical winners.

The cleanest shape is likely a `NodeBuckets.nearestByTier(x, y, min, max, tierOf)` that classifies
each accepted candidate into a small tier index and returns the best of the lowest non-empty tier —
keeping the tie-break rules identical. Confirm no other `index.nearest` caller wants the two-pass
form before generalizing.

## Verify

`npm test` (goldens unmoved — the siege priority tests in
`packages/sim/test/conflict/attack-buildings.test.ts` pin unit/HQ/tower over plain buildings), `npm
run check`, `npm run build`; a before/after `ON_BENCH_FIGHTERS` bench on a siege of a defender-less
base (the tier-1-empty path) to confirm the ring walk halved.
