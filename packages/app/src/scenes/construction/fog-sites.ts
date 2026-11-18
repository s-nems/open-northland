import {
  cellAnchorNode,
  components,
  constructionBillForType,
  type Entity,
  FOG_STATE,
  fx,
  ONE,
  playerCommand,
  type Simulation,
} from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_SCOUT } from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_BAKERY,
  BUILDING_HOME_00,
  placeSandboxSite,
  spawnSettlerDirect,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

/**
 * A scout stands among three building sites under fog of war, a fresh one and a half-raised one of
 * its own and a rival's fresh one, then walks off east. Out of its sight the sites stay drawn under the
 * grey as it last saw them: the stage they stood at, their foundation earth and their sign.
 */

const MAP_W = 64;
const MAP_H = 24;
const HALF_RAISED = fx.fromFloat(0.5);
const SITES = [
  { ref: BUILDING_BAKERY, x: 8, y: 6, owner: HUMAN_PLAYER, built: 0 },
  { ref: BUILDING_HOME_00, x: 8, y: 16, owner: HUMAN_PLAYER, built: HALF_RAISED },
  { ref: BUILDING_BAKERY, x: 15, y: 11, owner: ENEMY_PLAYER, built: 0 },
] as const;
const SCOUT_START = { x: 12, y: 12 } as const;
const SCOUT_GOAL = { x: 58, y: 12 } as const;
/** The walk east, which leaves every site out of sight by about tick 500. */
const RUN_TICKS = 750;

const { Building, Health, Stockpile, UnderConstruction } = components;

function build(sim: Simulation): void {
  for (const site of SITES) {
    const e = placeSandboxSite(sim, site.ref, site.x, site.y, site.owner);
    if (site.built === 0) continue;
    // The materials delivered and the health risen with the walls, so the stage stands undamaged.
    const building = sim.world.mut(e, Building);
    building.built = site.built;
    sim.world.mut(e, UnderConstruction).labor = site.built;
    const health = sim.world.mut(e, Health);
    health.hitpoints = Math.trunc((site.built * health.max) / ONE);
    const stock = sim.world.mut(e, Stockpile).amounts;
    for (const line of constructionBillForType(sim.content.buildings, building.buildingType))
      stock.set(line.goodType, line.amount);
  }
  const scout = spawnSettlerDirect(sim, JOB_SCOUT, SCOUT_START.x, SCOUT_START.y);
  const goal = cellAnchorNode(SCOUT_GOAL.x, SCOUT_GOAL.y);
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'moveUnit', entity: scout, x: goal.hx, y: goal.hy }));
}

function sites(sim: Simulation): Entity[] {
  return [...sim.world.query(Building, UnderConstruction)];
}

export const fogSitesScene: SceneDefinition = {
  id: 'fog-sites',
  seed: 41,
  terrain: grassTerrain(MAP_W, MAP_H),
  fog: 'classic-fow',
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.9,
  checks: [
    {
      label: 'the scout left every site behind on explored ground out of its sight',
      predicate: (sim) =>
        SITES.every((site) => sim.fog?.stateAt(HUMAN_PLAYER, site.x, site.y) === FOG_STATE.EXPLORED),
    },
    {
      label: 'all three sites still stand unfinished, the half-raised one at its stage',
      predicate: (sim) =>
        sites(sim).length === SITES.length &&
        sites(sim).some((e) => sim.world.get(e, Building).built === HALF_RAISED),
    },
  ],
};
