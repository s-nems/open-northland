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
  that cannot be judged does not hold, so its mission waits instead of firing on an answer nobody
  computed.

## Cost

A pass costs the active missions and their goals. An evaluator that addresses mission object ids goes
through `missionObjects`, never a walk over every entity. A mission probed by several `CheckMission`
goals is evaluated once per probe, which also redraws its `RandomTimeGone` spans; the original does
the same, so do not add a per-pass memo without saying what it does to the RNG stream.
