import type { ContentSet } from '@open-northland/data';
import { Building, Resource, Signpost } from '../../../../components/index.js';
import type { Component, Entity, World } from '../../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import {
  type BlockerChannel,
  type BlockerVisit,
  BUILDING_ZONE,
  buildingBlockerCells,
  EXCLUSION,
  eachBlockerCell,
  MARKER,
  markerBlockerCells,
  OBSTACLE,
  RESOURCE_ANCHOR,
  resourceBlockerCells,
  signpostBlockerCells,
} from '../blockers.js';

// Which nodes a blocker denies a work flag - ../blockers.ts channels projected onto this one rule.

/** One blocker's blocked nodes (in bounds; duplicates kept so add and removal replay symmetrically).
 *  Captured at admit time - the entity may be destroyed by removal. */
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

/** One journal-replayed blocker store: its component and per-entity capturer. */
export interface StaticBlockerSource {
  readonly component: Component<unknown>;
  readonly capture: (world: World, content: ContentSet, terrain: TerrainGraph, e: Entity) => BlockedCells;
}

export const RESOURCE_SOURCE: StaticBlockerSource = {
  component: Resource,
  capture: (world, _content, terrain, e) => captureCells(terrain, (v) => resourceBlockerCells(world, e, v)),
};

export const STATIC_SOURCES: readonly StaticBlockerSource[] = [
  RESOURCE_SOURCE,
  {
    component: Building,
    capture: (world, content, terrain, e) =>
      captureCells(terrain, (v) => buildingBlockerCells(world, content, e, v)),
  },
  {
    component: Signpost,
    capture: (world, _content, terrain, e) => captureCells(terrain, (v) => signpostBlockerCells(world, e, v)),
  },
];

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
