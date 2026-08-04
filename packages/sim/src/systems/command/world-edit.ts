import { Building, Signpost } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { createResourceNode } from '../footprint/index.js';
import { razeBuilding } from '../lifecycle/cleanup.js';
import { dropOrStackGood } from '../settlers/atomics/effects/goods/index.js';

/** Build a standing resource node through the shared {@link createResourceNode} assembly. A `good` with no
 *  footprint record is bad input, and the world is left untouched. */
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
 *  `amount <= 0` or a good absent from the catalog is bad input - an id-neutral skip. */
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

/** Take a building off the map. The kind is checked at execution, not just liveness: in lockstep any peer
 *  can send any command and a queued target can change between issue and apply, so a demolish aimed at a
 *  settler or a boat must skip rather than destroy. Teardown goes through the shared {@link razeBuilding}
 *  seam combat razing uses, so the two paths cannot drift. */
export function demolish(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'demolish' }>,
): void {
  if (!world.has(command.building, Building)) return;
  razeBuilding(world, ctx, command.building);
}

/** Destroy a signpost, under the same kind-at-execution rule as {@link demolish}. The destroy moves the
 *  Signpost generation, so the network memo, placement blockers, and vision all pick it up. */
export function demolishSignpost(
  world: World,
  command: Extract<Command, { kind: 'demolishSignpost' }>,
): void {
  if (world.has(command.signpost, Signpost)) world.destroy(command.signpost);
}
