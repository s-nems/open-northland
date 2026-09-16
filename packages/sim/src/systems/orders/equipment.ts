import type { EquipCategory } from '@open-northland/data';
import {
  Age,
  CurrentAtomic,
  Equipment,
  EquipOrder,
  equipSlotValue,
  MISC_EQUIP_SLOTS,
  MoveGoal,
  PathRequest,
  PlayerOrder,
  Position,
  Settler,
  Stranded,
  TrainingOrder,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isFighterJob, isHeroJob } from '../readviews/index.js';
import { isOrderableSettler } from './guards.js';

/**
 * The equip-window order handlers only validate and stamp the {@link EquipOrder} errand; a drive runs it.
 * The original's soldier-only `allowequip` gate lives in the panel's row model, not here, so a raw command
 * can still dress a civilian in a display-only weapon.
 */

/** Whether (`group`, `slot`) addresses a real equipment slot (the misc row indexed, 0 elsewhere). */
function isValidSlotAddress(group: EquipCategory, slot: number): boolean {
  if (!Number.isInteger(slot)) return false;
  if (group === 'misc') return slot >= 0 && slot < MISC_EQUIP_SLOTS;
  return slot === 0;
}

/** The shared issuer guard: a living owned adult settler with a trade, standing somewhere. A still-growing
 *  child is the GrowthSystem's to dress, not the player's, and a jobless settler is refused because the
 *  planner ladder never plans one, so its errand would sit inert forever. */
function isEquipOrderable(world: World, e: Entity): boolean {
  return (
    isOrderableSettler(world, e) &&
    world.has(e, Position) &&
    !world.has(e, Age) &&
    world.get(e, Settler).jobType !== null
  );
}

/**
 * Stamp the errand and make it authoritative like `moveUnit`: the current action and route are cancelled,
 * and a fresh errand replaces a previous one. `returnTo` captures the node the settler stands on at issue.
 */
function stampEquipOrder(
  world: World,
  terrain: TerrainGraph,
  e: Entity,
  spec: { group: EquipCategory; slot: number; goodType: number | null },
): void {
  world.remove(e, CurrentAtomic);
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, Stranded);
  world.remove(e, PlayerOrder);
  world.remove(e, TrainingOrder); // and a barracks drill, which outranks this errand and would outlast it
  const p = world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  world.add(e, EquipOrder, {
    ...spec,
    returnTo: terrain.nodeAtClamped(n.hx, n.hy),
    stage: 'acquire',
    issuer: 'player',
  });
}

/**
 * Order one owned adult settler to put `goodType` on in slot (`group`, `slot`) - see the command doc. The
 * slot address must exist, and a good with no `equip` class is not wearable.
 */
export function equipGood(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'equipGood' }>,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no stores to fetch from
  const e = command.entity;
  if (!isEquipOrderable(world, e)) return;
  if (isHeroJob(ctx.content, world.get(e, Settler).jobType)) return;
  if (!isValidSlotAddress(command.group, command.slot)) return;
  const good = contentIndex(ctx.content).goods.get(command.goodType);
  if (good?.equip === undefined || good.equip.category !== command.group) return;
  // A fighter keeps no tool, so the order is refused here rather than shed on enlistment later.
  if (command.group === 'tool' && isFighterJob(ctx.content, world.get(e, Settler).jobType)) return;
  stampEquipOrder(world, terrain, e, {
    group: command.group,
    slot: command.slot,
    goodType: command.goodType,
  });
}

/**
 * Order one owned adult settler to take the good in slot (`group`, `slot`) off - see the command doc.
 * An empty slot (or a settler with no {@link Equipment} at all) is a recoverable no-op.
 */
export function unequipGood(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'unequipGood' }>,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const e = command.entity;
  if (!isEquipOrderable(world, e)) return;
  if (isHeroJob(ctx.content, world.get(e, Settler).jobType)) return;
  if (!isValidSlotAddress(command.group, command.slot)) return;
  const eq = world.tryGet(e, Equipment);
  if (eq === undefined || equipSlotValue(eq, command.group, command.slot) === null) return;
  stampEquipOrder(world, terrain, e, { group: command.group, slot: command.slot, goodType: null });
}
