import { Building, Health, Settler, Stockpile } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

// The dev/admin `debug*` commands — the spawn/inspect palette's direct pokes at world state. They are real
// commands (logged and replayed like any other), so each is a no-op on a target of the wrong kind rather
// than a throw.

/**
 * Kill a unit: drain its {@link Health} pool to 0 and let the CleanupSystem reap it next tick (the real
 * death path + event), rather than a silent destroy. Gated on {@link Settler} (animals are settlers too) so
 * a building that carries a Health pool while under construction can't be drained-and-reaped here — that
 * would destroy the building through CleanupSystem, bypassing demolish's worker-unbind seam and emitting a
 * `settlerDied` cue for a non-settler. A non-settler / already-reaped target is a no-op.
 */
export function debugKill(world: World, command: Extract<Command, { kind: 'debugKill' }>): void {
  if (!world.has(command.target, Settler)) return;
  const health = world.tryGet(command.target, Health);
  if (health !== undefined) health.hitpoints = 0;
}

/** Set the needs the panel names to whole-percent levels (0 sated … 100 maxed). A non-settler target is a
 *  no-op. */
export function debugSetNeeds(world: World, command: Extract<Command, { kind: 'debugSetNeeds' }>): void {
  const settler = world.tryGet(command.target, Settler);
  if (settler === undefined) return;
  if (command.hunger !== undefined) settler.hunger = needFixedFromPct(command.hunger);
  if (command.fatigue !== undefined) settler.fatigue = needFixedFromPct(command.fatigue);
  if (command.piety !== undefined) settler.piety = needFixedFromPct(command.piety);
  if (command.enjoyment !== undefined) settler.enjoyment = needFixedFromPct(command.enjoyment);
}

/** A whole-percent need level (`0..100`, clamped) as the `0..ONE` need `Fixed` — a single truncation
 *  (`ONE · pct / 100`) so 0 → sated and 100 → maxed exactly, the debug-needs command's one conversion. */
function needFixedFromPct(pct: number): Fixed {
  const clamped = pct < 0 ? 0 : pct > 100 ? 100 : Math.trunc(pct);
  return fx.mulDiv(ONE, fx.fromInt(clamped), fx.fromInt(100));
}

/** Set every good the building type declares a stock slot for to that slot's capacity (its "100%"). A
 *  non-building target, one without a {@link Stockpile}, or an unknown type is a no-op. */
export function debugFillStockpile(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'debugFillStockpile' }>,
): void {
  const building = world.tryGet(command.target, Building);
  if (building === undefined || !world.has(command.target, Stockpile)) return;
  const type = contentIndex(ctx.content).commandBuildings.get(building.buildingType);
  if (type === undefined) return;
  const stock = world.get(command.target, Stockpile).amounts;
  for (const slot of type.stock) stock.set(slot.goodType, slot.capacity);
}
