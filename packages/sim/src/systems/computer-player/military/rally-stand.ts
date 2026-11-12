import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, hexDistance, nodeManhattan } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { anchorNodeOf, towardNode } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { rallyNodeOf } from '../../orders/rally-point.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { seatBarracksOf, seatBaseOf } from '../base.js';
import { enemiesSurround } from '../build-order/ground/front.js';
import { nearestEnemyBuilding } from '../sea-route.js';
import { forecastAttackOrigin } from './deadline.js';
import { type StandGround, standGroundOf, templeStationOf } from './temple-station.js';
import { towerStandToward } from './tower-stand.js';

/** How far the wanted stand may drift from the planted flag before the seat moves it, in hex nodes
 *  (authored): the stand shifts a few nodes with every tower manned or lost, and an army called to a new
 *  flag each time never forms a wave. */
const RALLY_MOVE_SLACK_NODES = 16;

/**
 * Where `player`'s seat keeps its barracks' rally flag (owner ruling: the barracks stands by the base and
 * the army gathers on the side the attacks come from, under the towers). The side is where its forecast
 * attacks set out from, else its nearest believed enemy building when that stands on the barracks' own
 * land: a rival only ships reach names no side, and the army stays by the door its landings sail from.
 * The stand is the one under the manned towers facing the side ({@link towerStandToward}), and the
 * settlement's edge toward it while no tower is manned and the edge is open ground of that land. A seat
 * with a temple keeps the flag inside its aura, on the spot of it nearest that stand (owner ruling: the
 * waiting army stands blessed, its hitpoints past their max), even past its towers' reach. Null with no
 * stand, without a base, and while enemies surround the seat.
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
  const stand = frontStandOf(world, ctx, terrain, owned, baseAt, side, door, ground);
  return stand === null ? null : (templeStationOf(terrain, ground, stand) ?? stand);
}

/** The stand on the side the attacks come from, before a temple draws it in. */
function frontStandOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  baseAt: HalfCellNode,
  side: HalfCellNode,
  door: NodeId,
  ground: StandGround,
): NodeId | null {
  const underTowers = towerStandToward(world, ctx, terrain, owned, baseAt, side, door, ground);
  if (underTowers !== null) return underTowers;
  const edge = settlementEdgeToward(world, owned, baseAt, side);
  const node = terrain.nodeAtClamped(edge.hx, edge.hy);
  return terrain.isWalkable(node) && terrain.componentOf(node) === terrain.componentOf(door) ? node : null;
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

/** How far past the settlement's front-most building its edge toward the enemy lies, in Manhattan nodes
 *  (authored): on the edge, never a whole reach out from it. */
const EDGE_STEP_NODES = 8;

/**
 * The settlement's edge toward `target`: the seat's building nearest it (the lowest id on a tie, `owned`
 * walking ascending), or `anchor` while none has a node, pushed {@link EDGE_STEP_NODES} toward it.
 */
function settlementEdgeToward(
  world: World,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  target: HalfCellNode,
): HalfCellNode {
  let edge = anchor;
  let edgeDistance = Number.POSITIVE_INFINITY;
  for (const e of owned) {
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    const distance = nodeManhattan(node, target);
    if (distance < edgeDistance) {
      edge = node;
      edgeDistance = distance;
    }
  }
  return towardNode(edge, target, EDGE_STEP_NODES);
}
