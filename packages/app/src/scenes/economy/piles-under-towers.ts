import {
  cellAnchorNode,
  components,
  type Entity,
  nodeOfPosition,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_CARRIER } from '../../catalog/jobs.js';
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
const ENEMY_TOWER = { x: 30, y: 8 } as const;
const ENEMY_HQ = { x: 37, y: 8 } as const;
/** Between the two bands and outside the reach, so the opening view, centred on the settlers, holds
 *  both the headquarters and the tower. */
const CARRIER_STARTS = [
  { x: 14, y: 6 },
  { x: 14, y: 10 },
] as const;

/** Gear left by fallen men, in cells. The tower's reach (28 nodes, 14 cells along a row) covers the
 *  near rows from column 16 on; both rows lie inside the headquarters carriers' pickup radius. */
const OUTSIDE_PILES = [
  { x: 10, y: 8 },
  { x: 11, y: 10 },
  { x: 12, y: 6 },
] as const;
const UNDER_TOWER_PILES = [
  { x: 17, y: 8 },
  { x: 18, y: 10 },
  { x: 19, y: 6 },
] as const;
const PILE_UNITS = 2;
const GEAR = ['sword_shord', 'armor_chain'] as const;

/** Enough for both carriers to bring in every pile outside the reach and stand idle a while. */
const RUN_TICKS = 1500;

function build(sim: Simulation): void {
  const hq = placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, HOME_HQ.x, HOME_HQ.y, HUMAN_PLAYER);
  placeBuiltSandboxBuilding(sim, BUILDING_WATCHTOWER, ENEMY_TOWER.x, ENEMY_TOWER.y, ENEMY_PLAYER);
  placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, ENEMY_HQ.x, ENEMY_HQ.y, ENEMY_PLAYER);
  [...OUTSIDE_PILES, ...UNDER_TOWER_PILES].forEach((cell, i) => {
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
      label: "the carriers brought every pile outside the enemy tower's reach home",
      predicate: (sim) => {
        const hq = homeHeadquarters(sim);
        const banked = hq === undefined ? 0 : sumGear(sim, sim.world.get(hq, Stockpile).amounts);
        return gearLyingOn(sim, OUTSIDE_PILES) === 0 && banked === OUTSIDE_PILES.length * PILE_UNITS;
      },
    },
    {
      label: 'the gear under the empty enemy tower still lies where the dead dropped it',
      predicate: (sim) => gearLyingOn(sim, UNDER_TOWER_PILES) === UNDER_TOWER_PILES.length * PILE_UNITS,
    },
  ],
};

function sumGear(sim: Simulation, amounts: ReadonlyMap<number, number>): number {
  return GEAR.reduce((sum, slug) => sum + (amounts.get(goodBySlug(sim, slug)) ?? 0), 0);
}
