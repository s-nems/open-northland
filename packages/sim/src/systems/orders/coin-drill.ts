import {
  AttackOrder,
  CoinDrillOrder,
  Engagement,
  EquipOrder,
  PlayerOrder,
  removeCurrentAtomic,
  Settler,
  sameSide,
  TrainingOrder,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { clearNavState } from '../movement/nav-state.js';
import { isBarracks } from '../readviews/index.js';
import { soldierMayCoinDrill } from '../settlers/drives/coin-drill.js';
import { freeDrillCoins } from '../settlers/drives/coin-drill-coins.js';
import { releaseTowerPost } from '../settlers/drives/tower-post.js';
import { wakeIdle } from '../settlers/planner/idle-replan.js';
import { entityNode } from '../spatial/nodes.js';
import { isOrderableSettler, supersedeStandingOrders } from './guards.js';
import { mayWalkToDrill } from './training.js';

/**
 * Send one owned soldier to coin-drill at a barracks - see the command doc. Re-issuing the order he is
 * already walking out is a no-op, so a double click keeps his place.
 */
export function orderCoinDrill(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'orderCoinDrill' }>,
): void {
  const { entity: e, house } = command;
  if (!mayCoinDrillAt(world, ctx, e, house)) return;
  const held = world.tryGet(e, CoinDrillOrder);
  if (held?.house === house && held.stage === 'drill') return;
  startCoinDrill(world, ctx, e, house);
}

/**
 * Whether `e` may be sent to coin-drill at `house` now, the order's gate: his own side's finished barracks
 * holding a coin no other man speaks for ({@link freeDrillCoins}), {@link soldierMayCoinDrill} on his state and a
 * door he can walk to. A volley of orders in one tick so sends no more men than there are free coins.
 */
export function mayCoinDrillAt(world: World, ctx: SystemContext, e: Entity, house: Entity): boolean {
  if (!isOrderableSettler(world, e)) return false;
  if (!isBarracks(world, ctx, house) || !sameSide(world, e, house)) return false;
  if (!soldierMayCoinDrill(world, ctx, e, world.get(e, Settler))) return false;
  if (freeDrillCoins(world, ctx, house, e) <= 0) return false;
  return mayWalkToDrill(world, ctx, e, house);
}

/** Stamp the coin-drill errand once {@link mayCoinDrillAt} passed and drop what it supersedes: a fight, a
 *  walk, an equip errand, a tower post. A soldier re-ordered on his way back keeps the spot he left from. */
function startCoinDrill(world: World, ctx: SystemContext, e: Entity, house: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  releaseTowerPost(world, ctx, e);
  const returnTo = world.tryGet(e, CoinDrillOrder)?.returnTo ?? entityNode(world, terrain, e);
  // First, as it calls off the drill he may already be on.
  supersedeStandingOrders(world, ctx, e);
  world.add(e, CoinDrillOrder, { house, returnTo, stage: 'drill', termTicksLeft: 0 });
  wakeIdle(world, e);
  removeCurrentAtomic(world, e);
  world.remove(e, PlayerOrder);
  world.remove(e, EquipOrder);
  world.remove(e, TrainingOrder);
  world.remove(e, Engagement);
  world.remove(e, AttackOrder);
  clearNavState(world, e);
}
