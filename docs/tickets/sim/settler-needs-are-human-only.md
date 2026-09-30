# Omit default wildlife needs and progression records while preserving reader behavior

**Area:** sim, app · **Priority:** P3

`addWildlife` creates zero `SettlerNeeds` bars and an empty `SettlerProgress.experience` map. Ordinary
needs updates select `Person`, and fight experience explicitly excludes wildlife. These records are
unchanging in the measured world, but their values are observable: animal melee reads progression
in `engage-combatant.ts`; walking reads fatigue in `walk-cost.ts`; death events read hunger in
`death.ts`. `debugSetNeeds` can write wildlife bars, which can then affect walking and death hints.
The paired-component invariant and the wildlife acceptance scene also require their presence.
Removing the records only in the constructor would break those contracts.

At tick 97200, the current reference checkpoint has 2470 `Settler` entities: 2133 people and 337
wildlife, including 81 with owners. All 337 wildlife needs records contain four zeros and all their
progression maps are empty. Omitting both would remove 674 records, save 29,836 bytes in compact
save serialization, and about 33,700 bytes in a complete JSON snapshot. This is principally storage
and initial/rebuild snapshot work: unchanged components are already omitted from normal deltas.
No tick-time or frame-time improvement has been measured for this change.

## Scope

- Keep `Settler` identity and `Person` classification unchanged. People from tribes without trades
  retain both records; their needs and progression readers are a separate decision.
- Let absent wildlife records mean the same zero bars and empty experience as the current constructor.
  Audit every direct reader before changing construction; retain the same animal damage, movement,
  fleeing, death hints, and event timing.
- Preserve `debugSetNeeds` by materializing a fresh needs record before its first wildlife write.
  Explicitly supplied non-default wildlife records remain observable. Read defaults must never be
  shared mutable payloads installed into multiple entities.
- Replace the universal `Settler` pairing with a contract requiring both records on `Person` and
  allowing explicit records on wildlife. Update the wildlife scene to assert effective defaults.
- Bump the save format and regenerate its fixture without migration. Explain hash differences through
  omitted default wildlife records; do not change commands or simulation decisions.

## Verify

Run standard gates, wildlife combat and experience scenarios, needs invariants, worker parity and
save/restore checks. Cover an animal with omitted defaults, explicit non-default records, and a
`debugSetNeeds` command that materializes bars. Compare action/event traces and gameplay state after
projecting absent records to the old defaults. Measure save and complete-snapshot bytes on equivalent
worlds; make a runtime speed claim only with a guarded comparison.

The small static reduction alone does not establish a reason to replace fresh checkpoints or expand
an otherwise validated performance change. Revisit this task when reducing persisted or cold snapshot
size is a measured priority.
