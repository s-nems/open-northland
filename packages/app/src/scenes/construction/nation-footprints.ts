import { buildingFootprintFor, footprintCellDx } from '@open-northland/data';
import type { Simulation } from '@open-northland/sim';
import { buildingWalkBodyOf, components, nodeOfPosition } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { CIVILIZATIONS } from '../../catalog/civilizations.js';
import { JOB_CIVILIST, JOB_WOMAN } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_BAKERY,
  BUILDING_BARRACKS,
  BUILDING_FARM,
  BUILDING_HOME_00,
  BUILDING_HOME_01,
  BUILDING_HOME_02,
  BUILDING_HOME_03,
  BUILDING_HOME_04,
  BUILDING_MASON_HUT,
  BUILDING_MILL,
  BUILDING_SMITHY,
  BUILDING_WAREHOUSE_00,
  BUILDING_WAREHOUSE_01,
  BUILDING_WAREHOUSE_02,
  BUILDING_WATCHTOWER,
  BUILDING_WELL,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const { Building, Chat, Marriage, MoveGoal, PathFollow, PathRequest, Position, Resting, Settler } =
  components;

/** One row per civilization, one finished house per column; the leading home tiers house a couple. */
const TYPES = [
  BUILDING_HOME_00,
  BUILDING_HOME_01,
  BUILDING_HOME_02,
  BUILDING_HOME_03,
  BUILDING_HOME_04,
  BUILDING_WAREHOUSE_00,
  BUILDING_WAREHOUSE_01,
  BUILDING_WAREHOUSE_02,
  BUILDING_WELL,
  BUILDING_FARM,
  BUILDING_MILL,
  BUILDING_BAKERY,
  BUILDING_MASON_HUT,
  BUILDING_SMITHY,
  BUILDING_BARRACKS,
  BUILDING_WATCHTOWER,
] as const;
/** The home tiers lead {@link TYPES}; only they get residents. */
const HOME_COLUMNS = 5;
/** Each spouse's spawn, in whole tiles from the house anchor: clear of every tribe's home footprint, whose
 *  cells span dx -9..7 and dy -12..7 nodes around the anchor. Authored. */
const RESIDENT_SPAWN = {
  wife: { dx: -3, dy: 2 },
  husband: { dx: -3, dy: 3 },
} as const;

const COLUMN_STEP = 8;
const ROW_STEP = 12;
const FIRST = { x: 5, y: 8 } as const;
const MAP_W = FIRST.x + COLUMN_STEP * TYPES.length;
const MAP_H = FIRST.y + ROW_STEP * CIVILIZATIONS.length;
/** Long enough for the residents to sleep at home once and step back out. */
const RUN_TICKS = 6000;

/** The whole-tile anchor of the house in `column` of `row`. */
function houseCell(row: number, column: number): { x: number; y: number } {
  return { x: FIRST.x + column * COLUMN_STEP, y: FIRST.y + row * ROW_STEP };
}

function build(sim: Simulation): void {
  CIVILIZATIONS.forEach((tribe, row) => {
    TYPES.forEach((type, column) => {
      const at = houseCell(row, column);
      const house = placeBuiltSandboxBuilding(sim, type, at.x, at.y, HUMAN_PLAYER, {
        tribe,
        fillStock: true,
      });
      if (column >= HOME_COLUMNS) return;
      const { wife: w, husband: h } = RESIDENT_SPAWN;
      const wife = spawnSettlerDirect(sim, JOB_WOMAN, at.x + w.dx, at.y + w.dy, HUMAN_PLAYER, tribe);
      const husband = spawnSettlerDirect(sim, JOB_CIVILIST, at.x + h.dx, at.y + h.dy, HUMAN_PLAYER, tribe);
      sim.world.add(wife, Marriage, { spouse: husband, child: null });
      sim.world.add(husband, Marriage, { spouse: wife, child: null });
      sim.enqueueSetup({ kind: 'assignHouse', entity: wife, house });
    });
  });
}

/** Whether a settler drawn outdoors stands still on a cell of some building's authored walk block,
 *  carved passage included: ground under the house's art. A traveller crossing a passage is not a stand,
 *  nor is a chat, which holds a walker mid-step without a goal or a path. */
export function anySettlerOnWalls(sim: Simulation): boolean {
  const walls = new Set<string>();
  for (const e of sim.world.query(Building, Position)) {
    const b = sim.world.get(e, Building);
    const type = sim.content.buildings.find((row) => row.typeId === b.buildingType);
    const footprint = type === undefined ? undefined : buildingFootprintFor(type, b.tribe, b.record);
    const p = sim.world.get(e, Position);
    const anchor = nodeOfPosition(p.x, p.y);
    for (const cell of footprint?.blocked ?? []) {
      walls.add(`${anchor.hx + footprintCellDx(anchor.hy, cell)},${anchor.hy + cell.dy}`);
    }
  }
  for (const e of sim.world.query(Settler, Position)) {
    if (sim.world.has(e, Resting)) continue;
    if (sim.world.has(e, MoveGoal) || sim.world.has(e, PathRequest) || sim.world.has(e, PathFollow)) continue;
    if (sim.world.has(e, Chat)) continue;
    const p = sim.world.get(e, Position);
    const at = nodeOfPosition(p.x, p.y);
    if (walls.has(`${at.hx},${at.hy}`)) return true;
  }
  return false;
}

/** Whether some house's walk block carved wall cells open behind its door, which it does only when no
 *  lattice edge leaves the door; the extracted doors never need it. */
export function anyHouseCarvesACell(sim: Simulation): boolean {
  const terrain = sim.terrain;
  if (terrain === undefined) return false;
  for (const e of sim.world.query(Building)) {
    const walk = buildingWalkBodyOf(sim.world, { content: sim.content }, terrain, e);
    // The passage starts at the door; any node after it is a carved wall cell.
    if (walk !== null && walk.passage.length > 1) return true;
  }
  return false;
}

/**
 * Every civilization's finished houses side by side, for comparing each sprite against its footprint
 * under `?debug=geometry`, and the idle residents' stands against the walls.
 *
 * Named divergence: the headless twin runs the clean-room footprints, which block nothing, so its
 * check holds trivially; the per-civilization door shapes are exercised by the browser and by the
 * content-tier test that runs this scene over the real footprints.
 */
export const nationFootprintsScene: SceneDefinition = {
  id: 'nation-footprints',
  seed: 3,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  needs: true,
  graphicTribes: CIVILIZATIONS,
  initialZoom: 0.6,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'no settler outdoors stands on a wall cell of any house',
      predicate: (sim) => !anySettlerOnWalls(sim),
    },
    {
      label: 'no house has a wall cell carved open: every door leaves by a lattice edge',
      predicate: (sim) => !anyHouseCarvesACell(sim),
    },
  ],
};
