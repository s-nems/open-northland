import { type ContentSet, parseContentSet } from '@open-northland/data';
import { expect } from 'vitest';
import { Health, missionRecords } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  type SimEvent,
  type SimEventKind,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import type { MissionDefinition, MissionGoalOp, MissionResultOp } from '../../src/systems/missions/index.js';
import { MISSION_EVALUATION_TICKS, missionObjects, SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/** What the stage's spawn, removal, ownership and counting tests share: a mapped world running one
 *  script, and a content set with a house chain, which the base fixture has none of. */

/** The tick the first pass runs on - `setMissionsEnabled` applies on tick 1. */
export const FIRST_PASS = MISSION_EVALUATION_TICKS;
export const MAP_NODES = 48;
export const VIKING = 1;
/** A second civilization sharing the house chain: one typeId belongs to five tribes in real content,
 *  so a scripted placement must take the tribe its line resolved, never one derived from the type. */
export const FRANK = 2;
export const WOODCUTTER = 1;
export const CARPENTER = 2;
/** `soldier_unarmed`, the fixture's soldier class. */
export const SOLDIER = 31;
/** The fixture headquarters: a storage that hires three woodcutters. */
export const HEADQUARTERS = 1;
/** A passive animal tribe in the fixture. */
export const WOLF = 9;
/** The player slot a `setanimal` names for game - outside the sim's range, so it owns nothing. */
export const WILD = 20;
export const POINT = { hx: 20, hy: 20 };

/** The two levels of the fixture house chain, footprinted so the placement search has a real fit
 *  test and `SetHouseExtensionLevel` a level to walk. */
export const HUT = 30;
export const HUT_LARGE = 31;

const HUT_FOOTPRINT = {
  blocked: [{ dx: 0, dy: 0 }],
  familyBody: [{ dx: 0, dy: 0 }],
  reserved: [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => ({ dx, dy }))),
};

export function houseContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: HUT,
        id: 'hut',
        kind: 'home',
        homeSize: 1,
        hitpoints: 100,
        // A build bill, so a site raised by the script stays one until someone hauls the wood in.
        construction: [{ goodType: 1, amount: 1 }],
        upgradeTarget: HUT_LARGE,
        footprint: HUT_FOOTPRINT,
      },
      {
        typeId: HUT_LARGE,
        id: 'hut_large',
        kind: 'home',
        homeSize: 2,
        hitpoints: 300,
        footprint: HUT_FOOTPRINT,
      },
    ],
    // Both civilizations bind the same two types, the shape the shipped house table has.
    buildingBobs: [
      { tribeId: VIKING, typeId: HUT, level: 0, bmd: 'hut', paletteName: 'house01', bobId: 0 },
      { tribeId: VIKING, typeId: HUT_LARGE, level: 1, bmd: 'hut', paletteName: 'house01', bobId: 1 },
      { tribeId: FRANK, typeId: HUT, level: 0, bmd: 'hut', paletteName: 'house02', bobId: 2 },
      { tribeId: FRANK, typeId: HUT_LARGE, level: 1, bmd: 'hut', paletteName: 'house02', bobId: 3 },
    ],
  });
}

export function missionSim(
  missions: readonly MissionDefinition[],
  content: ContentSet = testContent(),
  map = grassNodeMap(MAP_NODES, MAP_NODES),
): Simulation {
  const sim = new Simulation({ seed: 1, content, map, missions: { missions } });
  sim.enqueueSetup({ kind: 'setMissionsEnabled', enabled: true });
  return sim;
}

/** A world whose one mission fires on the first pass: a mission with no goals holds under `all`. */
export function firingSim(
  results: readonly MissionResultOp[],
  content: ContentSet = testContent(),
  map = grassNodeMap(MAP_NODES, MAP_NODES),
): Simulation {
  return missionSim(
    [{ successfullIf: SUCCESSFUL_IF.all, active: true, visible: false, goals: [], results }],
    content,
    map,
  );
}

/** A world with one mission whose only goal is the one under test and whose results are empty, so
 *  the stored verdict is the whole tell. */
export function goalSim(goal: MissionGoalOp, content: ContentSet = testContent()): Simulation {
  return missionSim(
    [{ successfullIf: SUCCESSFUL_IF.all, active: true, visible: false, goals: [goal], results: [] }],
    content,
  );
}

export function holds(sim: Simulation): boolean {
  return missionRecords(sim.world)[0]?.evaluated === true;
}

export interface SpawnSpec {
  readonly player?: number;
  readonly job?: number;
  readonly at?: { hx: number; hy: number };
  readonly missionId?: number;
  readonly behaviourFlags?: number;
  readonly home?: { readonly x: number; readonly y: number };
  readonly workplace?: { readonly x: number; readonly y: number };
}

export function spawn(sim: Simulation, spec: SpawnSpec): void {
  const at = spec.at ?? POINT;
  sim.enqueueSetup({
    kind: 'spawnSettler',
    jobType: spec.job ?? WOODCUTTER,
    tribe: VIKING,
    x: at.hx,
    y: at.hy,
    ...(spec.player !== undefined ? { owner: spec.player } : {}),
    ...(spec.missionId !== undefined ? { missionId: spec.missionId } : {}),
    ...(spec.behaviourFlags !== undefined ? { behaviourFlags: spec.behaviourFlags } : {}),
    ...(spec.home !== undefined ? { home: spec.home } : {}),
    ...(spec.workplace !== undefined ? { workplace: spec.workplace } : {}),
  });
}

/** The single entity carrying `id`; a fixture that spawned none or several is a test bug. */
export function stamped(sim: Simulation, id: number): Entity {
  const [e, ...rest] = missionObjects(sim.world, id);
  if (e === undefined || rest.length > 0) throw new Error(`expected one entity with id ${id}`);
  return e;
}

/** Drain a settler's life pool and let the cleanup system reap it at the end of the tick. */
export function kill(sim: Simulation, victim: Entity): void {
  sim.world.mut(victim, Health).hitpoints = 0;
  sim.step();
}

/** Step to `tick`, keeping the events of the named kinds with the tick each fired on. */
export function eventsUntil(
  sim: Simulation,
  tick: number,
  kinds: readonly SimEventKind[],
): { tick: number; event: SimEvent }[] {
  const out: { tick: number; event: SimEvent }[] = [];
  while (sim.tick < tick) {
    sim.step();
    for (const event of sim.events.current()) {
      if (kinds.includes(event.kind)) out.push({ tick: sim.tick, event });
    }
  }
  return out;
}

/** The opcodes of the results that ran but could not act, up to `tick`. */
export function failedResultsUntil(sim: Simulation, tick: number): string[] {
  return eventsUntil(sim, tick, ['missionResultFailed']).map(({ event }) =>
    event.kind === 'missionResultFailed' ? event.opcode : '',
  );
}

/** A restore of the sim's save on the same map and script, checked to hash the same. */
export function roundTrip(sim: Simulation): Simulation {
  const bytes = serializeSaveGame(exportSaveGame(sim));
  const restored = restoreSimulation(parseSaveGame(JSON.parse(bytes)), {
    content: sim.content,
    map: grassNodeMap(MAP_NODES, MAP_NODES),
    ...(sim.missions !== undefined ? { missions: sim.missions } : {}),
  }).sim;
  expect(restored.hashState()).toBe(sim.hashState());
  return restored;
}
