import {
  AttackOrder,
  CoinDrillOrder,
  Engagement,
  EquipOrder,
  PlayerOrder,
  removeCurrentAtomic,
  Settler,
  SettlerProgress,
  sameSide,
  TrainingOrder,
  Weapon,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { clearNavState } from '../movement/nav-state.js';
import { mayCoinDrill } from '../progression/coin-drill.js';
import { isBarracks } from '../readviews/index.js';
import { releaseTowerPost } from '../settlers/drives/tower-post.js';
import { wakeIdle } from '../settlers/planner/idle-replan.js';
import { entityNode } from '../spatial/nodes.js';
import { isOrderableSettler, supersedeStandingOrders } from './guards.js';
import { mayWalkToDrill } from './training.js';

const NO_EXPERIENCE: ReadonlyMap<number, number> = new Map();

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
 * Whether `e` may be sent to coin-drill at `house` now, the one gate of the player order and the assistant:
 * his own side's finished barracks, {@link mayCoinDrill} on his state and a door he can walk to. A coin in
 * the barracks is not asked for: an ordered soldier walks there anyway.
 */
export function mayCoinDrillAt(world: World, ctx: SystemContext, e: Entity, house: Entity): boolean {
  if (!isOrderableSettler(world, e)) return false;
  if (!isBarracks(world, ctx, house) || !sameSide(world, e, house)) return false;
  const experience = world.tryGet(e, SettlerProgress)?.experience ?? NO_EXPERIENCE;
  if (!mayCoinDrill(ctx.content, world.get(e, Settler), world.tryGet(e, Weapon)?.weaponTypeId, experience))
    return false;
  return mayWalkToDrill(world, ctx, e, house);
}

/** Stamp the coin-drill errand once {@link mayCoinDrillAt} passed and drop what it supersedes: a fight, a
 *  walk, an equip errand, a tower post. A soldier re-ordered on his way back keeps the spot he left from. */
export function startCoinDrill(world: World, ctx: SystemContext, e: Entity, house: Entity): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  releaseTowerPost(world, ctx, e);
  const returnTo = world.tryGet(e, CoinDrillOrder)?.returnTo ?? entityNode(world, terrain, e);
  world.add(e, CoinDrillOrder, { house, returnTo, stage: 'drill', paid: false });
  wakeIdle(world, e);
  removeCurrentAtomic(world, e);
  supersedeStandingOrders(world, e);
  world.remove(e, PlayerOrder);
  world.remove(e, EquipOrder);
  world.remove(e, TrainingOrder);
  world.remove(e, Engagement);
  world.remove(e, AttackOrder);
  clearNavState(world, e);
}
