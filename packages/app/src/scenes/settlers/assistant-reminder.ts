import { components, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_COLLECTOR } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
} from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

const { Equipment, Settler, Stockpile, setStockAmount } = components;

const WIDTH = 26;
const HEIGHT = 16;
const HQ_AT = { x: 18, y: 8 } as const;
/** The goods the store holds, one of each per extractor. */
const STOCKED = ['shoes', 'tool_iron', 'mead'] as const;
const EXTRACTORS = [
  { x: 4, y: 5 },
  { x: 4, y: 8 },
  { x: 4, y: 11 },
] as const;
/** Longer than a walk to the store and back, so a man sent for gear would have it by the end. */
const RUN_TICKS = 600;

function storeHeld(sim: Simulation, slug: string): number {
  let held = 0;
  for (const e of sim.world.query(Stockpile))
    held += sim.world.get(e, Stockpile).amounts.get(goodBySlug(sim, slug)) ?? 0;
  return held;
}

/**
 * The assistant with every switch off, as a map starts: three bare extractors stand by a store that
 * holds shoes, iron tools and mead for each of them, and nobody goes for any. The notice column reminds
 * of each of the three switches, and a press on a reminder opens the assistant window; both are checked
 * by eye, the scene's own checks hold the sim's side.
 */
export const assistantReminderScene: SceneDefinition = {
  id: 'assistant-reminder',
  seed: 74,
  terrain: grassTerrain(WIDTH, HEIGHT),
  build: (sim) => {
    const hq = placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, HQ_AT.x, HQ_AT.y);
    for (const slug of STOCKED) setStockAmount(sim.world, hq, goodBySlug(sim, slug), EXTRACTORS.length);
    for (const { x, y } of EXTRACTORS) spawnSettlerDirect(sim, JOB_COLLECTOR, x, y, HUMAN_PLAYER);
  },
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'the store still holds every unit',
      predicate: (sim) => STOCKED.every((slug) => storeHeld(sim, slug) === EXTRACTORS.length),
    },
    {
      label: 'no extractor wears or carries anything',
      predicate: (sim) =>
        [...sim.world.query(Settler)].every((e) => {
          const gear = sim.world.tryGet(e, Equipment);
          return (
            gear === undefined ||
            (gear.boots === null && gear.tool === null && gear.misc.every((slot) => slot === null))
          );
        }),
    },
  ],
};
