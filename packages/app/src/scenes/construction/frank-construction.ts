import type { Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, ONE } from '@open-northland/sim';
import { grassTerrain, VIKING } from '../../catalog/buildings.js';
import { FRANK } from '../../catalog/civilizations.js';
import { JOB_BUILDER } from '../../catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../game/rules.js';
import {
  BUILDING_DRUID_HUT,
  BUILDING_DRUID_HUT_01,
  BUILDING_HEADQUARTERS,
  BUILDING_MASON_HUT,
  BUILDING_MASON_HUT_01,
  BUILDING_POTTERY,
  BUILDING_POTTERY_01,
  placeBuiltSandboxBuilding,
  placeSandboxSite,
  spawnSandboxSettler,
} from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

const { Building } = components;

const MAP_W = 30;
const MAP_H = 29;
const HQ = { x: 6, y: 9 } as const;
const MASON_SITE = { x: 13, y: 5 } as const;
const MASON_UPGRADE = { x: 13, y: 13 } as const;
const DRUID_UPGRADE = { x: 21, y: 9 } as const;
const POTTERY_SITE = { x: 6, y: 20 } as const;
const POTTERY_UPGRADE = { x: 21, y: 21 } as const;
const BUILDERS = [
  { x: 10, y: 9 },
  { x: 11, y: 10 },
  { x: 17, y: 9 },
  { x: 12, y: 17 },
] as const;
/** Pottery materials the headquarters' stock slots do not hold: clay for both levels, bricks and pillars
 *  for the upgrade. */
const POTTERY_GOODS = [
  ['mud', 10],
  ['brick', 10],
  ['pillar', 10],
] as const;
/** Slack past the slowest site, the fresh mason hut. */
const RUN_TICKS = 14_000;

function build(sim: Simulation): void {
  // Precedes the upgrade commands so real content's tier gate admits them; technology has its own scene.
  sim.enqueueSetup({ kind: 'setProfessionProgression', enabled: false });
  // Raw command so `initialGoods` can add the pottery's materials on top of the filled stock.
  const hq = cellAnchorNode(HQ.x, HQ.y);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: BUILDING_HEADQUARTERS,
    x: hq.hx,
    y: hq.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    force: true,
    fillStock: true,
    initialGoods: POTTERY_GOODS.map(([slug, amount]) => ({ good: goodBySlug(sim, slug), amount })),
  });
  placeSandboxSite(sim, BUILDING_MASON_HUT, MASON_SITE.x, MASON_SITE.y, HUMAN_PLAYER, { tribe: FRANK });
  placeSandboxSite(sim, BUILDING_POTTERY, POTTERY_SITE.x, POTTERY_SITE.y, HUMAN_PLAYER, { tribe: FRANK });
  for (const [type, at] of [
    [BUILDING_MASON_HUT, MASON_UPGRADE],
    [BUILDING_DRUID_HUT, DRUID_UPGRADE],
    [BUILDING_POTTERY, POTTERY_UPGRADE],
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

/** Frankish houses whose mod records point their bodies or construction stages at bobs their `.bmd` lacks
 *  or leaves unused: the mason hut, the druid hut and the pottery. */
export const frankConstructionScene: SceneDefinition = {
  id: 'frank-construction',
  seed: 6,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  graphicTribes: [VIKING, FRANK],
  initialZoom: 0.6,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'the frankish mason hut and pottery rose from their foundations',
      predicate: (sim) => finishedFrank(sim, BUILDING_MASON_HUT) && finishedFrank(sim, BUILDING_POTTERY),
    },
    {
      label: 'the frankish mason hut, druid hut and pottery reached their next tier',
      predicate: (sim) =>
        finishedFrank(sim, BUILDING_MASON_HUT_01) &&
        finishedFrank(sim, BUILDING_DRUID_HUT_01) &&
        finishedFrank(sim, BUILDING_POTTERY_01),
    },
  ],
};
