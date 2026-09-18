import type { ContentSet } from '@open-northland/data';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import {
  type BlockerChannel,
  type BlockerStore,
  type BlockerVisit,
  BUILDING_ZONE,
  EXCLUSION,
  eachBlockerCell,
  MARKER,
  markerBlockerCells,
  OBSTACLE,
  RESOURCE_ANCHOR,
} from '../blockers.js';

// Which nodes a blocker denies a work flag - ../blockers.ts channels projected onto this one rule.

/** One blocker's blocked nodes, in bounds. */
export type BlockedCells = readonly NodeId[];

/** Every channel but the margin zones, which stay open ground for a flag. Exhaustive over
 *  {@link BlockerChannel}, so a channel added later must state its own answer here. */
const BLOCKS_WORK_FLAG: Record<BlockerChannel, boolean> = {
  [OBSTACLE]: true,
  [RESOURCE_ANCHOR]: true,
  [MARKER]: true,
  [EXCLUSION]: false,
  [BUILDING_ZONE]: false,
};

/** The entity's blocked nodes under `run`'s visitor - the shared channel/bounds filter of every capturer. */
function captureCells(terrain: TerrainGraph, run: (visit: BlockerVisit) => void): BlockedCells {
  const cells: NodeId[] = [];
  run((x, y, channel) => {
    if (BLOCKS_WORK_FLAG[channel] && terrain.inBounds(x, y)) cells.push(terrain.nodeAt(x, y));
  });
  return cells;
}

/** The nodes `store`'s contribution for `e` denies a flag - the per-entity slice the incremental state
 *  captures and replays. */
export function blockedCellsOf(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  store: BlockerStore,
  e: Entity,
): BlockedCells {
  return captureCells(terrain, (v) => store.cells(world, content, e, v));
}

export function markerCells(world: World, terrain: TerrainGraph, e: Entity): BlockedCells {
  return captureCells(terrain, (v) => markerBlockerCells(world, e, v));
}

/** The whole blocked set derived from live state in one pass - the reference the incremental state is
 *  proved against, so it must scan the same channels, markers included. */
export function rederiveBlockedCells(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): ReadonlySet<NodeId> {
  const blocked = new Set<NodeId>();
  eachBlockerCell(
    world,
    content,
    (x, y, channel) => {
      if (BLOCKS_WORK_FLAG[channel] && terrain.inBounds(x, y)) blocked.add(terrain.nodeAt(x, y));
    },
    'with-markers',
  );
  return blocked;
}
