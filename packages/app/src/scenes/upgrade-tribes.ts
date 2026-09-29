import type { Simulation } from '@open-northland/sim';
import { components, ONE } from '@open-northland/sim';
import { grassTerrain, VIKING } from '../catalog/buildings.js';
import { JOB_BUILDER } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
  placeBuiltSandboxBuilding,
  placeSandboxBuilding,
  spawnSandboxSettler,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const { Building } = components;

/** `TRIBE_TYPE_HUMAN_FRANK` (`logicdefines.inc`): a civilization whose `[GfxHouse]` rows carry no
 *  upgrade pass, unlike the viking base skin. */
const FRANK = 2;

const MAP_W = 24;
const MAP_H = 16;
const HQ = { x: 6, y: 6 } as const;
const VIKING_HOME = { x: 12, y: 6 } as const;
const FRANK_HOME = { x: 17, y: 6 } as const;
/** The viking upgrade, the slower of the two, measured ~8k ticks; the rest is slack. */
const RUN_TICKS = 12_000;

const NEXT_TIER = BUILDING_HOME_00 + 1;

/** Each home gets a builder of its own tribe, since a builder works only its own tribe's sites. */
const HOMES = [
  { tribe: VIKING, at: VIKING_HOME, builder: { x: 10, y: 8 } },
  { tribe: FRANK, at: FRANK_HOME, builder: { x: 15, y: 8 } },
] as const;

function build(sim: Simulation): void {
  // Precedes the upgrade commands in the setup queue so real content's tier gate admits them; the scene
  // shows the look, and technology has its own acceptance scene.
  sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: false });
  placeSandboxBuilding(sim, BUILDING_HEADQUARTERS, HQ.x, HQ.y, HUMAN_PLAYER, { fillStock: true });
  for (const { tribe, at, builder } of HOMES) {
    spawnSandboxSettler(sim, JOB_BUILDER, builder.x, builder.y, HUMAN_PLAYER, { tribe });
    const home = placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, at.x, at.y, HUMAN_PLAYER, { tribe });
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: home });
  }
}

function finishedNextTier(sim: Simulation, tribe: number): boolean {
  for (const e of sim.world.query(Building)) {
    const b = sim.world.get(e, Building);
    if (b.buildingType === NEXT_TIER && b.tribe === tribe && b.built >= ONE) return true;
  }
  return false;
}

/** A viking and a frank home upgrading side by side, each in its own tribe's skin throughout. */
export const upgradeTribesScene: SceneDefinition = {
  id: 'upgrade-tribes',
  seed: 5,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  graphicTribes: [VIKING, FRANK],
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'both homes reached the next tier in their own tribe',
      predicate: (sim) => HOMES.every(({ tribe }) => finishedNextTier(sim, tribe)),
    },
  ],
};
