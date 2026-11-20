import type { MapSiege } from '@open-northland/data';
import { Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { World } from '../../ecs/world.js';
import { garrisonSlots } from '../ai-shared/military/defence/posts.js';
import { anchorNodeOf } from '../ai-shared/node-geometry.js';
import { isBuilt, ownedBuildings } from '../ai-shared/seat-roster.js';
import type { SystemContext } from '../context.js';
import { assignedWorkers } from '../stores/assigned-workers.js';
import { spawnPostedAtKeep } from './keep.js';

type TowerGarrison = NonNullable<MapSiege['towerGarrison']>;

/**
 * Make each finished stronghold tower's missing archers at the keep, posted to it, so they walk up and man
 * it. A tower raised again since is one of the seat's buildings like the first, so it is manned again.
 */
export function keepTowerGarrison(
  world: World,
  ctx: SystemContext,
  siege: MapSiege,
  garrison: TowerGarrison,
): void {
  const seat = siege.stronghold.seat;
  const jobTypeBySlug = contentIndex(ctx.content).jobTypeBySlug;
  for (const tower of ownedBuildings(world, seat)) {
    const posts = garrisonSlots(world, ctx, tower);
    if (posts.size === 0 || !isBuilt(world, tower)) continue;
    const anchor = anchorNodeOf(world, tower);
    if (anchor === null) continue;
    const held = new Map<number, number>();
    for (const e of assignedWorkers(world, tower)) {
      const job = world.tryGet(e, Settler)?.jobType;
      if (job != null) held.set(job, (held.get(job) ?? 0) + 1);
    }
    for (const slot of garrison.slots) {
      const jobType = jobTypeBySlug.get(slot.job);
      if (jobType === undefined) continue;
      const missing = Math.min(slot.count, posts.get(jobType) ?? 0) - (held.get(jobType) ?? 0);
      for (let i = 0; i < missing; i++) {
        // A tower that would not take one takes no more this beat; the next beat tries again.
        if (spawnPostedAtKeep(world, ctx, siege, jobType, tower, anchor) === null) break;
      }
    }
  }
}
