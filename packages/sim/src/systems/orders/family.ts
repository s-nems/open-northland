import {
  AssistantChildOrder,
  Building,
  ChildOrder,
  Female,
  Marriage,
  Residence,
  Settler,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import {
  builtHomeType,
  familiesOf,
  familyOf,
  findPartnerFor,
  isAdultSettler,
  isMinor,
  mayMarry,
  startWedding,
} from '../family/index.js';
import { interactionNode } from '../footprint/index.js';
import { navigationLimitFor } from '../signposts/index.js';
import { isOrderableSettler } from './guards.js';

/**
 * Match the issuer with the nearest eligible partner and start their wedding; the FamilySystem walks them
 * together and kisses them into a {@link Marriage}. With no eligible partner the order cancels itself.
 */
export function marry(world: World, ctx: SystemContext, command: Extract<Command, { kind: 'marry' }>): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e) || !mayMarry(world, ctx.content, e)) return;
  // Signpost confinement: the partner search only sees candidates inside the issuer's allowed area, the
  // same rule as every other target search.
  const terrain = ctx.terrain;
  const limit = terrain !== undefined ? navigationLimitFor(world, ctx.content, terrain, e) : null;
  const partner = findPartnerFor(world, ctx.content, e, terrain, limit);
  if (partner === null) return;
  startWedding(world, e, partner);
}

/**
 * Move the issuer's whole family into `house`. The home type's `homeSize` caps families, not people
 * (`logichomesize` 1..5), so the move needs a free family slot beside the households already living there.
 */
export function assignHouse(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'assignHouse' }>,
): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e) || !isAdultSettler(world, e)) return;
  const house = command.house;
  const type = builtHomeType(world, ctx, house);
  if (type === undefined) return;
  if (world.get(house, Building).tribe !== world.get(e, Settler).tribe) return;
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
  const family = familyOf(world, e);
  const members = new Set(family);
  // The mover's own household is excluded, so a re-assign into the same home costs no extra slot.
  const others = familiesOf(world, house).filter((fam) => !fam.some((m) => members.has(m))).length;
  if (others + 1 > type.homeSize) return; // no free family slot
  for (const member of family) {
    world.add(member, Residence, { home: house }); // add overwrites - a move drops the old home
  }
}

/**
 * Drop the issuer's whole family out of its home, freeing the family slot. The inverse of
 * {@link assignHouse}: the same unit that moves in moves out, so a child leaves with its parents.
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

/**
 * Stamp, or re-sex, the woman's standing {@link ChildOrder}. The FamilySystem drives its stages and the
 * order persists until the birth.
 */
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
