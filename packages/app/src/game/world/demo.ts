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
 * The demo world: a 6×1 grass strip carrying HQ + joinery, a wood gatherer + a carrier, and two wood
 * nodes. It is what a checkout with no decodable map plays, and what `npm run shot` draws for a human
 * to eyeball. Its content is the global sandbox fixture (`game/sandbox/`), the same ruleset the
 * acceptance scenes use.
 */

const { Position, Resource } = components;

const WIDTH = 6;
const HEIGHT = 1;

/** The fixed placement nodes on the strip - each cell's anchor node (row 0: node (2x, 0)):
 *  [HQ, joinery, wood gatherer, carrier, tree, tree]. */
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
 * The terrain grid the scene layer projects, through the render package's `terrainMapToScene` seam -
 * so the demo exercises the exact map→scene path a loaded `content/maps/<id>.json` takes, not a
 * hand-duplicated grid. Without a map the grass strip is projected: the reproducible default for
 * `npm run shot` + the unit tests, which must not depend on the gitignored `content/`.
 */
export function terrainSceneFor(map?: CellTerrainMap | TerrainMapFile): SceneTerrain {
  return terrainMapToScene(map ?? grassCells());
}

/** The six placement slots: HQ, joinery, wood gatherer, carrier, and two wood nodes. */
const PLACEMENT_CELL_COUNT = 6;

/**
 * The first `count` walkable half-cell nodes of `map`, in canonical row-major id order, as integer
 * `(x, y)` node coords - or `null` if the map has fewer. "Walkable" is resolved from the global sandbox
 * landscape table (the same `walkable` flag `buildTerrainGraph` reads), so the entities land only on
 * cells the sim can stand on - a building on water would make the gatherer's path unreachable.
 * Deterministic: a fixed scan order, no RNG.
 *
 * Some real grids are ~all water under the sandbox's base table (e.g. a coastal scenario whose land is
 * all typeId 1), so the `null` return falls back to the synthetic strip rather than crashing.
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
 * The first anchor (row-major scan) where `typeId`'s footprint fits against the sim's live placement
 * rule (`Simulation.placementProbe` - the exact gate an interactive click goes through), or `null`
 * when nothing on the map fits (a dense map degrades to the walkable-cell fallback). Deterministic:
 * a fixed scan order over the current world state.
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
  /** Tags the demo buildings + settlers to a player so they are selectable/orderable in the interactive
   *  live entry. Omitted (the shot/default path) leaves them neutral; hash untouched. */
  readonly owner?: number;
}

/**
 * Build the demo simulation (seed-fixed) and run it `ticks` ticks deterministically. The returned sim
 * is at a tick boundary, ready for `snapshot()` → `buildScene` → the renderer. No RAF, no wall-clock:
 * this is the "render scenario X at seed S, step N ticks" entry the harness needs.
 *
 * With a loaded grid the same six entities land on the real map instead of the hardcoded strip: the two
 * buildings on the first anchors their footprints actually fit ({@link firstPlaceableCell}, stepping
 * one tick between them so the second sees the first), settlers + trees on the first walkable cells. A
 * loaded map with too few walkable cells falls back to the strip, so this always runs and never throws.
 */
export function runDemoWorld(
  seed: number,
  ticks: number,
  map?: TerrainMap,
  options: DemoWorldOptions = {},
): Simulation {
  // Resolve placement first: a usable map yields its first six walkable cells; no map (or a map with
  // too few walkable cells) falls back to the synthetic strip - content + terrain + cells all revert
  // together, so the fallback world matches the no-map build (exactly, when the caller also passed no
  // `footprints`; a real-content caller's fallback carries them, differing only in inert content rows -
  // fixtures force-place, so nothing behavioral changes).
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

  // Building cells: on a real map, prefer anchors where the footprint actually fits (clear ground, off
  // the water/forest - the probe applies the same rule the player's clicks go through), stepping one
  // tick between the two so the second probe sees the first house. The walkable-cell fallback (a dense
  // map where nothing fits, or the synthetic strip whose 6×1 grid can't host any footprint) force-places
  // like every fixture. The strip path takes the else-branch untouched, so the shot it draws is unchanged.
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
  // The two demo wood nodes: bare 4-unit resources with no felling counter or footprint -
  // `placeResourceNode` would add both.
  for (const cell of [cellAt(4), cellAt(5)]) {
    const tree = sim.world.create();
    sim.world.add(tree, Position, positionOfNode(cell.x, cell.y));
    sim.world.add(tree, Resource, { goodType: GOOD_WOOD, remaining: 4, harvestAtomic: HARVEST_ATOMIC });
  }
  sim.run(ticks);
  return sim;
}
