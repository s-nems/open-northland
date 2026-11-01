import {
  BuildMode,
  Carrying,
  playerPlacementTribes,
  professionProgressionEnabled,
  Settler,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { ownedSettlers } from '../../ai-shared/seat-roster.js';
import { isAllocatableMan } from '../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../context.js';
import { jobAwaitsDiscovery, needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { technologyTable } from './requirements.js';

/**
 * One decision's promotions into gated trades (owner ruling): when no spare man qualifies for a slot whose
 * trade an experience row gates, the man who earned it moves up, the farmer to the mill or the clay
 * gatherer to the pottery, and the next allocation refills his old post with a fresh civilian. He may
 * hold an enabling trade or have left it for an open one since: the clay gatherer goes back to the
 * builders once the clay is stocked, and the pottery still needs him, since nobody else earned it. Men
 * of an open trade go first, since anyone can take their post; then ascending id. A man holding a load
 * waits until he sets it down, since the trade change would drop it, and an apprentice stays on the work
 * earning his discovery.
 */
export class Promotions {
  private readonly promoted = new Set<Entity>();

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly player: number,
    private readonly apprentices: ReadonlySet<Entity>,
  ) {}

  /** The man to move into a slot of `job`, claimed for this decision, or null when none qualifies. */
  take(job: number): Entity | null {
    const { world, ctx, player } = this;
    if (!professionProgressionEnabled(world)) return null;
    const tribe = playerPlacementTribes(world, player)?.[0];
    const gate = tribe === undefined ? undefined : technologyTable(ctx.content, tribe)?.jobs.get(job);
    if (gate === undefined || gate.needs.length === 0) return null;
    let best: Entity | null = null;
    let bestOpen = false;
    for (const e of ownedSettlers(world, player)) {
      if (this.promoted.has(e) || this.apprentices.has(e) || !isAllocatableMan(world, ctx, e)) continue;
      if (world.has(e, BuildMode) || world.has(e, Carrying)) continue;
      const settler = world.get(e, Settler);
      const current = settler.jobType;
      if (current === null || current === job) continue;
      const open = !jobAwaitsDiscovery(ctx, settler.tribe, current);
      if (!open && !gate.enablingJobs.includes(current)) continue;
      if (!settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', job)) continue;
      if (best === null || (open && !bestOpen)) {
        best = e;
        bestOpen = open;
      }
      if (bestOpen) break;
    }
    if (best !== null) this.promoted.add(best);
    return best;
  }
}
