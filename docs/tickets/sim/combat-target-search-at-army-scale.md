# Bound each fighter's per-tick target and approach search at army scale

**Area:** sim · **Focus:** conflict · **Priority:** P3
**Blocked by:** [00 Heavy-load reference](../runtime-architecture/00-heavy-load-reference.md)

Predicted from the loop shapes, not measured at army scale: the 100k `magiczny_las` run had no war, and
its profiles sample `CombatIndex.bandScan` at zero. The work below scales with fighters times the
hostiles in reach, so it is the first combat term expected to grow in a melee blob.

- `CombatIndex.bandScan` (`conflict/combat-index.ts`) collects every hostile (member, node) key in the
  box around a seeker and sorts them all: `keys.subarray(0, count).sort();`. Unowned members always pass
  the hostile mask, and a building sits once per wall node. `nearest` then allocates a
  `new Set<Entity>()` per call.
- An owned fighter holds its target (`Engagement.target`, `heldOrPicked` in `conflict/engagement.ts`)
  and rescans through `pickByTier` -> `index.nearestFew` when it has none, every `RESCAN_PERIOD_TICKS`
  while it walks, and every `REPATH_CADENCE` ticks while it stands short of reach. A melee fighter scores
  up to `PICK_CANDIDATES` of them by the bodies at each (`crowdingOf`), and before each swing asks
  `lessCrowdedInReach`, one band scan a step wider than its reach.
- `approachCell` (`conflict/chase.ts`) tests every cell of the `(2 * maxRange + 1)^2` box around the
  target per repath; a second rank waiting behind a full front re-asks each tick and draws a contact
  slot only on its `REPATH_CADENCE` stride.

Measured with `ON_BENCH_FIGHTERS=300 npm run bench:sim` (4 settlements, 300 v 300, load/cpu 0.8-1.0),
before and after the combat rework that brought held targets, crowd scoring and the blow alarm: combat
median 0.553 -> 0.919 ms (p95 1.462 -> 2.309), projectile median 0.021 -> 0.133 ms (max 0.271 ->
3.973), tick total median 3.874 -> 4.802 ms. The two runs fight different battles, since the rules
changed. The projectile spikes are a lead, not a traced cause: every landed shot on a person answers
the blow alarm at once with a 40 map point `ownedWithin` scan (`conflict/hit-alarm.ts`).

## Scope

- Measure on the 00 reference battle first, the projectile system's landing and alarm work included:
  the share of `bandScan`, `nearestFew`, `crowdingOf` and `approachCell` at 100, 400 and 1000 fighters. Delete this ticket if they stay below the other combat terms.
- Hash-identical cuts: visit the band's grid cells by increasing minimum distance and stop once no
  remaining cell can beat the best accepted candidate, with the `(distance, id)` order kept; reuse a
  rejected-set scratch per depth; walk `approachCell`'s band ring by ring outward from the chaser's side
  and stop at the first ring with an open cell, keeping its tie-break.

## Verify

- Same state hash on the 00 battle checkpoint before and after; the combat tests unchanged.
- The 00 report, before and after: combat share and its growth against army size fall.
- `npm test`, `npm run check`, `npm run build`.
