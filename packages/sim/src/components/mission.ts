import { type Component, type DeepReadonly, defineComponent, type Entity, type World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';

/**
 * The mission object id a placed or scripted entity carries (`sethouse`/`sethuman`/`setanimal`/
 * `setvehicle` id column). An id names a group, never one entity: a script addresses every entity
 * stamped with the same value, and a placement authoring no id carries no component.
 */
export const MissionObjectId = defineComponent<{ id: number }>('MissionObjectId');

/** The `sethuman` behaviour mask a placed settler carries, stored verbatim (`MISSIONS.md`, "Human
 *  behaviour flags"). No system reads the bits yet. */
export const MissionBehaviour = defineComponent<{ flags: number }>('MissionBehaviour');

/** Stamps nothing for 0, the value the placement columns and the script both write for "no id". */
export function stampMissionId(world: World, e: Entity, id: number | undefined): void {
  if (id !== undefined && id !== 0) world.add(e, MissionObjectId, { id });
}

export function stampMissionBehaviour(world: World, e: Entity, flags: number | undefined): void {
  if (flags !== undefined && flags !== 0) world.add(e, MissionBehaviour, { flags });
}

/**
 * One mission's live state, indexed by the mission's position in the map's script - the same index
 * every `ActivateMission`, `DeactivateMission`, `CheckMission`, `IsMissionDone`, `IfMissionIsActive`
 * and `SetVisible` argument names. The mission's goals and results are content, not state, so only
 * what a pass changes lives here.
 */
export interface MissionRecord {
  active: boolean;
  visible: boolean;
  /** Tick of the last inactive-to-active transition, the epoch `TimeGone` counts from; 0 until first
   *  activated. */
  activationTick: number;
  /** Per goal, whether it held at the last check. Rewritten by every check, never latched. */
  goalsHeld: boolean[];
  /** Per goal, the seconds a `RandomTimeGone` drew for the current activation; 0 while undrawn. */
  randomSeconds: number[];
  /** Whether the last check satisfied the mission's `successfullif` rule. Rewritten by every check,
   *  including a `CheckMission` probe, so it is not the "has fired" flag `IsMissionDone` reads. */
  evaluated: boolean;
}

const missionState = defineWorldSingleton<{ missions: MissionRecord[] }>('MissionState', () => ({
  missions: [],
}));

/** The per-mission state of the world's script, materialized on the mission system's first tick and
 *  saved and hashed from there on. Absent for every world that runs no script. */
export const MissionState: Component<{ missions: MissionRecord[] }> = missionState.component;

export function missionRecords(world: World): DeepReadonly<MissionRecord[]> {
  return missionState.read(world).missions;
}

/** True once the script's records exist; false means the mission system has not initialized them. */
export function missionStateExists(world: World): boolean {
  return world.lowestEntityWith(MissionState) !== null;
}

/** The one write seam for mission state: a whole evaluation pass mutates inside a single call, so the
 *  store logs one value write per pass rather than one per record. */
export function writeMissionState(world: World, apply: (missions: MissionRecord[]) => void): void {
  missionState.write(world, (state) => {
    apply(state.missions);
  });
}
