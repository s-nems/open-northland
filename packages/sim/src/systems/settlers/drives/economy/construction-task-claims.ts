import { CurrentAtomic, Palisade, UnderConstruction } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { remainingConstructionSteps } from '../../../economy/construction.js';
import { openRoadSites } from '../../../roads/site-index.js';
import { roadPavingGood } from '../../../roads/sites.js';
import { addUndeliveredConstructionGoods } from '../../../stores/index.js';
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
  private walls: SoloSiteSurvey | undefined;

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

  /**
   * Whether any wall segment could give a builder a task: an unclaimed delivered step, or a good some
   * segment still lacks that `canSource` finds. False proves no segment qualifies, so an idle builder
   * skips the scan over every waiting one. One survey serves the pass: claims only take steps away, and
   * site stock stays put during the planner.
   */
  wallMayHaveTask(canSource: (goodType: number) => boolean): boolean {
    this.walls ??= this.survey(this.world.query(UnderConstruction, Palisade));
    return this.mayHaveTask(this.walls, canSource);
  }

  /**
   * {@link wallMayHaveTask} over `owner`'s road sites, from the per-change tally of the unclaimed ones:
   * one holding stock may be hammered, and a bare one needs stone `canSource` finds. Only an unclaimed
   * site can give an automatic builder a task.
   */
  roadMayHaveTask(canSource: (goodType: number) => boolean, owner: number | undefined): boolean {
    const terrain = this.ctx.terrain;
    if (terrain === undefined) return false;
    const open = openRoadSites(this.world, terrain, owner);
    if (open.stocked > 0) return true;
    if (open.unstocked === 0) return false;
    const stone = roadPavingGood(this.ctx.content);
    return stone === undefined || canSource(stone);
  }

  private mayHaveTask(survey: SoloSiteSurvey, canSource: (goodType: number) => boolean): boolean {
    return survey.hammerable.some((site) => this.hasHammerWork(site)) || survey.missing.some(canSource);
  }

  private survey(sites: Iterable<Entity>): SoloSiteSurvey {
    const hammerable: Entity[] = [];
    const missing = new Set<number>();
    for (const site of sites) {
      if (this.hasHammerWork(site)) hammerable.push(site);
      addUndeliveredConstructionGoods(this.world, this.ctx, site, missing);
    }
    return { hammerable, missing: [...missing] };
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

interface SoloSiteSurvey {
  /** Sites with an unclaimed delivered step when the pass first asked. */
  readonly hammerable: readonly Entity[];
  /** Every good some site's bill still lacks on site. */
  readonly missing: readonly number[];
}
