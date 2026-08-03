import type { Entity, Simulation } from '@open-northland/sim';
import { components, ONE } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_BUILDER, JOB_COLLECTOR } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
  buildingDef,
  placeBuiltSandboxBuilding,
  placeSandboxBuilding,
  spawnSandboxSettler,
} from '../game/sandbox/index.js';
import { buildingOfType } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 26;
const MAP_H = 18;
const HQ = { x: 9, y: 6 } as const;
const UPGRADED_HOME = { x: 14, y: 6 } as const;
/** Left untouched, so a human can exercise the Upgrade button on it in the browser. */
const BUTTON_HOME = { x: 20, y: 11 } as const;
const BUILDER = { x: 12, y: 7 } as const;
/** Real content gates the home tiers on a collector's presence (`jobEnablesHouse 8`), so the browser
 *  run needs one on the map even though it has nothing to gather. */
const COLLECTOR = { x: 7, y: 9 } as const;
/** The level difference is 7 units, each ~1k ticks of fetch-and-hammer observed, so this leaves slack
 *  past the measured full run. */
const RUN_TICKS = 10_000;

const { Building, Stockpile, UnderConstruction, Upgrading } = components;

const NEXT_TIER = BUILDING_HOME_00 + 1;

function build(sim: Simulation): void {
  placeSandboxBuilding(sim, BUILDING_HEADQUARTERS, HQ.x, HQ.y, HUMAN_PLAYER, { fillStock: true });
  // Placed directly so its entity id can seed the build-time upgrade command.
  const home = placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, UPGRADED_HOME.x, UPGRADED_HOME.y);
  placeSandboxBuilding(sim, BUILDING_HOME_00, BUTTON_HOME.x, BUTTON_HOME.y, HUMAN_PLAYER);
  spawnSandboxSettler(sim, JOB_BUILDER, BUILDER.x, BUILDER.y, HUMAN_PLAYER);
  spawnSandboxSettler(sim, JOB_COLLECTOR, COLLECTOR.x, COLLECTOR.y, HUMAN_PLAYER);
  sim.enqueue({ kind: 'upgradeBuilding', building: home });
}

/** The scene places at most one next-tier building. */
function upgradedHome(sim: Simulation): Entity | null {
  return buildingOfType(sim, NEXT_TIER);
}

/** Derived as the gap from the HQ's filled capacity, which only the upgrade draws on here. */
function hqDrawnGoods(sim: Simulation): Map<number, number> {
  const drawn = new Map<number, number>();
  const def = buildingDef(sim, BUILDING_HEADQUARTERS);
  for (const e of sim.world.query(Building, Stockpile)) {
    if (sim.world.get(e, Building).buildingType !== BUILDING_HEADQUARTERS) continue;
    const amounts = sim.world.get(e, Stockpile).amounts;
    for (const slot of def?.stock ?? []) {
      const missing = slot.capacity - (amounts.get(slot.goodType) ?? 0);
      if (missing > 0) drawn.set(slot.goodType, missing);
    }
  }
  return drawn;
}

export const upgradeScene: SceneDefinition = {
  id: 'upgrade',
  seed: 4,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'the commanded home adopted the next tier (level 2) and finished building',
      predicate: (sim) => {
        const e = upgradedHome(sim);
        if (e === null) return false;
        const b = sim.world.get(e, Building);
        return b.level === 1 && b.built >= ONE;
      },
    },
    {
      label: 'the upgrade markers are gone - a finished building is a plain Building again',
      predicate: (sim) => {
        const e = upgradedHome(sim);
        return e !== null && !sim.world.has(e, UnderConstruction) && !sim.world.has(e, Upgrading);
      },
    },
    {
      label: 'the HQ paid exactly the level DIFFERENCE - the next tier own bill, no cumulative surcharge',
      predicate: (sim) => {
        const bill = buildingDef(sim, NEXT_TIER)?.construction ?? [];
        const drawn = hqDrawnGoods(sim);
        if (bill.length === 0 || drawn.size !== bill.length) return false;
        return bill.every((line) => drawn.get(line.goodType) === line.amount);
      },
    },
    {
      label: 'the second home is untouched (still level 1) - the browser Upgrade-button target',
      predicate: (sim) => {
        const e = buildingOfType(sim, BUILDING_HOME_00);
        if (e === null) return false;
        const b = sim.world.get(e, Building);
        return b.built >= ONE && b.level === 0;
      },
    },
  ],
};
