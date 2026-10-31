import { Building } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, hexDistance, hexDistanceBetween } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { mannedTowers, threatWatchNodes } from '../../ai-shared/military/defence/index.js';
import { seatAwaitsScriptedAttack } from '../../ai-shared/military/settlement-defence.js';
import { anchorCentroid, anchorNodeOf } from '../../ai-shared/node-geometry.js';
import { ownedBuildings } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { dynamicBlockOverlay } from '../../footprint/index.js';
import { seatBaseOf } from '../base.js';
import type { IntentPoint } from '../knowledge/map-intent/index.js';
import { forecastAttackOrigin } from './deadline.js';

/** How far behind its tower line, toward its base, a seat awaiting a scripted attack stands its army, in
 *  hex nodes (owner ruling: the army stands under the towers on the attack side, between them and the
 *  buildings behind, and meets the big attacks there together). Authored inside the house bow's 29-node
 *  reach: a band of 20 spreads up to about 8 nodes round its stand, so the whole band stays 2 to 18
 *  nodes behind the towers, and a wave stopping to fight it stands under their fire. */
export const STAND_BEHIND_TOWERS_NODES = 10;

/**
 * Where `player`'s army stands while it awaits a scripted or map-AI attack ({@link seatAwaitsScriptedAttack})
 * and no wave of its own marches: behind its manned towers facing where the attacks set out from
 * ({@link forecastAttackOrigin}). Null for a seat with no such attack, no named origin, no base or no
 * manned tower, and when no open ground of the stand lies on `door`'s side.
 */
export function towerStandOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  door: NodeId,
): NodeId | null {
  if (!seatAwaitsScriptedAttack(world, player)) return null;
  const origin = forecastAttackOrigin(world, ctx, player);
  const base = seatBaseOf(world, ctx, player);
  const baseAt = base === null ? null : anchorNodeOf(world, base);
  if (origin === null || baseAt === null) return null;
  return towerStandToward(world, ctx, terrain, ownedBuildings(world, player), baseAt, origin, door);
}

/**
 * The stand under the towers of `owned` facing `origin`: the manned tower nearest `origin` and those
 * within its reach ({@link threatWatchNodes}) make the line; the stand lies
 * {@link STAND_BEHIND_TOWERS_NODES} from the line's centre toward `base`, never past it, on the first open
 * node of `door`'s side walking back toward the line that the front tower still reaches. Approximation:
 * a straight step over the half-cell lattice.
 */
export function towerStandToward(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  base: HalfCellNode,
  origin: IntentPoint,
  door: NodeId,
): NodeId | null {
  const towers = mannedTowers(world, ctx, owned);
  let front: { e: Entity; at: HalfCellNode; distance: number } | null = null;
  for (const e of towers) {
    const at = anchorNodeOf(world, e);
    if (at === null) continue;
    const distance = hexDistance(at, origin);
    // `owned` ascends by id, so the strict `<` keeps the lower one on a tie.
    if (front === null || distance < front.distance) front = { e, at, distance };
  }
  if (front === null) return null;
  const reach = threatWatchNodes(ctx, world.get(front.e, Building).tribe);
  const frontAt = front.at;
  const line = towers.filter((e) => {
    const at = anchorNodeOf(world, e);
    return at !== null && hexDistance(at, frontAt) <= reach;
  });
  const centre = anchorCentroid(world, line) ?? frontAt;
  const span = hexDistance(centre, base);
  const depth = Math.min(STAND_BEHIND_TOWERS_NODES, span);
  const side = terrain.componentOf(door);
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  for (let behind = depth; behind >= 0; behind--) {
    const x = span === 0 ? centre.hx : centre.hx + Math.round(((base.hx - centre.hx) * behind) / span);
    const y = span === 0 ? centre.hy : centre.hy + Math.round(((base.hy - centre.hy) * behind) / span);
    if (hexDistanceBetween(x, y, frontAt.hx, frontAt.hy) > reach) continue;
    const node = terrain.nodeAtClamped(x, y);
    if (terrain.isWalkable(node) && !blocked.has(node) && terrain.componentOf(node) === side) return node;
  }
  return null;
}
