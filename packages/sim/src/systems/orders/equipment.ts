import type { EquipCategory } from '@open-northland/data';
import {
  Age,
  CurrentAtomic,
  Equipment,
  EquipOrder,
  type EquipOrderIntent,
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
import { canEquipCategory, isHeroJob } from '../readviews/index.js';
import { isOrderableSettler } from './guards.js';

/**
 * The equip-window order handlers validate and stamp the {@link EquipOrder} errand; a drive runs it.
 * Wearability is checked here as well as in the picker so a profession change between opening the window
 * and clicking a row cannot dress a civilian in arms or hand a fighter a tool.
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
 * Stamp or queue an errand. A player order for another equipment slot waits behind the active player
 * errand; a later order for the same slot remains latest-wins. `returnTo` captures the issue position.
 */
function stampEquipOrder(
  world: World,
  terrain: TerrainGraph,
  e: Entity,
  spec: { group: EquipCategory; slot: number; goodType: number | null },
): void {
  const p = world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  const intent: EquipOrderIntent = {
    ...spec,
    returnTo: terrain.nodeAtClamped(n.hx, n.hy),
  };
  const active = world.tryMut(e, EquipOrder);
  if (active?.issuer === 'player' && (active.group !== spec.group || active.slot !== spec.slot)) {
    active.queued ??= [];
    const sameSlot = active.queued.findIndex(
      (queued) => queued.group === spec.group && queued.slot === spec.slot,
    );
    if (sameSlot < 0) active.queued.push(intent);
    else active.queued[sameSlot] = intent;
    return;
  }
  const queued = active?.issuer === 'player' ? (active.queued ?? []) : [];
  world.remove(e, CurrentAtomic);
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, Stranded);
  world.remove(e, PlayerOrder);
  world.remove(e, TrainingOrder); // and a barracks drill, which outranks this errand and would outlast it
  world.add(e, EquipOrder, {
    ...intent,
    stage: 'acquire',
    issuer: 'player',
    queued,
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
  const jobType = world.get(e, Settler).jobType;
  if (isHeroJob(ctx.content, jobType)) return;
  if (!isValidSlotAddress(command.group, command.slot)) return;
  const good = contentIndex(ctx.content).goods.get(command.goodType);
  if (good?.equip === undefined || good.equip.category !== command.group) return;
  if (!canEquipCategory(ctx.content, jobType, command.group)) return;
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
