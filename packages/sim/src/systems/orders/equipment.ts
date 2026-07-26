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
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isFighterJob } from '../readviews/index.js';
import { isOrderableSettler } from './guards.js';

/**
 * The equip-window order handlers: `equipGood` and `unequipGood` only validate and stamp the
 * {@link EquipOrder} errand (`agents/equip-order.ts` drives it). Two deferred guards, both named
 * elsewhere: wearing a weapon/armour good moves the equipment INVENTORY axis only (the combat
 * `Weapon`/`Armor` wiring is the `Equipment` component doc's deferred half), and the original's
 * soldier-only `allowequip` gate is enforced by the panel's row model, not yet here - a raw command
 * can dress a civilian in a display-only weapon. The tool axis is stricter: `equipGood` refuses one to
 * a fighter (the rule lives on `shedToolOnEnlist`, work/employment.ts).
 */

/** Whether (`group`, `slot`) addresses a real equipment slot (the misc row indexed, 0 elsewhere). */
function isValidSlotAddress(group: EquipCategory, slot: number): boolean {
  if (!Number.isInteger(slot)) return false;
  if (group === 'misc') return slot >= 0 && slot < MISC_EQUIP_SLOTS;
  return slot === 0;
}

/** The shared issuer guard: a living owned ADULT settler with a trade, standing somewhere. A
 *  still-growing child is the GrowthSystem's to dress, not the player's; a jobless settler
 *  (`jobType` null) is refused because the planner ladder never plans one, so its errand would sit
 *  inert forever. */
function isEquipOrderable(world: World, e: Entity): boolean {
  return (
    isOrderableSettler(world, e) &&
    world.has(e, Position) &&
    !world.has(e, Age) &&
    world.get(e, Settler).jobType !== null
  );
}

/**
 * Stamp the errand and make it authoritative, like `moveUnit`: the current action/route is cancelled
 * so the settler obeys now (a carried load is set down by the equip rung's first step), and a fresh
 * errand replaces a previous one. `returnTo` captures the node the settler stands on at issue.
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
  const p = world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  world.add(e, EquipOrder, { ...spec, returnTo: terrain.nodeAtClamped(n.hx, n.hy), stage: 'acquire' });
}

/**
 * Order one owned adult settler to put `goodType` on in slot (`group`, `slot`) - see the command doc.
 * Validation: the slot address must exist and the good's content `equip.category` must match `group`
 * (a good with no `equip` class is not wearable). Whether any source actually holds the good is the
 * errand's problem, not the command's - an empty settlement returns the settler empty-handed.
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
  if (!isValidSlotAddress(command.group, command.slot)) return;
  const good = contentIndex(ctx.content).goods.get(command.goodType);
  if (good?.equip === undefined || good.equip.category !== command.group) return;
  if (command.group === 'tool' && isFighterJob(world.get(e, Settler).jobType)) return; // module note
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
  if (!isValidSlotAddress(command.group, command.slot)) return;
  const eq = world.tryGet(e, Equipment);
  if (eq === undefined || equipSlotValue(eq, command.group, command.slot) === null) return;
  stampEquipOrder(world, terrain, e, { group: command.group, slot: command.slot, goodType: null });
}
