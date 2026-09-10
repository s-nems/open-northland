import { components, type MissionScript, type Simulation, SUCCESSFUL_IF, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import type { SceneDefinition } from './types.js';

/**
 * What a map script shows rather than changes. On its first pass the script opens briefing page 500,
 * writes two info lines for the seat (a plain one and a live head-count of the settlers at the ford),
 * names the hero after the scene's string table, plants a GUI marker, moves the camera to the ford,
 * plays a sound there, starts rain over it, shakes the ground and selects the hero. On the second a
 * follow-up mission opens page 501 without the replay flag, so the window's prev and next buttons
 * appear, rings the ford with magic markers and clears the first info line. The goal list shows the
 * three visible missions with their marks: the opening one done, the ford one open, the hall one
 * idle. The browser view pairs this with the mission window and the top-right info lines.
 */

const MAP_W = 24;
const MAP_H = 12;

const HERO_AT = { x: 6, y: 6 } as const;
const GUARD_AT = { x: 8, y: 6 } as const;
/** The ford the camera moves to and the info line counts around, in half-cell nodes. */
const FORD = { hx: 14, hy: 12 } as const;
const FORD_RANGE = 6;
/** How many settlers the ford should hold, the info line's second number. */
const FORD_WANTED = 4;

/** The scene's string table ids. */
export const OPENING_GOAL_TEXT = 1;
const FORD_GOAL_TEXT = 2;
const HALL_GOAL_TEXT = 3;
const WATCHING_TEXT = 10;
const FORD_COUNT_TEXT = 11;
export const HERO_NAME_TEXT = 20;
/** The briefing pages the script opens, authored in the scene's catalog entry. */
export const BRIEFING_PAGE = 500;
export const FOLLOW_UP_PAGE = 501;
/** The follow-up fires on the second pass: past this many seconds from the load tick. */
const FOLLOW_UP_SECONDS = 4;
/** The magic ring's radius around the ford, and its every-step spacing. */
const RING_RANGE = 3;
const RING_SPACING = 1;

/** The mission object id the hero carries, and the marker slot the script uses. */
export const HERO_ID = 100;
const MARKER_SLOT = 0;
/** The sound bank group the ford's sound names: "Open Wooden Chest" in the shipped bank. */
const FORD_SOUND = 56;
const RAIN_DENSITY = 60;
const QUAKE_SECONDS = 2;
/** The ford mission's goal never fires inside the run, so it stays open on the list. */
const FORD_HOLD_SECONDS = 3600;

/** Past the first pass, which fires everything, with one more pass to spare. */
const RUN_TICKS = 2 * systems.MISSION_EVALUATION_TICKS;

const { ScriptedName } = components;

const missions: MissionScript = {
  missions: [
    {
      successfullIf: SUCCESSFUL_IF.all,
      active: true,
      visible: true,
      description: OPENING_GOAL_TEXT,
      goals: [],
      results: [
        { opcode: 'InfoShowString', player: HUMAN_PLAYER, index: 0, stringId: WATCHING_TEXT },
        {
          opcode: 'InfoCountHumenInArea',
          player: HUMAN_PLAYER,
          index: 1,
          stringId: FORD_COUNT_TEXT,
          point: FORD,
          range: FORD_RANGE,
          extra: FORD_WANTED,
        },
        { opcode: 'SetHumanName', humanId: HERO_ID, stringId: HERO_NAME_TEXT },
        { opcode: 'SetGuiMarker', objectId: MARKER_SLOT, point: FORD },
        { opcode: 'SetCameraPosition', point: FORD },
        { opcode: 'PlaySound', sound: FORD_SOUND, point: FORD },
        { opcode: 'SetWeather', point: FORD, range: FORD_RANGE, flag: false, amount: RAIN_DENSITY },
        { opcode: 'StartEarthQuake', seconds: QUAKE_SECONDS },
        { opcode: 'SelectHuman', humanId: HERO_ID, flag: false },
        { opcode: 'PlayCutscene', cutscene: BRIEFING_PAGE, replay: true },
      ],
    },
    {
      successfullIf: SUCCESSFUL_IF.all,
      active: true,
      visible: true,
      description: FORD_GOAL_TEXT,
      goals: [{ opcode: 'TimeGone', seconds: FORD_HOLD_SECONDS }],
      results: [],
    },
    {
      successfullIf: SUCCESSFUL_IF.all,
      active: true,
      visible: false,
      goals: [{ opcode: 'TimeGone', seconds: FOLLOW_UP_SECONDS }],
      results: [
        { opcode: 'InfoClear', player: HUMAN_PLAYER, index: 0 },
        { opcode: 'SetMapAreaMarkerMagic', point: FORD, range: RING_RANGE, flag: true, index: RING_SPACING },
        { opcode: 'PlayCutscene', cutscene: FOLLOW_UP_PAGE, replay: false },
      ],
    },
    {
      successfullIf: SUCCESSFUL_IF.all,
      active: false,
      visible: true,
      description: HALL_GOAL_TEXT,
      goals: [],
      results: [],
    },
  ],
};

function build(sim: Simulation): void {
  // Soldiers stand where they spawn, so the head-count at the ford stays what the scene placed.
  for (const [at, missionId] of [
    [HERO_AT, HERO_ID],
    [GUARD_AT, undefined],
  ] as const) {
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: JOB_SOLDIER_SWORD,
      tribe: PRIMARY_TRIBE,
      x: at.x * 2,
      y: at.y * 2,
      owner: HUMAN_PLAYER,
      ...(missionId !== undefined ? { missionId } : {}),
    });
  }
}

export const presentationScene: SceneDefinition = {
  id: 'presentation',
  seed: 43,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  missions,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the opening mission left the briefing page as the one the window replays',
      predicate: (sim) => sim.missionBriefingPage() === BRIEFING_PAGE,
    },
    {
      label:
        'the follow-up cleared the first info line and left the count of settlers at the ford against the wanted number',
      predicate: (sim) => {
        const [line, ...rest] = sim.infoLines(HUMAN_PLAYER);
        return (
          rest.length === 0 &&
          line?.index === 1 &&
          line.stringId === FORD_COUNT_TEXT &&
          line.count === 2 &&
          line.extra === FORD_WANTED
        );
      },
    },
    {
      label: 'the hero carries the name the script gave it',
      predicate: (sim) => {
        const [only, ...rest] = [...sim.world.query(ScriptedName)];
        return (
          only !== undefined &&
          rest.length === 0 &&
          sim.world.get(only, ScriptedName).stringId === HERO_NAME_TEXT
        );
      },
    },
    {
      label: 'the goal list marks the opening done, the ford open and the hall idle',
      predicate: (sim) =>
        sim
          .missionStatus()
          .filter((m) => m.visible)
          .map((m) => (m.done ? 'done' : m.active ? 'open' : 'idle'))
          .join() === 'done,open,idle',
    },
  ],
};
