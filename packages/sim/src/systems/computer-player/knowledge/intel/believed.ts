import { Building, Owner } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import { ownedBuildings } from '../../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../../context.js';
import { fogHides, playerSeesNode } from '../../../vision/gates.js';
import { rememberedBuildings } from './read.js';

/**
 * The buildings `seat` believes stand, of `owner` or of everyone when null, ascending id: the ones it sees
 * now, read live, and the remembered ones whose spot it does not see. With nothing hidden that is every
 * building. A remembered building that no longer exists is left out, since an order or a door can only
 * name a live entity; approximation: the seat learns of such a loss out of sight. Relations and the live
 * state of a believed building are the caller's to read.
 */
export function believedBuildings(
  world: World,
  ctx: SystemContext,
  seat: number,
  owner: number | null = null,
): readonly Entity[] {
  const live = owner === null ? world.canonicalQuery(Building, Owner) : ownedBuildings(world, owner);
  const fog = ctx.fog;
  if (!fogHides(fog)) return live;
  const believed: Entity[] = [];
  for (const e of live) {
    const node = anchorNodeOf(world, e);
    if (node !== null && playerSeesNode(fog, seat, node.hx, node.hy)) believed.push(e);
  }
  for (const b of rememberedBuildings(world, seat)) {
    if (owner !== null && b.owner !== owner) continue;
    // A spot in sight was read live above.
    if (playerSeesNode(fog, seat, b.hx, b.hy) || !world.has(b.entity, Building)) continue;
    believed.push(b.entity);
  }
  return believed.sort((a, b) => a - b);
}
