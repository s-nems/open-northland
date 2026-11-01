import {
  type Component,
  type DeepReadonly,
  defineComponent,
  type Entity,
  type World,
} from '../../ecs/world.js';
import { defineWorldSingleton } from '../../ecs/world-singleton.js';

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

/** Renumber an entity a script addresses; 0 clears the id. An id already held is left alone: scripts
 *  renumber the same group every pass, and a re-add rebuilds the object index and re-clones it. */
export function restampMissionId(world: World, e: Entity, id: number): void {
  if (id === 0) world.remove(e, MissionObjectId);
  else if (world.tryGet(e, MissionObjectId)?.id !== id) world.add(e, MissionObjectId, { id });
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
 * The palette recipes a map's `[misc_humangraphics]` rows laid over one human at build, lower-cased
 * `randompalette.ini` names in file order. The sim never reads them; the app composes them into the
 * human's palettes. Original behavior: the rows apply once, at map load, to every human then carrying
 * the row's mission object id, so a human a script spawns later with that id keeps its own look.
 */
export const ScriptedLook = defineComponent<{ recipes: string[] }>('ScriptedLook', 'settlers');

/** Bounds on a {@link ScriptedLook} a spawn payload may carry; the corpus stacks at most ten recipes on
 *  one human, and the longest `randompalette.ini` name has 38 characters. */
export const SCRIPTED_LOOK_MAX_RECIPES = 32;
export const SCRIPTED_LOOK_RECIPE_MAX_CHARS = 64;

/**
 * How large one unit draws, in percent of its look's own size, scaled about its feet. Absent means 100:
 * {@link setVisualScale} never stores the full size, so an unscaled unit carries nothing. The sim never
 * reads it; the renderer sizes the unit's sprites, glow, outline and picking box by it.
 */
export const VisualScale = defineComponent<{ pct: number }>('VisualScale', 'settlers');

/** The size every unit draws at unless a {@link VisualScale} says otherwise. */
export const VISUAL_SCALE_FULL_PCT = 100;

/** Give `e` a drawn size of `pct` percent; the full size drops the component. */
export function setVisualScale(world: World, e: Entity, pct: number): void {
  if (pct === VISUAL_SCALE_FULL_PCT) {
    if (world.has(e, VisualScale)) world.remove(e, VisualScale);
  } else if (world.tryGet(e, VisualScale)?.pct !== pct) world.add(e, VisualScale, { pct });
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
  /** {@link missionClock} at the last inactive-to-active transition, the epoch `TimeGone` counts from;
   *  1 for a mission active when the script loaded, 0 until first activated. */
  activationClock: number;
  /** Per goal, whether it held at the last check. Rewritten by every check, never latched. */
  goalsHeld: boolean[];
  /** Goal indices whose last check was unavailable; omitted when every answer was known. */
  unknownGoals?: number[] | undefined;
  /** Per goal, the seconds a `RandomTimeGone` drew for the current activation; 0 while undrawn. */
  randomSeconds: number[];
  /** Whether the last check established success; false also covers an unavailable verdict. */
  evaluated: boolean;
  /** Execution history excludes goal-only probes and survives later failed checks. */
  firstFiredTick?: number;
  lastFiredTick?: number;
  fireCount?: number;
}

interface MissionStateValue {
  /** The tick the mission system first ran the script on, which counts as the script's load. */
  loadTick: number;
  missions: MissionRecord[];
}

const missionState = defineWorldSingleton<MissionStateValue>(
  'MissionState',
  'players',
  () => ({
    loadTick: 0,
    missions: [],
  }),
  { simOnly: true },
);

/** The per-mission state of the world's script, materialized on the mission system's first tick and
 *  saved and hashed from there on. Absent for every world that runs no script. */
const MissionState: Component<MissionStateValue> = missionState.component;

/** The script clock at load: missions active from the start carry it as their activation. */
export const MISSION_LOAD_CLOCK = 1;

export function missionRecords(world: World): DeepReadonly<MissionRecord[]> {
  return missionState.read(world).missions;
}

/** True once the script's records exist; false means the mission system has not initialized them. */
export function missionStateExists(world: World): boolean {
  return world.lowestEntityWith(MissionState) !== null;
}

/** Load the script's records on `tick`, which starts the {@link missionClock} at {@link MISSION_LOAD_CLOCK}. */
export function createMissionState(world: World, tick: number, missions: MissionRecord[]): void {
  missionState.write(world, (state) => {
    state.loadTick = tick;
    state.missions = missions;
  });
}

/**
 * The script clock on `tick`: {@link MISSION_LOAD_CLOCK} when the script loads, then one more per tick.
 * Original behavior: the game-time counter is set to 1 before the script loads and raised at the start
 * of every tick, and the missions are evaluated at the end of that tick. The mission system runs before
 * this build's world systems, so its pass on clock `c` has seen `c - 1` ticks, as the original's has.
 */
export function missionClock(world: World, tick: number): number {
  return tick - missionState.read(world).loadTick + MISSION_LOAD_CLOCK;
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
