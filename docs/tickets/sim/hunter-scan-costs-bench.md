# Bench the hunter's per-tick scan costs before bounding them

**Area:** sim · **Priority:** P3

Four hunter and wildlife scans are unmeasured. Bench them on a wildlife-rich, resource-dense ground
with posted hunters, plus archer volleys for the first case, before optimizing them.

Every box below is sized off `HUNTER_WORK_FLAG_RADIUS`, which moved 32 -> 48 nodes: the carcass box went
40 -> 56 (up to 5x5 buckets instead of 4x4 in `spatial/region.ts`, and `someNear` tests every member of
every touched region), and the acquisition band with it. Re-read this ticket before that constant or
`HUNT_LAST_RESORT_SCAN_FACTOR` moves again.

## Scope

- `frightenWildlifeNear` (`conflict/fright.ts`): a linear pass over all map wildlife per ranged
  launch; a wildlife candidate list off the combat index walk would bound it under volleys.
- `huntingGroundHoldsCarcass` (`conflict/hunting/kill-claim.ts`): an actively chasing hunter re-probes the
  carcass gate each tick, and a carcass-less probe tests every indexed resource in the
  `HUNTER_WORK_FLAG_RADIUS`+slack box - a resource-dense ground pays the full box per chase tick. A hit
  that survives the cheap rejects and is a carcass also resolves its killer's stance, failed-route memo
  and ground (`claimedByAnotherHunter`, measured ~1.5 us/call, bounded by carcasses-in-ground).
- The prey-claim set (`preyHeldByOthers`, `conflict/hunting/spec.ts`): a Set over every holding hunter,
  rebuilt per hunting hunter per acquisition tick - O(hunters²) map reads and one allocation per hunter
  per tick. Measured at ~0.008 ms/tick for 10 holders and ~1.9 ms/tick for 120, so it is bounded by
  hunter count rather than map size; `World.componentGeneration(HuntFocus)` would key a per-world memo
  at O(H) while keeping the intra-tick visibility the rule depends on.
- The hunter's two-tier `resolveTarget` when only last-resort livestock remains in ground: the tier-1
  `nearest` walks the whole `dist+radius` band with zero accepts before the fallback reaches the sheep,
  and the fallback's first livestock candidate pays the last-resort probe on top - a ring walk out to
  `HUNT_LAST_RESORT_SCAN_FACTOR x radius`, memoized per engage, and so ~4x the nodes of one tier walk,
  not a third equal one. A refused herd then rests the hunter (`HuntRest` amortizes all three ~10x), but
  that refusal is a steady state, not a breather: one head of game parked between the ground radius and
  the probe blocks acquisition for good, so the sawtooth runs as long as the hunter stands there. An
  accepted target is held instead, and a held last-resort one still pays the preempt walk every chase
  tick, un-amortized (`HuntRest` refuses to rest an `Engagement`) - out to `2 x radius + slack` from the
  anchor at the leash edge. Bounding that one to the ground radius would change the winner from
  nearest-to-hunter to nearest-to-anchor, so it needs a decision, not a silent optimization. A hold on
  normal game skips both.
- The gatherer drive's carcass reach (`drives/economy/gatherer.ts`): collects and SORTS the same
  radius+slack box once per idle hunter per planner tick, and an idle hunter re-plans every tick.
- The employed roamer's banked-form good filter (`drives/economy/gatherer.ts`): rebuilds a Set over all
  content goods per plan call for every building-employed gatherer - a steady planner-path allocation;
  memoize per (content, workplace stock shape) if it shows.

## Verify

`npm run bench:compare` before/after on the chosen scenario, idle box, per `docs/DEVELOPMENT.md`; no
golden movement (pure cost work).
