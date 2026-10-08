import type { Simulation } from '@open-northland/sim';
import { components, ONE } from '@open-northland/sim';
import { grassTerrain, VIKING } from '../catalog/buildings.js';
import { JOB_BUILDER } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_DRUID_HUT,
  BUILDING_DRUID_HUT_01,
  BUILDING_HEADQUARTERS,
  BUILDING_MASON_HUT,
  BUILDING_MASON_HUT_01,
  placeBuiltSandboxBuilding,
  placeSandboxBuilding,
  placeSandboxSite,
  spawnSandboxSettler,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const { Building } = components;

/** `TRIBE_TYPE_HUMAN_FRANK` (`logicdefines.inc`). */
const FRANK = 2;

const MAP_W = 28;
const MAP_H = 18;
const HQ = { x: 6, y: 9 } as const;
const MASON_SITE = { x: 13, y: 5 } as const;
const MASON_UPGRADE = { x: 13, y: 13 } as const;
const DRUID_UPGRADE = { x: 21, y: 9 } as const;
const BUILDERS = [
  { x: 10, y: 9 },
  { x: 11, y: 10 },
  { x: 17, y: 9 },
] as const;
/** Slack past the slowest of the three, the fresh mason hut. */
const RUN_TICKS = 14_000;

function build(sim: Simulation): void {
  // Precedes the upgrade commands so real content's tier gate admits them; technology has its own scene.
  sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: false });
  placeSandboxBuilding(sim, BUILDING_HEADQUARTERS, HQ.x, HQ.y, HUMAN_PLAYER, { fillStock: true });
  placeSandboxSite(sim, BUILDING_MASON_HUT, MASON_SITE.x, MASON_SITE.y, HUMAN_PLAYER, { tribe: FRANK });
  for (const [type, at] of [
    [BUILDING_MASON_HUT, MASON_UPGRADE],
    [BUILDING_DRUID_HUT, DRUID_UPGRADE],
  ] as const) {
    const built = placeBuiltSandboxBuilding(sim, type, at.x, at.y, HUMAN_PLAYER, { tribe: FRANK });
    sim.enqueueSetup({ kind: 'upgradeBuilding', building: built });
  }
  for (const at of BUILDERS)
    spawnSandboxSettler(sim, JOB_BUILDER, at.x, at.y, HUMAN_PLAYER, { tribe: FRANK });
}

function finishedFrank(sim: Simulation, type: number): boolean {
  for (const e of sim.world.query(Building)) {
    const b = sim.world.get(e, Building);
    if (b.buildingType === type && b.tribe === FRANK && b.built >= ONE) return true;
  }
  return false;
}

/** Frankish houses whose mod records point their construction stages at bobs their `.bmd` lacks. */
export const frankConstructionScene: SceneDefinition = {
  id: 'frank-construction',
  seed: 6,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  graphicTribes: [VIKING, FRANK],
  initialZoom: 0.85,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'the frankish mason hut rose from its foundation',
      predicate: (sim) => finishedFrank(sim, BUILDING_MASON_HUT),
    },
    {
      label: 'the frankish mason hut and druid hut reached their next tier',
      predicate: (sim) =>
        finishedFrank(sim, BUILDING_MASON_HUT_01) && finishedFrank(sim, BUILDING_DRUID_HUT_01),
    },
  ],
};
