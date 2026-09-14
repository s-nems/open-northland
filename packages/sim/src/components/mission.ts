import { type Component, type DeepReadonly, defineComponent, type Entity, type World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';

/**
 * The mission object id a placed or scripted entity carries (`sethouse`/`sethuman`/`setanimal`/
 * `setvehicle` id column). An id names a group, never one entity: a script addresses every entity
 * stamped with the same value, and a placement authoring no id carries no component.
 */
export const MissionObjectId = defineComponent<{ id: number }>('MissionObjectId', 'players');

/** Stamps nothing for 0, the value the placement columns and the script both write for "no id". */
export function stampMissionId(world: World, e: Entity, id: number | undefined): void {
  if (id !== undefined && id !== 0) world.add(e, MissionObjectId, { id });
}

/**
 * The name a map gave one human, as the id of a string in the map's own table: a `[misc_humannames]`
 * row at build or a `SetHumanName` result later. The app resolves it in the player's language; a
 * human without one shows its generated name.
 */
export const ScriptedName = defineComponent<{ stringId: number }>('ScriptedName', 'settlers');

export function nameHuman(world: World, e: Entity, stringId: number): void {
  if (world.has(e, ScriptedName)) world.mut(e, ScriptedName).stringId = stringId;
  else world.add(e, ScriptedName, { stringId });
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
  /** Goal indices whose last check was unavailable; omitted when every answer was known. */
  unknownGoals?: number[];
  /** Per goal, the seconds a `RandomTimeGone` drew for the current activation; 0 while undrawn. */
  randomSeconds: number[];
  /** Whether the last check established success; false also covers an unavailable verdict. */
  evaluated: boolean;
  /** Execution history excludes goal-only probes and survives later failed checks. */
  firstFiredTick?: number;
  lastFiredTick?: number;
  fireCount?: number;
}

const missionState = defineWorldSingleton<{ missions: MissionRecord[] }>('MissionState', 'players', () => ({
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

/** The briefing page the mission window opens on when nothing newer was shown: the last
 *  `PlayCutscene` that carried the replay flag. Null until one fires. */
const missionBriefing = defineWorldSingleton<{ page: number | null }>('MissionBriefing', 'players', () => ({
  page: null,
}));

export const MissionBriefing = missionBriefing.component;

export function missionBriefingPage(world: World): number | null {
  return missionBriefing.read(world).page;
}

function setMissionBriefingPage(world: World, page: number): void {
  missionBriefing.write(world, (state) => {
    state.page = page;
  });
}

/** The briefing window retains up to fifty distinct pages in first-shown order (reading). */
export const BRIEFING_HISTORY_LIMIT = 50;

const briefingHistory = defineWorldSingleton<{ pages: number[] }>(
  'MissionBriefingHistory',
  'players',
  () => ({
    pages: [],
  }),
);

export function missionBriefingHistory(world: World): number[] {
  return [...briefingHistory.read(world).pages];
}

/** Shows a briefing page: it joins the history, and with `replay` set it becomes the window's page. */
export function deliverMissionBriefing(world: World, page: number, replay: boolean): void {
  const pages = briefingHistory.read(world).pages;
  if (!pages.includes(page)) {
    briefingHistory.write(world, (state) => {
      state.pages = [...pages, page].slice(-BRIEFING_HISTORY_LIMIT);
    });
  }
  if (replay) setMissionBriefingPage(world, page);
}
