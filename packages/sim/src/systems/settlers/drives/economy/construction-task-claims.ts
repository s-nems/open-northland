import {
  Building,
  CurrentAtomic,
  ownerOf,
  ownersCompatible,
  Palisade,
  SiteAssignment,
  UnderConstruction,
} from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { remainingConstructionSteps } from '../../../economy/construction.js';
import { openRoadSites } from '../../../roads/site-index.js';
import { roadPavingGood } from '../../../roads/sites.js';
import { addUndeliveredConstructionGoods, constructionMaterialsPresent } from '../../../stores/index.js';
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
  private crews: Map<Entity, number> | null = null;
  private hammerSites: readonly Entity[] | undefined;
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

  /** Builders assigned to `site`, one walking in or hauling for it included, with this pass's moves. */
  crewSize(site: Entity): number {
    return this.crewSizes().get(site) ?? 0;
  }

  /** Whether `site` holds its whole bill and steps to hammer, with no builder on it. */
  isReadyUnstaffed(site: Entity): boolean {
    return (
      this.crewSize(site) === 0 &&
      this.hasHammerWork(site) &&
      constructionMaterialsPresent(this.world, this.ctx, site)
    );
  }

  /**
   * Whether some building site on `owner`'s side that held hammer work when the pass first asked passes
   * `accepts`. False spares a builder the site search: claims only take steps away during the pass.
   */
  mayOfferHammer(owner: number | undefined, accepts: (site: Entity) => boolean): boolean {
    this.hammerSites ??= [...this.world.query(UnderConstruction, Building)].filter((site) =>
      this.hasHammerWork(site),
    );
    return this.hammerSites.some(
      (site) => ownersCompatible(owner, ownerOf(this.world, site)) && accepts(site),
    );
  }

  /** Move a builder's crew count from `from` to `to`, either absent for none, for the rest of the pass.
   *  Counts not yet taken need no update: they are read off the assignments as they stand when first
   *  asked. */
  moveCrew(from: Entity | undefined, to: Entity | undefined): void {
    const crews = this.crews;
    if (crews === null || from === to) return;
    if (from !== undefined) {
      const left = (crews.get(from) ?? 0) - 1;
      if (left > 0) crews.set(from, left);
      else crews.delete(from);
    }
    if (to !== undefined) crews.set(to, (crews.get(to) ?? 0) + 1);
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

  /** Builders per site, counted on the first question of the pass. */
  private crewSizes(): Map<Entity, number> {
    if (this.crews !== null) return this.crews;
    const crews = new Map<Entity, number>();
    for (const builder of this.world.query(SiteAssignment)) {
      const site = this.world.get(builder, SiteAssignment).site;
      crews.set(site, (crews.get(site) ?? 0) + 1);
    }
    this.crews = crews;
    return crews;
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
