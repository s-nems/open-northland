import { Building, Signpost } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import { dropOrStackGood } from '../agents/effects-goods/index.js';
import type { SystemContext } from '../context.js';
import { createResourceNode } from '../footprint/index.js';
import { unbindWorkersOf } from './placement.js';

// The map-editing commands — put a standing resource / a loose good pile on the map, or take a building /
// signpost off it. The runtime analogue of the scene-setup `place*` helpers, behind the HUD tools and the
// debug spawn palette. Each validates its target's KIND at execution (not just its liveness) and skips bad
// input, which is still logged for faithful replay.

/** Build a standing {@link Resource} node (a tree / mined deposit / plucked node) through the shared
 *  {@link createResourceNode} assembly. A `good` with no footprint record is bad input —
 *  `createResourceNode` returns null and the world is untouched. */
export function placeResource(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'placeResource' }>,
): void {
  createResourceNode(world, ctx.content, {
    good: command.good,
    x: command.x,
    y: command.y,
    remaining: command.remaining,
    harvestAtomic: command.harvestAtomic,
    ...(command.felling !== undefined ? { felling: command.felling } : {}),
    ...(command.deposit !== undefined ? { deposit: command.deposit } : {}),
  });
}

/** Drop a loose good pile, stacking onto an existing pile of the same good on the tile (capped at
 *  `MAX_GROUND_STACK`) so repeated one-unit clicks pile up rather than littering entities. An
 *  `amount <= 0` or a good absent from the catalog is bad input — an id-neutral skip. */
export function dropGood(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'dropGood' }>,
): void {
  if (command.amount <= 0) return;
  if (!contentIndex(ctx.content).goods.has(command.good)) return;
  const pos = positionOfNode(command.x, command.y);
  dropOrStackGood(world, pos.x, pos.y, command.good, command.amount);
}

/** Destroy a building entity (ids are never recycled), first unbinding every settler employed there (see
 *  {@link unbindWorkersOf}) so a worker isn't left latched to a dead workplace. In lockstep any peer can
 *  send any command (and a queued command's target can change between issue and apply), so a demolish aimed
 *  at a non-building entity — a settler, a resource node, a boat — must be a skip, never a destroy. */
export function demolish(world: World, command: Extract<Command, { kind: 'demolish' }>): void {
  if (!world.has(command.building, Building)) return;
  unbindWorkersOf(world, command.building);
  world.destroy(command.building);
}

/** Destroy a signpost — the same kind-at-execution rule as {@link demolish}: only a live {@link Signpost}
 *  falls. Destroying it moves the Signpost generation, so the network memo, placement blockers, and vision
 *  all pick it up. */
export function demolishSignpost(
  world: World,
  command: Extract<Command, { kind: 'demolishSignpost' }>,
): void {
  if (world.has(command.signpost, Signpost)) world.destroy(command.signpost);
}
