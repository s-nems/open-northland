# Share one target search across a shelter's garrison

**Area:** sim · **Priority:** P2

Every settler manning a defence-mode building runs its own `NodeBuckets.nearestFew` ring search each
combat tick, centred on the BUILDING's node and bounded by the house bow's extracted reach (29 nodes). A
garrison shares that centre exactly, so the whole tower repeats one identical search: same centre, same
radius, same accept filter (they differ only by the `self` exclusion, unreachable at `minDist >= 1`).

Worst case is capacity-fold: HQ 30 + tower 15 + tower 20 = 65 identical searches per player per tick, and
`resolveTarget` runs each search TWICE (the tier-1 pass, then the low-priority fallback) when the first
tier is empty. The coarse `HostilePresence` early-out uses 32-node cells, so a raider at ~50 nodes still
clears it while sitting outside the 29-node band - which is exactly the approach phase of an assault,
when the searches are least likely to hit.

Per call `nearestFew` also costs more than `nearest`: it cannot return at the first hitting ring, and it
drops the first-accepted-per-node break. `NEAREST_FEW_TAIL_RINGS` bounds that walk to a few rings past
the first hit; the duplication across the garrison is what remains.

**Not yet measured at sim scale.** A micro-benchmark of the ring walk alone put `nearestFew` at 2-17x
`nearest` per call, depending on how many acceptors the band holds. Establish the whole-tick cost before
changing anything: `npm run bench:sim` on a full-garrison-plus-approaching-warband axis - include a
hunter in the garrison, which is the guaranteed-worst case (a hunter job is never presence-gated, so it
pays the walk with no enemy on the map) - against a pinned baseline commit.

## Scope

- Measure; if the cost is real, memoize the search per `(building node, player, tribe, jobType, radius,
  tier)` within one `combatSystem` pass and hand every occupant the same BAND.
- The band, not the winner: each seat takes its own share of it (`GARRISON_SPREAD_TARGETS`), so a memo
  that cached a single target would collapse the fan back onto one raider.
- Keep the result identical to the per-settler search, or say at the memo why it cannot be.

## Verify

- `npm test` - existing goldens byte-identical (this is a cost change, not a behavior change).
- `npm run bench:sim` before/after on the same box, reported as a growth curve.
