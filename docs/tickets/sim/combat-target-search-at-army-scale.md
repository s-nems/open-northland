# Bound each fighter's per-tick target and approach search at army scale

**Area:** sim · **Focus:** conflict · **Priority:** P3
**Blocked by:** [00 Heavy-load reference](../runtime-architecture/00-heavy-load-reference.md)

Predicted from the loop shapes, not measured: the 100k `magiczny_las` run had no war, and its profiles
sample `CombatIndex.bandScan` at zero. The work below scales with fighters times the hostiles in reach,
so it is the first combat term expected to grow in a melee blob.

- `CombatIndex.bandScan` (`conflict/combat-index.ts`) collects every hostile (member, node) key in the
  box around a seeker and sorts them all: `keys.subarray(0, count).sort();`. Unowned members always pass
  the hostile mask, and a building sits once per wall node. `nearest` then allocates a
  `new Set<Entity>()` per call.
- A soldier's `EngageSpec` carries `lock: null` (`conflict/engagement.ts`); only hunters lock a target
  (`hunting/spec.ts`). Every fighter therefore re-acquires through `resolveTarget` -> `pickInBand` ->
  `index.nearest` on every tick it engages.
- `approachCell` (`conflict/chase.ts`) tests every cell of the `(2 * maxRange + 1)^2` box around the
  target per repath; a back-ranker whose band is fully taken drops its nav state and re-asks each tick,
  so `REPATH_CADENCE` does not apply to it.

## Scope

- Measure on the 00 reference battle first: the share of `bandScan`, `nearest` and `approachCell` at
  100, 400 and 1000 fighters. Delete this ticket if they stay below the other combat terms.
- Hash-identical cuts: visit the band's grid cells by increasing minimum distance and stop once no
  remaining cell can beat the best accepted candidate, with the `(distance, id)` order kept; reuse a
  rejected-set scratch per depth; walk `approachCell`'s band ring by ring outward from the chaser's side
  and stop at the first ring with an open cell, keeping its tie-break.
- A target lock for soldiers (keep a valid target, rescan on a cadence) changes behavior and needs the
  owner's ruling; it is out of scope here.

## Verify

- Same state hash on the 00 battle checkpoint before and after; the combat tests unchanged.
- The 00 report, before and after: combat share and its growth against army size fall.
- `npm test`, `npm run check`, `npm run build`.
