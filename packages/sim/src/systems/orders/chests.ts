import {
  Age,
  Chest,
  CurrentAtomic,
  OpenChestOrder,
  Owner,
  PlayerOrder,
  Position,
  Settler,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import { jobCanOpenChest, OPEN_CHEST_ATOMIC_ID } from '../chests/index.js';
import type { System, SystemContext } from '../context.js';
import { resourceWorkCell } from '../footprint/index.js';
import { atomicClipName, atomicDurationForName } from '../readviews/animations.js';
import { canonicalById, entityNode } from '../spatial/nodes.js';
import { deferOrderDuringAtomic, isOrderableSettler } from './guards.js';
import { moveUnit } from './movement.js';

function canOpenChest(world: World, ctx: SystemContext, settler: Entity, chest: Entity): boolean {
  if (!world.isAlive(chest) || !world.has(chest, Chest)) return false;
  if (world.has(settler, Age)) return false; // a child opens nothing
  return jobCanOpenChest(ctx.content, world.get(settler, Settler).jobType, world.get(chest, Chest).kind);
}

/**
 * Order one owned settler to open `chest` - see the command doc. Runs as a normal {@link moveUnit} walk to
 * the chest's nearest work cell carrying an {@link OpenChestOrder}, which {@link chestOrderSystem} turns
 * into the open-chest clip on arrival.
 */
export function orderOpenChest(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'openChest' }>,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no cells to walk
  const e = command.entity;
  if (!isOrderableSettler(world, e) || !world.has(e, Position)) return;
  if (!canOpenChest(world, ctx, e, command.chest)) return;
  // A non-interruptible atomic parks the whole command, as an inner moveUnit alone would strand the marker.
  if (deferOrderDuringAtomic(world, ctx, e, command)) return;
  const stance = resourceWorkCell(world, terrain, command.chest, entityNode(world, terrain, e));
  const c = terrain.coordsOf(stance);
  if (!moveUnit(world, ctx, { kind: 'moveUnit', entity: e, x: c.x, y: c.y })) return; // refused: no order stands
  world.add(e, OpenChestOrder, { chest: command.chest });
}

/**
 * Turn an arrived {@link OpenChestOrder} into the one-shot open-chest clip. Runs after the player-order
 * system retires the walk and before the planner, so the clip starts before the economy could re-task the
 * settler. The chest is re-checked on arrival because it may have been opened by someone else en route;
 * two openers arriving together both bend down, and the second's effect finds the chest gone.
 */
export const chestOrderSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  // Copied, because the loop removes the marker it iterates.
  for (const e of canonicalById(world.query(Settler, OpenChestOrder))) {
    const chest = world.get(e, OpenChestOrder).chest;
    if (!canOpenChest(world, ctx, e, chest) || !world.has(e, Owner)) {
      world.remove(e, OpenChestOrder); // chest gone, or the settler no longer qualifies
      continue;
    }
    if (world.has(e, PlayerOrder)) continue; // still walking the order out, or setting a load down first
    if (world.has(e, CurrentAtomic)) {
      world.remove(e, OpenChestOrder); // a need drive took over - the order is abandoned
      continue;
    }
    world.remove(e, OpenChestOrder);
    const here = entityNode(world, terrain, e);
    if (resourceWorkCell(world, terrain, chest, here) !== here) continue; // the walk ended elsewhere
    const settler = world.get(e, Settler);
    const p = world.get(chest, Position);
    const target = nodeOfPosition(p.x, p.y);
    // `tribetypes.ini` binds the open-chest clip to the woman and civilist only; every other adult trade
    // reaches it through its `baseatomics` parent, which the civilist fallback stands in for.
    world.add(e, CurrentAtomic, {
      atomicId: OPEN_CHEST_ATOMIC_ID,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: atomicDurationForName(
        ctx.content,
        atomicClipName(ctx.content, settler, OPEN_CHEST_ATOMIC_ID),
      ),
      effect: { kind: 'openChest', chest },
      targetEntity: chest,
      targetTile: { x: target.hx, y: target.hy },
    });
  }
};
