import {
  cellAnchorNode,
  components,
  type Entity,
  nodeOfPosition,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_ARCHER_LONG, JOB_CARRIER } from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_WATCHTOWER,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
} from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

const { Position, Stockpile } = components;

const MAP_W = 44;
const MAP_H = 16;
const HOME_HQ = { x: 5, y: 8 } as const;
/** Nobody stands on it. */
const EMPTY_TOWER = { x: 11, y: 2 } as const;
const MANNED_TOWER = { x: 30, y: 8 } as const;
/** Below the manned tower's door, so he stands on his post before the carriers finish their first trip. */
const BOWMAN_START = { x: 30, y: 10 } as const;
const ENEMY_HQ = { x: 37, y: 8 } as const;
/** Between the two bands and outside the manned tower's reach, so the opening view, centred on the settlers,
 *  holds the headquarters and both towers. */
const CARRIER_STARTS = [
  { x: 14, y: 6 },
  { x: 14, y: 10 },
] as const;

/** Gear left by fallen men, in cells. A long bow on a tower reaches 28 nodes, 14 cells along a row: the
 *  manned tower's covers the far rows from column 16 on, and the empty tower's would cover the near ones.
 *  Both bands lie inside the headquarters carriers' pickup radius. */
const NEAR_PILES = [
  { x: 10, y: 8 },
  { x: 11, y: 10 },
  { x: 12, y: 6 },
] as const;
const FAR_PILES = [
  { x: 17, y: 8 },
  { x: 18, y: 10 },
  { x: 19, y: 6 },
] as const;
const PILE_UNITS = 2;
const GEAR = ['sword_shord', 'armor_chain'] as const;
/** The tower larder's `logicstock 16 25` ceiling, so the bowman never comes down for a meal. */
const TOWER_RATIONS = 25;
const FOOD_GOOD = 'food_simple';

/** Enough for both carriers to bring in the near band and stand idle a while. */
const RUN_TICKS = 1500;

function build(sim: Simulation): void {
  const hq = placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, HOME_HQ.x, HOME_HQ.y, HUMAN_PLAYER);
  placeBuiltSandboxBuilding(sim, BUILDING_WATCHTOWER, EMPTY_TOWER.x, EMPTY_TOWER.y, ENEMY_PLAYER);
  const manned = placeBuiltSandboxBuilding(
    sim,
    BUILDING_WATCHTOWER,
    MANNED_TOWER.x,
    MANNED_TOWER.y,
    ENEMY_PLAYER,
  );
  // By slug: the sandbox catalog carries the food goods at +100.
  sim.world.mut(manned, Stockpile).amounts.set(goodBySlug(sim, FOOD_GOOD), TOWER_RATIONS);
  const bowman = spawnSettlerDirect(sim, JOB_ARCHER_LONG, BOWMAN_START.x, BOWMAN_START.y, ENEMY_PLAYER);
  sim.enqueueSetup({
    kind: 'assignWorker',
    entity: bowman,
    building: manned,
    jobPriority: [JOB_ARCHER_LONG],
  });
  placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, ENEMY_HQ.x, ENEMY_HQ.y, ENEMY_PLAYER);
  [...NEAR_PILES, ...FAR_PILES].forEach((cell, i) => {
    const node = cellAnchorNode(cell.x, cell.y);
    systems.createGroundGoods(sim.world, {
      goodType: goodBySlug(sim, GEAR[i % GEAR.length] ?? GEAR[0]),
      amount: PILE_UNITS,
      x: node.hx,
      y: node.hy,
    });
  });
  for (const start of CARRIER_STARTS) {
    const carrier = spawnSettlerDirect(sim, JOB_CARRIER, start.x, start.y);
    sim.enqueueSetup({ kind: 'assignWorker', entity: carrier, building: hq, jobPriority: [JOB_CARRIER] });
  }
}

/** The gear units still lying loose on `cells`. */
function gearLyingOn(sim: Simulation, cells: readonly { x: number; y: number }[]): number {
  const gear = GEAR.map((slug) => goodBySlug(sim, slug));
  let units = 0;
  for (const e of sim.world.query(Stockpile, Position)) {
    if (!systems.isYardHeap(sim.world, e)) continue;
    const { x, y } = sim.world.get(e, Position);
    const node = nodeOfPosition(x, y);
    if (!cells.some((c) => sameNode(cellAnchorNode(c.x, c.y), node))) continue;
    for (const good of gear) units += sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
  }
  return units;
}

function sameNode(a: { hx: number; hy: number }, b: { hx: number; hy: number }): boolean {
  return a.hx === b.hx && a.hy === b.hy;
}

function homeHeadquarters(sim: Simulation): Entity | undefined {
  for (const e of sim.world.query(components.Building, components.Owner)) {
    if (sim.world.get(e, components.Owner).player === HUMAN_PLAYER) return e;
  }
  return undefined;
}

export const pilesUnderTowersScene: SceneDefinition = {
  id: 'piles-under-towers',
  seed: 17,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.45,
  checks: [
    {
      label: 'the carriers brought every pile under the empty enemy tower home',
      predicate: (sim) => {
        const hq = homeHeadquarters(sim);
        const banked = hq === undefined ? 0 : sumGear(sim, sim.world.get(hq, Stockpile).amounts);
        return gearLyingOn(sim, NEAR_PILES) === 0 && banked === NEAR_PILES.length * PILE_UNITS;
      },
    },
    {
      label: "the gear under the bowman's tower still lies where the dead dropped it",
      predicate: (sim) => gearLyingOn(sim, FAR_PILES) === FAR_PILES.length * PILE_UNITS,
    },
  ],
};

function sumGear(sim: Simulation, amounts: ReadonlyMap<number, number>): number {
  return GEAR.reduce((sum, slug) => sum + (amounts.get(goodBySlug(sim, slug)) ?? 0), 0);
}
