# Expose a per-tick snapshot delta and a mirror that rebuilds the snapshot from it

**Area:** sim, app · **Focus:** inspect/snapshot · **Priority:** P2
**Blocked by:** [00 Heavy-load reference](00-heavy-load-reference.md), [01 Session host seam](01-session-host-seam.md)

`Simulation.snapshot()` is incremental inside the process: the clone cache in
`packages/sim/src/inspect/snapshot.ts` marks touched entities from `world.drainTouched`, drops
removed ids, and reuses every untouched entity and component clone. Across a thread boundary that
incrementality is lost. Measured on the fortress with 13 seats at tick ~2000, 26k entities, 19.6 MB
as JSON: `structuredClone` of the full snapshot 380 ms, a `worker_threads` round trip 760 ms,
against a tick of 3.4 ms. About 280 entities change per tick; cloning them costs 1.5 ms and a round
trip 3.2 ms. The cache already knows which entities are dirty, so the delta must come from its
bookkeeping, not from a diff pass after the fact.

## Scope

- The sim exposes, per stepped tick, a delta: the tick, the touched entity snapshots, the removed
  ids, the tick's events, and a full-rebuild marker for the case where an overflowed touched log
  cleared the cache. It is produced from the cache's dirty bookkeeping with no second pass over the
  world, and it is structured-cloneable (extend the existing structured-clone test to the delta).
- A mirror on the consumer side applies deltas and yields a `WorldSnapshot` in the canonical entity
  order with the cache's identity semantics: an untouched entity is the same object as in the previous
  mirror snapshot, a touched one is new, the snapshot object itself is new per tick. Existing
  memoisation by snapshot identity and per-entity identity keeps working unchanged.
- The mirror reports its version and refuses a delta that does not follow its tick, so a dropped
  message is detected rather than silently skipped.
- The inline host of 01 can serve either the live snapshot or the mirror, so the mirror is exercised
  before any worker exists.
- The mirror's `entities` array is built per change, which retires the per-tick rebuild `takeSnapshot`
  pays today over all ~26k canonical entities (845 MB of array plus 818 MB of iterator allocation in a
  45 s live sample on `specjalna_forteca` with 13 AI seats at tick ~48k, x3).
- On completion, delete the ticket under `docs/tickets/sim/` that asks `takeSnapshot` to reuse its
  per-tick `entities` array: with the delta that array is the mirror's, built per change.

## Verify

- Over a scenario run and the scene registry, the mirror's snapshot is deep-equal to
  `sim.snapshot()` after every tick, and identity of untouched entities is preserved.
- Delta clone and apply cost per tick measured on the 00 checkpoint and reported.
- Hashes and goldens unchanged.
- `npm test`, `npm run check`, `npm run build`.
