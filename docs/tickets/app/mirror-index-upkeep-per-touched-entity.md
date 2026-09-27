# Skip a snapshot index's upkeep when a delta wrote nothing it reads

**Area:** app, sim, render · **Focus:** inspect/snapshot-indexes, snapshot-mirror · **Priority:** P2

`SnapshotIndexes.replaced` (`sim/src/inspect/snapshot-indexes.ts`) runs every held spec over every
touched entity of every delta, whatever the entity wrote. A `listedWhere` spec evaluates its predicate
twice per call and re-places the entity in its sorted list when it still matches, so each of the
`withComponent` lists binary-searches every touched entity that carries its component. Only HUD totals
filters by what it reads (`sameReads`), and its `PERSON_READS` include `Settler`, which changes every
tick (see [per-tick-counters-rewrite-every-settler.md](../sim/per-tick-counters-rewrite-every-settler.md)).

Measured with the runtime's readers registered on a mirror, `krwawa_rzeka`, 12 AI seats
(`docs/perf/heavy-load-krwawa-rzeka-12ai.md`): apply costs 0.53 ms bare and 3.9 ms with the indexes at
t60k, 0.8 and 6.4 ms at t100k. Per spec at t60k: HUD totals 0.83 ms per delta, bubble carriers 0.44,
the 13 `withComponent` lists 0.44 together, position buckets 0.15, families 0.11, staff 0.07, the rest
0.05 or less. At x3 that is about a fifth of the main thread's frame time at t100k.

## Scope

- `MirrorProbe` (`packages/app/bench/mirror-probe.ts`) registers the indexes the runtime's frame reads
  and reports apply with and without them, split per spec behind a flag. The list of readers comes from
  one exported helper beside the readers, so the probe cannot drift from the runtime.
- A spec declares the component names it reads; the mirror skips `replace` for an entity whose delta
  entry wrote or removed none of them. A list spec whose membership is unchanged swaps the held object
  without a search, or holds ids instead of entity objects.
- HUD totals and the bubble carriers read the need bars from wherever the per-tick counters ticket puts
  them, so a hunger tick no longer recounts a person.

## Verify

- The probe's split from the reference's t60k and t100k checkpoints against the numbers above.
- Index parity: after each applied delta over a few hundred real-content ticks with random 1-7-tick
  batches, `SnapshotMirror.verifyIndexes()` finds nothing; add it to the probe's per-window check once
  the probe's mirror holds the runtime's readers.
- The snapshot index tests, `npm test`, `npm run check`.
