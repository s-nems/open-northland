import type { AiOrderOrigin } from '../../components/ai/order.js';
import {
  AiOrder,
  AttackOrder,
  aiControlEntity,
  ComputerOperations,
  CurrentAtomic,
  DeferredOrder,
  Engagement,
  ErectSignpostOrder,
  MusterPlan,
  OrderQueue,
  Owner,
  PlayerOrder,
  removeCurrentAtomic,
  Settler,
  VehicleOrderQueue,
  WaveMarch,
} from '../../components/index.js';
import type { AiDecisionSource } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { stopAtNextNode } from '../movement/nav-state.js';
import { MILITARY_MODE } from '../readviews/index.js';
import { stopVehicle } from '../vehicles/movement.js';
import { anchorAtFeet, setStance } from './combat.js';
import { withdrawQueuedAiOrders } from './queued.js';

/** Stamp an accepted replacement; a direct human or mission order releases AI ownership. */
export function recordAiOrder(world: World, entity: Entity, origin?: AiOrderOrigin): void {
  if (origin === undefined) world.remove(entity, AiOrder);
  else world.add(entity, AiOrder, { ...origin });
}

/** Retire only orders still owned by a controller that just lost permission. */
export function withdrawAiOrders(
  world: World,
  ctx: SystemContext,
  player: number,
  stopped: (source: AiDecisionSource) => boolean,
): void {
  withdrawQueuedAiOrders(world, OrderQueue, player, stopped);
  withdrawQueuedAiOrders(world, VehicleOrderQueue, player, stopped);

  for (const entity of world.query(AiOrder)) {
    const order = world.get(entity, AiOrder);
    if (order.player !== player || !stopped(order.source)) continue;
    if (world.tryGet(entity, Owner)?.player !== player) {
      world.remove(entity, AiOrder);
      continue;
    }
    withdrawAiEntityOrder(world, ctx, entity);
  }
}

/** A future re-enable starts a fresh decision rather than resuming a stale invasion. */
export function retireComputerCampaign(world: World, player: number): void {
  const carrier = aiControlEntity(world, player);
  if (carrier !== null) world.remove(carrier, ComputerOperations);
  for (const entity of new Set([...world.query(MusterPlan, Owner), ...world.query(WaveMarch, Owner)])) {
    if (world.get(entity, Owner).player !== player) continue;
    world.remove(entity, MusterPlan);
    world.remove(entity, WaveMarch);
  }
}

/** An unrestricted sortie must not reacquire its chase before map AI plans a bounded response. */
export function standDownAutonomousSorties(world: World, ctx: SystemContext, player: number): void {
  for (const entity of world.query(AiOrder, Owner)) {
    const origin = world.get(entity, AiOrder);
    if (origin.player !== player || origin.source !== 'settlement-defence') continue;
    if (world.get(entity, Owner).player !== player) continue;
    withdrawAiEntityOrder(world, ctx, entity);
    setStance(world, ctx, { kind: 'setStance', entity, mode: MILITARY_MODE.IGNORE });
  }
}

/** Release a recorded controller order before another controller assigns this unit. */
export function withdrawAiEntityOrder(world: World, ctx: SystemContext, entity: Entity): void {
  if (!world.has(entity, AiOrder)) return;
  world.remove(entity, PlayerOrder);
  world.remove(entity, AttackOrder);
  world.remove(entity, Engagement);
  world.remove(entity, DeferredOrder);
  world.remove(entity, ErectSignpostOrder);
  if (world.tryGet(entity, CurrentAtomic)?.effect.kind === 'erectSignpost')
    removeCurrentAtomic(world, entity);
  if (ctx.terrain !== undefined) stopAtNextNode(world, entity);
  stopVehicle(world, { kind: 'stopVehicle', vehicle: entity });
  if (world.has(entity, Settler)) anchorAtFeet(world, ctx, entity);
  world.remove(entity, AiOrder);
}
