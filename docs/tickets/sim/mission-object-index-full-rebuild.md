# Keep the mission object index current without rebuilding the whole store

**Area:** sim · **Focus:** missions · **Priority:** P3

`missionObjects` (`systems/missions/object-index.ts`) answers a script's object-id lookups from a
per-world index keyed on the `MissionObjectId` store generations. Any spawn, removal or renumbering of
a stamped entity moves a generation, and the next lookup rebuilds the whole index: it walks every
stamped entity and sorts every group. The cost scales with every stamped entity on the map, not with
the ones that changed.

Wave maps pay this regularly. The shipped scripts (`content/maps/*.script.json`) hold 271 `SetHumanX`
and 267 `SetHuman` lines (any spelling) inside missions that re-activate themselves. `walhalla`, for
example, removes and respawns its spirit squads on a timer. Each spawning pass costs at least one
full rebuild, and more when a pass interleaves lookups with its own spawns. The cost itself has not
been measured, so the first step is a measurement.

## Scope

- Measure first. Profile `walhalla` (or another wave map) with `ON_BENCH_MAP=walhalla npm run
  bench:profile` over a window covering several waves, after confirming that its missions run in the
  bench session. If `indexFor` in `object-index.ts` stays negligible in the tick profile, record the
  numbers in the report and delete this ticket.
- Otherwise, update the index from `World.journalMembership` / `membershipDeltasSince` (the pattern
  `systems/footprint/placement/blocker-journal.ts` uses), so a change costs the changed entities
  and their groups. Keep the lookup contract: ascending entity ids within a group, an empty list for
  an unknown id, and a renumbering (value change without a membership change) moving the entity
  between groups.

## Verify

- The existing object-id tests (`test/missions/object-ids.test.ts`, `mission-entities.test.ts`) pass
  unchanged.
- A cache verifier registered through `World.registerCacheVerifier` compares the incremental index
  with a full rebuild, and a test spawns, removes and renumbers stamped entities between lookups
  and runs it.
- The bench shows the before and after numbers for the same checkpoint and tick window.
