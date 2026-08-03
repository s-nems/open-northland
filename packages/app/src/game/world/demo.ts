import type { TerrainMapFile } from '@open-northland/data';
import { type SceneTerrain, terrainMapToScene } from '@open-northland/render';
import {
  type CellTerrainMap,
  components,
  halfCellMapFromCells,
  positionOfNode,
  type Simulation,
  type TerrainMap,
} from '@open-northland/sim';
import { HARVEST_ATOMIC } from '../../catalog/atomics.js';
import { GRASS } from '../../catalog/buildings.js';
import { JOB_CARRIER, JOB_COLLECTOR } from '../../catalog/jobs.js';
import { PRIMARY_TRIBE } from '../rules.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_JOINERY,
  GOOD_WOOD,
  resolveWorldContent,
  sandboxWalkableTypeIds,
  type WorldContentOptions,
} from '../sandbox/index.js';
import { enqueuePlacements, newWorldSim } from './build.js';

/**
 * The demo world: a 6×1 grass strip carrying HQ, joinery, a wood gatherer, a carrier and two wood nodes.
 * It is what a checkout with no decodable map plays, over the shared sandbox content fixture.
 */

const { Position, Resource } = components;

const WIDTH = 6;
const HEIGHT = 1;

/** Each strip cell's anchor node, in placement order: HQ, joinery, gatherer, carrier, tree, tree. */
const STRIP_CELLS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 10, y: 0 },
  { x: 8, y: 0 },
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 4, y: 0 },
  { x: 6, y: 0 },
];

/** The strip in its authored cell shape (the render fallback projects this directly). */
function grassCells(): CellTerrainMap {
  return { width: WIDTH, height: HEIGHT, typeIds: new Array(WIDTH * HEIGHT).fill(GRASS) };
}

/**
 * The projected terrain grid, taking the same map to scene path a loaded `content/maps/<id>.json` does.
 * Without a map the grass strip stands in, so tests never depend on the gitignored `content/`.
 */
export function terrainSceneFor(map?: CellTerrainMap | TerrainMapFile): SceneTerrain {
  return terrainMapToScene(map ?? grassCells());
}

const PLACEMENT_CELL_COUNT = 6;

/**
 * The first `count` walkable half-cell nodes of `map` in row-major order, or `null` when the map has
 * fewer. Walkability comes from the sandbox landscape table, the same `walkable` flag
 * `buildTerrainGraph` reads, so nothing lands where the sim cannot stand.
 */
function walkableCells(
  map: TerrainMap,
  walkable: ReadonlySet<number>,
  count: number,
): Array<{ x: number; y: number }> | null {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < map.typeIds.length && out.length < count; i++) {
    const typeId = map.typeIds[i];
    if (typeId !== undefined && walkable.has(typeId))
      out.push({ x: i % map.width, y: Math.floor(i / map.width) });
  }
  return out.length < count ? null : out;
}

/**
 * The first row-major anchor where `typeId`'s footprint passes `Simulation.placementProbe`, the same
 * gate an interactive click goes through, or `null` when nothing on the map fits.
 */
function firstPlaceableCell(
  sim: Simulation,
  typeId: number,
  map: TerrainMap,
): { x: number; y: number } | null {
  const probe = sim.placementProbe(typeId);
  if (probe === null) return null;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (probe.canPlace(x, y)) return { x, y };
    }
  }
  return null;
}

export interface DemoWorldOptions extends WorldContentOptions {
  /** Tags the demo entities to a player so they are selectable; omitted leaves them neutral. */
  readonly owner?: number;
}

/**
 * Build the demo simulation and run it `ticks` ticks; the returned sim sits at a tick boundary. With a
 * loaded grid the same six entities land on the real map, and a map with too few walkable cells falls
 * back to the strip, so this always runs and never throws.
 */
export function runDemoWorld(
  seed: number,
  ticks: number,
  map?: TerrainMap,
  options: DemoWorldOptions = {},
): Simulation {
  // Content, terrain and cells revert together, so an unusable map yields the same world as no map.
  const mapCells = map ? walkableCells(map, sandboxWalkableTypeIds(map), PLACEMENT_CELL_COUNT) : null;
  const usable = map !== undefined && mapCells !== null;
  const content = resolveWorldContent(usable ? map : undefined, options);
  const terrain = usable ? map : halfCellMapFromCells(grassCells());
  const cells = mapCells ?? STRIP_CELLS;
  const sim = newWorldSim(seed, terrain, content);

  const cellAt = (i: number): { x: number; y: number } => {
    const c = cells[i];
    if (c === undefined)
      throw new Error(`expected ${PLACEMENT_CELL_COUNT} placement cells, got ${cells.length}`);
    return c;
  };

  const own = options.owner !== undefined ? { owner: options.owner } : {};

  // One tick runs between the two probes so the second one sees the first house.
  if (usable) {
    const hq = firstPlaceableCell(sim, BUILDING_HEADQUARTERS, terrain) ?? cellAt(0);
    enqueuePlacements(sim, [
      { kind: 'building', typeId: BUILDING_HEADQUARTERS, tribe: PRIMARY_TRIBE, ...hq, ...own },
    ]);
    sim.run(1);
    const joinery = firstPlaceableCell(sim, BUILDING_JOINERY, terrain) ?? cellAt(1);
    enqueuePlacements(sim, [
      { kind: 'building', typeId: BUILDING_JOINERY, tribe: PRIMARY_TRIBE, ...joinery, ...own },
    ]);
    sim.run(1);
    enqueuePlacements(sim, [
      { kind: 'human', jobType: JOB_COLLECTOR, tribe: PRIMARY_TRIBE, ...cellAt(2), ...own },
      { kind: 'human', jobType: JOB_CARRIER, tribe: PRIMARY_TRIBE, ...cellAt(3), ...own },
    ]);
  } else {
    enqueuePlacements(sim, [
      { kind: 'building', typeId: BUILDING_HEADQUARTERS, tribe: PRIMARY_TRIBE, ...cellAt(0), ...own },
      { kind: 'building', typeId: BUILDING_JOINERY, tribe: PRIMARY_TRIBE, ...cellAt(1), ...own },
      { kind: 'human', jobType: JOB_COLLECTOR, tribe: PRIMARY_TRIBE, ...cellAt(2), ...own },
      { kind: 'human', jobType: JOB_CARRIER, tribe: PRIMARY_TRIBE, ...cellAt(3), ...own },
    ]);
  }
  // Bare resources with no felling counter or footprint, which `placeResourceNode` would add.
  for (const cell of [cellAt(4), cellAt(5)]) {
    const tree = sim.world.create();
    sim.world.add(tree, Position, positionOfNode(cell.x, cell.y));
    sim.world.add(tree, Resource, { goodType: GOOD_WOOD, remaining: 4, harvestAtomic: HARVEST_ATOMIC });
  }
  sim.run(ticks);
  return sim;
}
