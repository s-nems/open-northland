import { components, type Entity, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { CIVILIZATIONS } from '../../catalog/civilizations.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_DRUID_HUT,
  BUILDING_TEMPLE,
  placeBuiltSandboxBuilding,
  spawnWorkersAtDoor,
} from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

const { Building, Health, setStockAmount, Stockpile, TempleFire } = components;

const MAP_W = 100;
const MAP_H = 36;
/** One column per civilization: its temple above its druid's hut. */
const FIRST_COLUMN_X = 10;
const COLUMN_STEP = 20;
const TEMPLE_Y = 10;
const HUT_Y = 18;
/** The wounded viking temple, below the middle column. */
const WOUNDED_TEMPLE = { x: 50, y: 29 } as const;

/** Oil already boiled in each hut, so every druid sets out at once, and mushrooms for more. */
const HUT_OIL = 2;
const HUT_MUSHROOMS = 10;
/** The wounded temple's full store, which it keeps unburned. */
const FULL_STORE = 5;
/** A druid's walk to a temple and back, with a brew between. */
const RUN_TICKS = 3000;
const INITIAL_ZOOM = 0.4;

const blesses = (sim: Simulation, temple: Entity): boolean =>
  sim.world.tryGet(temple, TempleFire)?.blessing === true;

/** Every temple standing in the scene, the wounded one apart. */
function temples(sim: Simulation): { dark: Entity[]; wounded: Entity | undefined } {
  const dark: Entity[] = [];
  let wounded: Entity | undefined;
  for (const e of sim.world.query(Building, TempleFire)) {
    const hp = sim.world.tryGet(e, Health);
    if (hp !== undefined && hp.hitpoints < hp.max) wounded = e;
    else dark.push(e);
  }
  return { dark, wounded };
}

function build(sim: Simulation): void {
  const oil = goodBySlug(sim, 'holy_oil');
  CIVILIZATIONS.forEach((tribe, column) => {
    const x = FIRST_COLUMN_X + column * COLUMN_STEP;
    const temple = placeBuiltSandboxBuilding(sim, BUILDING_TEMPLE, x, TEMPLE_Y, HUMAN_PLAYER, { tribe });
    setStockAmount(sim.world, temple, oil, 0);
    const hut = placeBuiltSandboxBuilding(sim, BUILDING_DRUID_HUT, x, HUT_Y, HUMAN_PLAYER, { tribe });
    setStockAmount(sim.world, hut, oil, HUT_OIL);
    setStockAmount(sim.world, hut, goodBySlug(sim, 'mushroom'), HUT_MUSHROOMS);
    spawnWorkersAtDoor(sim, hut, 1, { tribe });
  });
  const wounded = placeBuiltSandboxBuilding(sim, BUILDING_TEMPLE, WOUNDED_TEMPLE.x, WOUNDED_TEMPLE.y);
  setStockAmount(sim.world, wounded, oil, FULL_STORE);
  sim.world.mut(wounded, Health).hitpoints -= 1;
}

/** Every civilization's temple starts dark beside its druid's hut, and the druids light them all with
 *  their oil; a wounded viking temple stays dark on a full store. Watch the viking fire and every
 *  temple's pale glow come and go. */
export const templeOilScene: SceneDefinition = {
  id: 'temple-oil',
  seed: 43,
  terrain: grassTerrain(MAP_W, MAP_H),
  graphicTribes: CIVILIZATIONS,
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  progression: false,
  checks: [
    {
      label: "the druids carried oil to every civilization's empty temple, and they bless",
      predicate: (sim) => {
        const { dark } = temples(sim);
        return dark.length === CIVILIZATIONS.length && dark.every((t) => blesses(sim, t));
      },
    },
    {
      label: 'the wounded temple keeps its full store and blesses nobody',
      predicate: (sim) => {
        const { wounded } = temples(sim);
        if (wounded === undefined) return false;
        const stored = sim.world.get(wounded, Stockpile).amounts.get(goodBySlug(sim, 'holy_oil'));
        return !blesses(sim, wounded) && stored === FULL_STORE;
      },
    },
  ],
};
