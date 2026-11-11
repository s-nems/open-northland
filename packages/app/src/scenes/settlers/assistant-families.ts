import type { Entity, Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_CIVILIST, JOB_WOMAN } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import { placeBuiltSandboxBuilding, spawnSettlerDirect } from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const MAP_W = 26;
const MAP_H = 12;
/** A two-family home, so two weddings play side by side. */
const HOME_REF = 'home_level_01';
const HOME = { x: 18, y: 5 } as const;
/** One woman more than the home has family slots, so one stays homeless. */
const WOMEN_PAST_SLOTS = 1;
const WOMEN_ROW = 3;
const MEN_ROW = 8;
const FIRST_COLUMN = 3;
const COLUMN_STEP = 2;
/** The walks to the wedding spots and the kisses end well inside this. */
const RUN_TICKS = 1500;
const INITIAL_ZOOM = 1.1;

const { Building, Female, Marriage, Residence, Settler } = components;

function home(sim: Simulation): Entity {
  for (const e of sim.world.query(Building)) return e;
  throw new Error('assistant-families scene: no home placed');
}

function familySlots(sim: Simulation): number {
  const type = sim.world.get(home(sim), Building).buildingType;
  const slots = sim.content.buildings.find((building) => building.typeId === type)?.homeSize;
  if (slots === undefined) throw new Error('assistant-families scene: the home has no family slots');
  return slots;
}

function women(sim: Simulation): Entity[] {
  return [...sim.world.query(Female, Settler)];
}

function build(sim: Simulation): void {
  placeBuiltSandboxBuilding(sim, HOME_REF, HOME.x, HOME.y);
  for (let i = 0; i < familySlots(sim) + WOMEN_PAST_SLOTS; i++) {
    const column = FIRST_COLUMN + COLUMN_STEP * i;
    spawnSettlerDirect(sim, JOB_WOMAN, column, WOMEN_ROW);
    spawnSettlerDirect(sim, JOB_CIVILIST, column, MEN_ROW);
  }
  sim.enqueueSetup({ kind: 'setAssistantFoundFamilies', player: HUMAN_PLAYER, enabled: true });
}

export const assistantFamiliesScene: SceneDefinition = {
  id: 'assistant-families',
  seed: 12,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'the home is full: a woman lives in each of its family slots',
      predicate: (sim) =>
        women(sim).filter((e) => sim.world.tryGet(e, Residence)?.home === home(sim)).length ===
        familySlots(sim),
    },
    {
      label: 'every housed woman is wed and her husband lives with her',
      predicate: (sim) =>
        women(sim)
          .filter((e) => sim.world.has(e, Residence))
          .every((e) => {
            const spouse = sim.world.tryGet(e, Marriage)?.spouse;
            return spouse !== undefined && sim.world.tryGet(spouse, Residence)?.home === home(sim);
          }),
    },
    {
      label: 'the woman left without a home stays single',
      predicate: (sim) => {
        const homeless = women(sim).filter((e) => !sim.world.has(e, Residence));
        return homeless.length === WOMEN_PAST_SLOTS && homeless.every((e) => !sim.world.has(e, Marriage));
      },
    },
  ],
};
