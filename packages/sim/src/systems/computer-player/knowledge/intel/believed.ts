import { Building, type IntelBuilding, Owner } from '../../../../components/index.js';
import type { DeepReadonly, Entity, World } from '../../../../ecs/world.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import { ownedBuildings } from '../../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../../context.js';
import { fogHides, playerSeesNode } from '../../../vision/gates.js';
import { rememberedBuildings } from './read.js';

/** The buildings a seat believes stand, split by what it may read of them. */
export interface BelievedBuildings {
  /** The ones whose spot it sees now, read live, ascending id; with nothing hidden, every building. */
  readonly seen: readonly Entity[];
  /** The remembered ones whose spot it does not see, as last seen, ascending id. One may since have fallen
   *  or changed hands: it stays a place to go and look, so read only its record, never its entity. */
  readonly remembered: readonly DeepReadonly<IntelBuilding>[];
}

const NOTHING_REMEMBERED: readonly DeepReadonly<IntelBuilding>[] = [];

/**
 * The buildings `seat` believes stand, of `owner` or of everyone when null. A remembered building leaves
 * the belief only when the seat sees its spot again (then it is read live, or forgotten if gone).
 * Relations and the live state of a seen building are the caller's to read.
 */
export function believedBuildings(
  world: World,
  ctx: SystemContext,
  seat: number,
  owner: number | null = null,
): BelievedBuildings {
  const live = owner === null ? world.canonicalQuery(Building, Owner) : ownedBuildings(world, owner);
  const fog = ctx.fog;
  if (!fogHides(fog)) return { seen: live, remembered: NOTHING_REMEMBERED };
  const seen: Entity[] = [];
  for (const e of live) {
    const node = anchorNodeOf(world, e);
    if (node !== null && playerSeesNode(fog, seat, node.hx, node.hy)) seen.push(e);
  }
  const remembered = rememberedBuildings(world, seat).filter(
    (b) => (owner === null || b.owner === owner) && !playerSeesNode(fog, seat, b.hx, b.hy),
  );
  return { seen, remembered };
}
