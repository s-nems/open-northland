import { CurrentAtomic, UnderConstruction } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { remainingConstructionSteps } from '../../../economy/construction.js';
import { atomicHoldsSettler } from '../../atomics/busy.js';

/**
 * Planner-tick reservations for hammer swings, one construction step each. Swings in progress seed the
 * tally; idle builders then claim only steps that already-delivered material can absorb. A builder still
 * walking in holds no step: it would keep the crew already standing at the site off the last swings
 * until it arrived.
 */
export class ConstructionTaskClaims {
  private readonly hammerBySite = new Map<Entity, number>();
  private readonly stepCapacityBySite = new Map<Entity, number>();

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

  /** Whether at least one already-delivered step remains unclaimed. */
  hasHammerWork(site: Entity): boolean {
    return (this.hammerBySite.get(site) ?? 0) < this.stepCapacity(site);
  }

  /** Whether a swinging or newly planned builder already holds a hammer swing here. */
  hasHammerClaim(site: Entity): boolean {
    return (this.hammerBySite.get(site) ?? 0) > 0;
  }

  /** Claim one usable step for this planner pass. */
  claimHammer(site: Entity): boolean {
    if (!this.hasHammerWork(site)) return false;
    this.reserveHammer(site);
    return true;
  }

  private reserveHammer(site: Entity): void {
    this.hammerBySite.set(site, (this.hammerBySite.get(site) ?? 0) + 1);
  }

  /** Labor and deliveries cannot change during the planner system, so one demand read serves the pass. */
  private stepCapacity(site: Entity): number {
    let capacity = this.stepCapacityBySite.get(site);
    if (capacity === undefined) {
      capacity = remainingConstructionSteps(this.world, this.ctx, site);
      this.stepCapacityBySite.set(site, capacity);
    }
    return capacity;
  }
}
