# Share one target search across a shelter's garrison

**Area:** sim · **Priority:** P3

Every settler manning a defence-mode building runs its own `NodeBuckets.nearest` ring search each combat
tick, at the house bow's full extracted reach (29 nodes). A garrison stands on ONE node - the building's
door - so the whole tower repeats an identical search: same centre, same radius, same accept filter (they
differ only by the `self` exclusion, unreachable at `minDist >= 1`).

Worst case is capacity-fold: HQ 30 + tower 15 + tower 20 = 65 identical searches per player per tick, and
`resolveTarget` runs each search TWICE (the tier-1 pass, then the low-priority fallback) when nothing
matches. The coarse `HostilePresence` early-out uses 32-node cells, so a raider at ~50 nodes still clears
it while sitting outside the 29-node band - which is exactly the approach phase of an assault, when the
searches are least likely to hit.

**Not yet measured.** Establish the cost before changing anything: `npm run bench:sim` on a
full-garrison-plus-approaching-warband axis, against a pinned baseline commit.

## Scope

- Measure; if the cost is real, memoize the search per `(door node, player, tribe, jobType, radius)`
  within one `combatSystem` pass and hand every occupant the same winner.
- Keep the result identical to the per-settler search, or say at the memo why it cannot be.

## Verify

- `npm test` - existing goldens byte-identical (this is a cost change, not a behavior change).
- `npm run bench:sim` before/after on the same box, reported as a growth curve.
