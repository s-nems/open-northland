import { Building, ChildOrder, Female, Marriage, Residence, Settler } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
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

// The family order handlers — marry / assignHouse / makeChild. Like every order, bad input is a
// recoverable skip (still logged for faithful replay), never a throw.

/**
 * The `marry` handler: match the issuer with the nearest eligible partner and start their wedding
 * (see {@link startWedding}; the FamilySystem walks them together and kisses them into a
 * {@link Marriage}). No eligible partner right now = the order auto-cancels (a skip).
 */
export function marry(world: World, ctx: SystemContext, command: Extract<Command, { kind: 'marry' }>): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e) || !mayMarry(world, e)) return;
  // Signpost confinement: the partner search only sees candidates inside the issuer's allowed area
  // (local circle + reachable guidepost network) — the same rule as every other target search.
  const terrain = ctx.terrain;
  const limit = terrain !== undefined ? navigationLimitFor(world, terrain, e) : null;
  const partner = findPartnerFor(world, e, terrain, limit);
  if (partner === null) return; // nobody to marry — the order cancels itself
  startWedding(world, e, partner);
}

/**
 * The `assignHouse` handler: move the issuer's whole family (see {@link familyOf}) into `house`. The
 * home type's `homeSize` caps FAMILIES (`logichomesize` 1..5 — see {@link familiesOf}), so the move
 * needs a free family slot beside the households already living there. Skips: a non-adult/dead/neutral
 * issuer, a target that is not a built same-tribe home, or a home with no free slot.
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
  // Signpost confinement: a home beyond the issuer's allowed area is refused like an out-of-area
  // assignWorker/move order — the player extends the network first, then houses the far family.
  const terrain = ctx.terrain;
  if (terrain !== undefined) {
    const limit = navigationLimitFor(world, terrain, e);
    if (limit !== null) {
      const inode = interactionNode(world, ctx, house);
      if (inode !== null && !limit.allowsNode(terrain.nodeAtClamped(inode.x, inode.y))) return;
    }
  }
  const family = familyOf(world, e);
  const members = new Set(family);
  // Households already living here, minus the mover's own (a re-assign into the same home is a no-op
  // slot-wise): each keeps its slot, and the arriving family needs one more.
  const others = familiesOf(world, house).filter((fam) => !fam.some((m) => members.has(m))).length;
  if (others + 1 > type.homeSize) return; // no free family slot
  for (const member of family) {
    world.add(member, Residence, { home: house }); // add overwrites — a move drops the old home
  }
}

/**
 * The `makeChild` handler: stamp (or re-sex) the woman's standing {@link ChildOrder}. The FamilySystem
 * drives its stages; the order persists until the birth. Skips: a dead/neutral/non-settler issuer, a
 * male, a child, an unmarried woman, or a couple whose previous child is still growing up.
 */
export function makeChild(
  world: World,
  _ctx: SystemContext,
  command: Extract<Command, { kind: 'makeChild' }>,
): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e) || !isAdultSettler(world, e)) return;
  if (!world.has(e, Female)) return; // only the wife carries the order (she runs its stages)
  const marriage = world.tryGet(e, Marriage);
  if (marriage === undefined || !world.isAlive(marriage.spouse)) return;
  const child = marriage.child;
  if (child !== null && world.isAlive(child) && isMinor(world, child)) return; // one child at a time
  world.add(e, ChildOrder, { child: command.child });
}
