import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, hexDistance } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { rallyNodeOf } from '../../orders/rally-point.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { seatBarracksOf, seatBaseOf } from '../base.js';
import { enemiesSurround, settlementEdgeToward } from '../build-order/ground/front.js';
import { nearestEnemyBuilding } from '../sea-route.js';
import { forecastAttackOrigin } from './deadline.js';
import { type StandGround, standGroundOf } from './temple-station.js';
import { towerStandToward } from './tower-stand.js';

/** How far the wanted stand may drift from the planted flag before the seat moves it, in hex nodes
 *  (authored): the stand shifts a few nodes with every tower manned or lost, and an army called to a new
 *  flag each time never forms a wave. On magiczny_las a slack just past the flag's own snap moved the
 *  flags of most seats several times an hour. */
const RALLY_MOVE_SLACK_NODES = 16;

/**
 * Where `player`'s seat keeps its barracks' rally flag (owner ruling: the barracks stands by the base and
 * the army gathers on the side the attacks come from, under the towers). The side is where its forecast
 * attacks set out from, else its nearest believed enemy building on the barracks' own land: a rival only
 * ships reach names no side, and the army stays by the door its landings sail from. The stand is the one
 * under the manned towers facing the side ({@link towerStandToward}), and the settlement's edge toward it
 * while no tower is manned. Null without a base or a side, and while enemies surround the seat.
 */
export function rallyStandOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  door: NodeId,
  ground: StandGround,
): NodeId | null {
  const base = seatBaseOf(world, ctx, player);
  const baseAt = base === null ? null : anchorNodeOf(world, base);
  if (baseAt === null || enemiesSurround(world, player, baseAt)) return null;
  const side =
    forecastAttackOrigin(world, ctx, player) ?? landRivalOf(world, ctx, terrain, player, baseAt, door);
  if (side === null) return null;
  const underTowers = towerStandToward(world, ctx, terrain, owned, baseAt, side, door, ground);
  if (underTowers !== null) return underTowers;
  const edge = settlementEdgeToward(world, owned, baseAt, side);
  return terrain.nodeAtClamped(edge.hx, edge.hy);
}

/**
 * The orders that keep the seat's rally flag on {@link rallyStandOf}: plant it, move it once the stand has
 * drifted past {@link RALLY_MOVE_SLACK_NODES}, and take it away when the seat has no stand. The sim snaps
 * the flag to legal ground or refuses the order, which the next decision asks again.
 */
export function rallyOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
): readonly PlayerCommand[] {
  const barracks = seatBarracksOf(world, ctx, player);
  if (barracks === null) return [];
  const door = interactionCell(world, ctx, terrain, barracks);
  const stand = rallyStandOf(
    world,
    ctx,
    terrain,
    player,
    owned,
    door,
    standGroundOf(world, ctx, terrain, player),
  );
  const planted = rallyNodeOf(world, terrain, barracks);
  if (stand === null) return planted === undefined ? [] : [{ kind: 'clearRallyPoint', building: barracks }];
  const want = terrain.coordsOf(stand);
  if (planted !== undefined) {
    const at = terrain.coordsOf(planted);
    if (hexDistance({ hx: at.x, hy: at.y }, { hx: want.x, hy: want.y }) <= RALLY_MOVE_SLACK_NODES) return [];
  }
  return [{ kind: 'setRallyPoint', building: barracks, x: want.x, y: want.y }];
}

/** The node of the believed enemy building nearest `base`, when it stands on `door`'s land; else null. */
function landRivalOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  base: HalfCellNode,
  door: NodeId,
): HalfCellNode | null {
  const rival = nearestEnemyBuilding(world, ctx, player, base)?.node;
  if (rival === undefined) return null;
  const sameLand =
    terrain.componentOf(terrain.nodeAtClamped(rival.hx, rival.hy)) === terrain.componentOf(door);
  return sameLand ? rival : null;
}
