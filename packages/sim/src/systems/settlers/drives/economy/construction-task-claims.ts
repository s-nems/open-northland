import { CurrentAtomic, UnderConstruction } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { remainingConstructionStrikes } from '../../../economy/construction.js';
import { atomicHoldsSettler } from '../../atomics/busy.js';

/**
 * Planner-tick reservations for hammer strikes. Swings in progress seed the tally; idle builders then
 * claim only strikes that already-delivered material can absorb. A builder still walking in holds no
 * strike: it would keep the crew already standing at the site off the last swings until it arrived.
 */
export class ConstructionTaskClaims {
  private readonly hammerBySite = new Map<Entity, number>();
  private readonly strikeCapacityBySite = new Map<Entity, number>();

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
  ) {
    for (const e of world.query(CurrentAtomic)) {
      const effect = world.get(e, CurrentAtomic).effect;
      if (
        effect.kind === 'construct' &&
        atomicHoldsSettler(world, e) &&
        world.has(effect.site, UnderConstruction)
      ) {
        this.reserveHammer(effect.site);
      }
    }
  }

  /** Whether at least one already-delivered strike remains unclaimed. */
  hasHammerWork(site: Entity): boolean {
    return (this.hammerBySite.get(site) ?? 0) < this.strikeCapacity(site);
  }

  /** Whether a swinging or newly planned builder already holds a hammer strike here. */
  hasHammerClaim(site: Entity): boolean {
    return (this.hammerBySite.get(site) ?? 0) > 0;
  }

  /** Claim one usable strike for this planner pass. */
  claimHammer(site: Entity): boolean {
    if (!this.hasHammerWork(site)) return false;
    this.reserveHammer(site);
    return true;
  }

  private reserveHammer(site: Entity): void {
    this.hammerBySite.set(site, (this.hammerBySite.get(site) ?? 0) + 1);
  }

  /** Labor and deliveries cannot change during the planner system, so one demand read serves the pass. */
  private strikeCapacity(site: Entity): number {
    let capacity = this.strikeCapacityBySite.get(site);
    if (capacity === undefined) {
      capacity = remainingConstructionStrikes(this.world, this.ctx, site);
      this.strikeCapacityBySite.set(site, capacity);
    }
    return capacity;
  }
}
