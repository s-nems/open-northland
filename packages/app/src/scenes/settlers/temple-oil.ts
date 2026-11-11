import { components, type Entity, type Simulation } from '@open-northland/sim';
import { grassTerrain, VIKING } from '../../catalog/buildings.js';
import { FRANK, SARACEN } from '../../catalog/civilizations.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_DRUID_HUT,
  BUILDING_TEMPLE,
  placeBuiltSandboxBuilding,
  spawnWorkersAtDoor,
} from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

const { Building, Health, setStockAmount, TempleFire } = components;

const MAP_W = 60;
const MAP_H = 30;
// Both dark temples stand inside the druid's reach from his hut, one either side.
const VIKING_TEMPLE = { x: 15, y: 10 } as const;
const FRANK_TEMPLE = { x: 45, y: 10 } as const;
const SARACEN_TEMPLE = { x: 30, y: 24 } as const;
const HUT = { x: 30, y: 13 } as const;

/** Oil already boiled in the hut, so the druid sets out at once, and mushrooms for more. */
const HUT_OIL = 2;
const HUT_MUSHROOMS = 10;
/** The wounded temple's full store, which it keeps unburned. */
const FULL_STORE = 5;
/** A druid's walk to each temple and back, with a brew between. */
const RUN_TICKS = 2400;
const INITIAL_ZOOM = 0.5;

const blesses = (sim: Simulation, temple: Entity): boolean =>
  sim.world.tryGet(temple, TempleFire)?.blessing === true;

/** The temple of `tribe` standing in the scene. */
function templeOf(sim: Simulation, tribe: number): Entity {
  for (const e of sim.world.query(Building, TempleFire)) {
    if (sim.world.get(e, Building).tribe === tribe) return e;
  }
  throw new Error(`temple-oil: no temple of tribe ${tribe}`);
}

function build(sim: Simulation): void {
  const oil = goodBySlug(sim, 'holy_oil');
  const viking = placeBuiltSandboxBuilding(sim, BUILDING_TEMPLE, VIKING_TEMPLE.x, VIKING_TEMPLE.y);
  const frank = placeBuiltSandboxBuilding(
    sim,
    BUILDING_TEMPLE,
    FRANK_TEMPLE.x,
    FRANK_TEMPLE.y,
    HUMAN_PLAYER,
    {
      tribe: FRANK,
    },
  );
  for (const dark of [viking, frank]) setStockAmount(sim.world, dark, oil, 0);
  const wounded = placeBuiltSandboxBuilding(
    sim,
    BUILDING_TEMPLE,
    SARACEN_TEMPLE.x,
    SARACEN_TEMPLE.y,
    HUMAN_PLAYER,
    { tribe: SARACEN },
  );
  setStockAmount(sim.world, wounded, oil, FULL_STORE);
  sim.world.mut(wounded, Health).hitpoints -= 1;
  const hut = placeBuiltSandboxBuilding(sim, BUILDING_DRUID_HUT, HUT.x, HUT.y);
  setStockAmount(sim.world, hut, oil, HUT_OIL);
  setStockAmount(sim.world, hut, goodBySlug(sim, 'mushroom'), HUT_MUSHROOMS);
  spawnWorkersAtDoor(sim, hut, 1);
}

/** Two temples start dark, a druid lights both with his oil, and a wounded one stays dark on a full store:
 *  watch the viking fire and every temple's pale glow come and go. */
export const templeOilScene: SceneDefinition = {
  id: 'temple-oil',
  seed: 43,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  progression: false,
  checks: [
    {
      label: 'the druid carried oil to both empty temples, and they bless',
      predicate: (sim) => blesses(sim, templeOf(sim, VIKING)) && blesses(sim, templeOf(sim, FRANK)),
    },
    {
      label: 'the wounded temple keeps its full store and blesses nobody',
      predicate: (sim) => !blesses(sim, templeOf(sim, SARACEN)),
    },
  ],
};
