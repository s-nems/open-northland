# Mission system contract

The engine that runs a map's `[MissionData]` script. `packages/sim/AGENTS.md` applies in full; the
format and the execution semantics live in [`docs/formats/MISSIONS.md`](../../../../../docs/formats/MISSIONS.md).

## What is content and what is state

- The script is an immutable input, like the content set: `Simulation.missions`, reachable as
  `ctx.missions`. It is neither hashed nor saved, and a restore is handed the same script the run was
  built with.
- Only what a pass changes is state: the `MissionState` records, keyed by the mission's index in that
  script. A record holds flags and ticks, never a definition.
- Ids reaching this module are numeric. Names are resolved at the app boundary, so nothing here joins
  against `ir.json`, and no evaluator may grow a rule keyed on a specific id.

## Evaluating

- A pass runs every `MISSION_EVALUATION_TICKS` and visits missions in index order. Order is the
  contract: a mission a result activates is visited later in the same pass.
- Goal flags are rewritten by every check and never latched. Activation records a tick only on the
  inactive-to-active transition.
- Randomness comes from `ctx.rng` alone, drawn only where the original draws, so a run and its replay
  fire on the same ticks.
- An opcode with no evaluator reports through the `missionUnsupported` event and never throws. A goal
  that cannot be judged is unknown. A rule fires only when its known goals establish success, so
  negation never turns an unavailable answer into success. A result that does run but cannot act on the world reports `missionResultFailed`, which is
  the map's data being wrong rather than this build being incomplete.

## Changing the world

- A result goes through the seam a command handler would: `spawnSettler`, `spawnAnimalHerd`,
  `placeBuilding`. It never assembles an entity of its own, so a scripted unit and a placed one carry
  the same components in the same order.
- A script removal is not a death: only a drained life pool reaches the reaper and the player tallies.
- Two goals write as well as read: `BuildHumans` and `BuildHouses` stamp the object id on what they
  counted, which is why they collect and sort where the other counting goals do not.

## The behaviour mask

Each bit is read by the system that owns its mechanic: a result writes the mask and the needs,
planner, combat, command, trade and movement systems decide what it means. An evaluator here reads a
bit only for a mechanic that is the script's own - script damage checks the indestructible house bit,
because no other system deals that damage. Anything else would put one mechanic in two places.

## The unlock tables

A result writes a player's script unlock tables (`components/unlocks.ts`). The progression gates read
the enabled table beside the living-trade rule, and the `JobEnabled` and `GoodProduceable` goals go
through those gates rather than the table, so a script and a settler unlock one and the same thing.
The allowed table has no reader yet.

## The player tables

A result that changes a player's standing writes a player table beside the world, never an entity: a
stance, a lock, a verdict, an AI flag, an attacked-by mark. A verdict is read by the match outcome
and announced through the match events; the rest are read here or not yet at all. A reveal goes
through `FogState` like the vision system's own stamps.

The tribute table is the one player table a seat command reads and writes: `tributes.ts` counts and
drains the payer's houses through the same stock seams the goods results use, and the command system
hands `payTribute` to it. The window's read of the table is the `Simulation` probe, never the component.

## The display

A result that only shows something emits an event and changes nothing: the cutscene, the sound, the
camera, the selection, the markers, the weather, the quake. Of what the original keeps past the
frame, the current briefing page, the info lines and a human's `ScriptedName` are state here as
well, saved and hashed like the rest; the markers and the weather are not, which the format doc
names as an approximation. An info line stores what to tally, never the tally; the `Simulation`
probe counts through the same helpers the area goals use, so the display and a goal never disagree
about a count. A cutscene halts the pass after its mission, which is the one result that changes
the order the others run in.

Landscape placements and type footprints are immutable numeric map input. Scripted replacements,
removals, build bans and vertex palette indices are lazy `LandscapeEdits` state, saved and hashed.
The ground graph excludes those placements; their collision is a derived overlay shared by routing
and placement. Resource-backed objects use the existing resource lifecycle. The app reads detached
edits after change events and on restore, then updates retained landscape sprites and terrain buffers.
Color changes do not invalidate collision caches.

## Cost

A pass costs the active missions and their goals. An evaluator that addresses mission object ids goes
through `missionObjects`, never a walk over every entity. A goal that only counts what a player has
standing walks the population once per check and allocates nothing; keep it that way rather than
sorting or collecting to count. A goal that stamps what it counted must leave an id already held
alone, or it rebuilds the object index and re-clones its matches every pass. A mission probed by
several `CheckMission` goals is evaluated once per probe, which also redraws its `RandomTimeGone`
spans; the original does the same, so do not add a per-pass memo without saying what it does to the
RNG stream.
