import { AssistantChildOrder, ChildOrder, Female, Marriage, Residence } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import {
  familyOf,
  findPartnerFor,
  isAdultSettler,
  isMinor,
  mayMarry,
  moveFamilyInto,
  startWedding,
} from '../family/index.js';
import { interactionNode } from '../footprint/index.js';
import { navigationLimitFor } from '../signposts/index.js';
import { groupPlacementOrder } from './group-placement.js';
import { isOrderableSettler } from './guards.js';

/**
 * Match the issuer with the nearest eligible partner and start their wedding - see the command doc. The
 * FamilySystem walks them together and kisses them into a {@link Marriage}.
 */
export function marry(world: World, ctx: SystemContext, command: Extract<Command, { kind: 'marry' }>): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e) || !mayMarry(world, ctx.content, e)) return;
  // Signpost confinement: the partner search only sees candidates inside the issuer's allowed area, the
  // same rule as every other target search.
  const terrain = ctx.terrain;
  const limit = terrain !== undefined ? navigationLimitFor(world, ctx.content, terrain, e) : null;
  const partner = findPartnerFor(world, ctx.content, e, terrain, limit);
  if (partner === null) {
    ctx.events.emit({ kind: 'marriageUnmatched', entity: e });
    return;
  }
  startWedding(world, e, partner);
}

/**
 * Move the issuer's whole family into `house` - see the command doc. `homeSize` caps families, not people,
 * so the move needs a free family slot beside the households already living there.
 */
export function assignHouse(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'assignHouse' }>,
): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e) || !isAdultSettler(world, e)) return;
  const house = command.house;
  // Signpost confinement: a home beyond the issuer's allowed area is refused like an out-of-area move
  // order, so the player extends the network first and houses the far family after.
  const terrain = ctx.terrain;
  if (terrain !== undefined) {
    const limit = navigationLimitFor(world, ctx.content, terrain, e);
    if (limit !== null) {
      const inode = interactionNode(world, ctx, house);
      if (inode !== null && !limit.allowsNode(terrain.nodeAtClamped(inode.x, inode.y))) return;
    }
  }
  moveFamilyInto(world, ctx, e, house);
}

/** House the group's families in one home - see the command doc and {@link groupPlacementOrder}. */
export function assignHouseGroup(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'assignHouseGroup' }>,
): void {
  const house = command.house;
  const homeOf = (e: Entity): Entity | undefined => world.tryGet(e, Residence)?.home;
  for (const { entity } of groupPlacementOrder(world, ctx, command.members, house, homeOf)) {
    if (homeOf(entity) === house) continue; // moved in with an earlier member's family
    assignHouse(world, ctx, { kind: 'assignHouse', entity, house });
  }
}

/**
 * Drop the issuer's whole family out of its home. The inverse of {@link assignHouse}: the same unit that
 * moves in moves out, so a child leaves with its parents.
 */
export function unassignHouse(
  world: World,
  _ctx: SystemContext,
  command: Extract<Command, { kind: 'unassignHouse' }>,
): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e) || !isAdultSettler(world, e)) return;
  if (!world.has(e, Residence)) return; // already homeless - nothing to free
  for (const member of familyOf(world, e)) world.remove(member, Residence);
}

/** Stamp, or re-sex, the woman's standing {@link ChildOrder}; the FamilySystem drives its stages. */
export function makeChild(
  world: World,
  _ctx: SystemContext,
  command: Extract<Command, { kind: 'makeChild' }>,
): void {
  const e = command.entity;
  if (!mayBearChild(world, e)) return;
  world.remove(e, AssistantChildOrder); // an explicit order supersedes the assistant's booking
  world.add(e, ChildOrder, { child: command.child });
}

/** Whether a `makeChild` order on `e` would be accepted right now, shared with the assistant's birth
 *  dispatcher so an auto-issued order obeys exactly the player's gates. */
export function mayBearChild(world: World, e: Entity): boolean {
  if (!isOrderableSettler(world, e) || !isAdultSettler(world, e)) return false;
  if (!world.has(e, Female)) return false; // only the wife carries the order (she runs its stages)
  const marriage = world.tryGet(e, Marriage);
  if (marriage === undefined || !world.isAlive(marriage.spouse)) return false;
  const child = marriage.child;
  return child === null || !world.isAlive(child) || !isMinor(world, child); // one child at a time
}
