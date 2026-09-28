import { Position, WALK_DIRECTION, type WalkDirection } from '../../../../../components/index.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import {
  type HalfCellNode,
  type HexDirection,
  nodeOfPosition,
  positionOfNode,
  stepHex,
} from '../../../../../nav/halfcell.js';
import type { SystemContext } from '../../../../context.js';
import { dynamicBlockOverlay } from '../../../../footprint/index.js';

const { E, SE, SW, W, NW, NE, N, S } = WALK_DIRECTION;

/** The map-point steps of one lunge per facing. North and south, which no map-point heading names, go
 *  two rows straight on the same column. */
const LUNGE_STEPS: Readonly<Record<WalkDirection, readonly HexDirection[]>> = {
  [E]: ['east'],
  [SE]: ['southEast'],
  [SW]: ['southWest'],
  [W]: ['west'],
  [NW]: ['northWest'],
  [NE]: ['northEast'],
  [N]: ['northEast', 'northWest'],
  [S]: ['southEast', 'southWest'],
};

/**
 * One forward event of an animal attack clip. Original behavior: the creature moves one map point along
 * its facing when that point is walkable, whoever stands on it. Walkable here also excludes the dynamic
 * blocks (buildings, resources, landscape objects, vehicles).
 */
export function lungeForward(world: World, ctx: SystemContext, e: Entity, direction: WalkDirection): void {
  const terrain = ctx.terrain;
  const p = world.tryGet(e, Position);
  if (terrain === undefined || p === undefined) return;
  let to: HalfCellNode = nodeOfPosition(p.x, p.y);
  for (const step of LUNGE_STEPS[direction]) to = stepHex(to, step);
  if (!terrain.inBounds(to.hx, to.hy)) return;
  const node = terrain.nodeAt(to.hx, to.hy);
  if (!terrain.isWalkable(node) || dynamicBlockOverlay(world, ctx, terrain).has(node)) return;
  const at = positionOfNode(to.hx, to.hy);
  const position = world.mut(e, Position);
  position.x = at.x;
  position.y = at.y;
}
