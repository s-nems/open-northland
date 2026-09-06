# Run mission scripts in the sim: scheduler, mission state, control-flow opcodes

**Area:** sim, tooling · **Focus:** `systems/missions` · **Priority:** P2

Map-scripts epic, stage 2 of 10. Stage 1 landed the typed opcode registry: `decodeMissionGoal` and
`decodeMissionResult` in `@open-northland/data` turn one raw `MapScriptLine` into
`{ opcode, ...named parameters }`, an unknown name into `True` or `None`, and report the warnings.
Reference: [`docs/formats/MISSIONS.md`](../../formats/MISSIONS.md), section "Execution model".

Nothing in `packages/sim` reads a map's missions. Campaign maps therefore never spawn their scripted
waves, never unlock, and never end. This stage builds the engine that later stages fill with
opcodes, behind a rule flag so `main` stays unchanged for players until stage 10.

## Scope

- Mission definitions are content, not save state: the app hands the decoded script, with every
  name already resolved to a numeric content id, to the sim at world build and again on restore.
  The save keeps only the mission state below and the map id it belongs to.
- A `MissionObjectId` component with an id-to-entities index for humans, houses, animals, and (when
  they exist) vehicles, populated from the placed entities' `missionId` fields and updated by spawn
  and removal. Ids are group names, not unique keys.
- The app join still drops those fields: `resolveAuthoredPlacements` reads the `AuthoredEntities`
  lanes only, so carry `missionId` (and the human `behaviourFlags`, opaque until stage 4) through
  `AuthoredPlacement` into the spawned entities.
- Mission state as hashed and saved world state: per mission the active flag, activation tick, per
  goal truth flags, the evaluated flag, the `RandomTimeGone` cache, and the visible flag. Bump
  `SAVE_FORMAT_VERSION` with a migration that leaves old worlds without missions.
- A `MissionSystem` that evaluates every 36 ticks (a named constant with its source basis: a reading
  of the original, 3 seconds at 12 ticks per second), in mission order, with the `successfullif`
  rules, the deactivate-then-execute order, non-latched goal flags, activation-tick semantics, the
  stop flag after a cutscene, and `RandomTimeGone` drawn from the sim's seeded generator. Implement
  goals `True`, `TimeGone`, `RandomTimeGone`, `IsMissionDone`, `IfMissionIsActive`, `CheckMission`
  and results `None`, `ActivateMission`, `DeactivateMission`, `SetVisible`, `DisableAll`, `Exit` (as
  an event).
- Every opcode without an executor emits one `missionUnsupported` event per mission and opcode when
  first reached and never throws. Presentation-only results are sim events; the sim never touches
  the display.
- `WorldRules.missionsEnabled`, default `false`, next to `needsEnabled`. World build wires the
  decoded script only when enabled.
- A coverage report over the local corpus (a small script under `tools/` or `scripts/`) printing,
  per map, supported and unsupported goal and result lines, plus a total. Every later stage states
  its coverage delta with it.
- `packages/sim/src/systems/missions/AGENTS.md` with the module's stable rules: determinism, events
  only for presentation, no id-specific rules, unsupported means warn, evaluators scale with active
  goals and use the object-id index, numeric ids only at the boundary.
- Non-goals: any entity, economy, diplomacy, or presentation opcode.

## Where to look

`packages/sim/src/components/rules.ts` (the flag pattern), `components/match.ts` once the
victory-defeat branch lands (a singleton the app opens through a command), `core/events.ts`
(`SimEvent` union and `EventBuffer`), `core/rng.ts`, `systems/schedule.ts` and `systems/index.ts`
(how systems run per tick), `save/format.ts` and `save/migrate.ts`, `harness/scenario.ts` (headless
scenarios), `packages/app/src/entries/map/world.ts` (where the app builds a world from a map).

## Verify

Unit tests for the cadence, each `successfullif` value including a mission without goals, activation
tick behaviour on re-activation, `IsMissionDone` after firing and for a never-checked mission,
`CheckMission` not firing results, `DisableAll`. A headless scenario runs a synthetic script with a
self-re-activating loop and a `RandomTimeGone` goal twice with the same seed and asserts identical
fire ticks and state hashes; a save and restore mid-loop continues at the same tick. Golden hashes
stay unchanged with the flag off. The coverage report runs on the corpus and lists the six
control-flow opcodes as supported. Normal gates; the Vitest run includes `packages/app`.
