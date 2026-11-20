import type { ContentSet } from '@open-northland/data';
import { Building, Position } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition, nodeWorldX } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { COLUMN_PX, HALF_ROW } from '../../nav/world-metric.js';
import type { MapContext } from '../context.js';
import { interactionNodeId } from './interaction.js';
import { walkBlockMask } from './walk-block-mask.js';

/** A spot beside a house, in screen pixels from the house's anchor node: where its collect action plays. */
interface CollectSpot {
  readonly x: number;
  readonly y: number;
}

/** How many nodes around the anchor a stand is looked for in: past the widest one-cell house's ring. */
const STAND_REACH = 2;

const spotsByContent = new WeakMap<ContentSet, Map<string, CollectSpot | null>>();

/** Where `(tribe, action)`'s first house program plays its first clip: the end of the walk before it. The
 *  well pump's program puts the drawer at the crank this way. */
function collectSpotOf(content: ContentSet, tribe: number, action: number): CollectSpot | null {
  let spots = spotsByContent.get(content);
  if (spots === undefined) {
    spots = new Map();
    spotsByContent.set(content, spots);
  }
  const key = `${tribe}/${action}`;
  const held = spots.get(key);
  if (held !== undefined) return held;
  let spot: CollectSpot | null = null;
  const program = content.gfxInHousePrograms.find((p) => p.tribe === tribe && p.action === action);
  for (const entry of program?.entries ?? []) {
    if (entry.kind === 'clip') break;
    if (entry.kind === 'walk') spot = { x: entry.x, y: entry.y };
  }
  spots.set(key, spot);
  return spot;
}

/**
 * The node a settler walks to for lifting goods off `store` by the house's own collect action, or null to
 * use the door: the open node nearest the spot the content's program plays that action at, on the door's
 * side of the terrain, so the well's drawer goes straight to the crank.
 */
export function collectStandOf(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  store: Entity,
): NodeId | null {
  const building = world.tryGet(store, Building);
  const p = world.tryGet(store, Position);
  if (building === undefined || p === undefined) return null;
  const action = contentIndex(ctx.content).buildings.get(building.buildingType)?.collectAtomic;
  if (action === undefined) return null;
  const spot = collectSpotOf(ctx.content, building.tribe, action);
  if (spot === null) return null;
  const ax = nodeHxOfPosition(p.x, p.y);
  const ay = nodeHyOfPosition(p.x, p.y);
  const door = interactionNodeId(world, ctx, terrain, store);
  const side = door === null ? null : terrain.componentOf(door);
  const blocked = walkBlockMask(world, ctx, terrain);
  // The spot in world column units, measured from the anchor node like the candidates.
  const spotX = fx.add(nodeWorldX(ax, ay), fx.div(fx.fromInt(spot.x), fx.fromInt(COLUMN_PX)));
  const spotY = fx.div(fx.fromInt(spot.y), fx.fromInt(COLUMN_PX));
  let best: NodeId | null = null;
  let bestDist: Fixed | null = null;
  for (let y = ay - STAND_REACH; y <= ay + STAND_REACH; y++) {
    for (let x = ax - STAND_REACH; x <= ax + STAND_REACH; x++) {
      if (!terrain.inBounds(x, y)) continue;
      const node = terrain.nodeAt(x, y);
      if (!terrain.isWalkable(node) || blocked.has(node)) continue;
      if (side !== null && terrain.componentOf(node) !== side) continue;
      const dx = fx.sub(nodeWorldX(x, y), spotX);
      const dy = fx.sub(fx.mulInt(HALF_ROW, y - ay), spotY);
      const dist = fx.add(fx.mul(dx, dx), fx.mul(dy, dy));
      // Row-major scan with a strict comparison: ties keep the lower node, so the pick is deterministic.
      if (bestDist === null || dist < bestDist) {
        best = node;
        bestDist = dist;
      }
    }
  }
  return best;
}
