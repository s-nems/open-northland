import {
  CurrentAtomic,
  ownerOf,
  ownersCompatible,
  Palisade,
  SiteAssignment,
  UnderConstruction,
} from '../../../../components/index.js';
import { ONE } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { remainingConstructionSteps } from '../../../economy/construction.js';
import { openRoadSites } from '../../../roads/site-index.js';
import { roadPavingGood } from '../../../roads/sites.js';
import {
  addUndeliveredConstructionGoods,
  constructionBillCovered,
  constructionMaterialsPresent,
  deliveredConstructionFraction,
  type SupplyTally,
} from '../../../stores/index.js';
import { atomicHoldsSettler } from '../../atomics/busy.js';

/**
 * A building site's standing with the builders, weighed ahead of its progress and its distance; a
 * higher tier draws a builder off a lower one. Project rule.
 */
export const SITE_TIER = {
  /** Material still to fetch, or nothing to do at all. */
  waiting: 0,
  /** Its whole bill on site or on its way, and no step to hammer until the last load lands: it keeps a
   *  small finishing crew waiting so the load is hammered in as it arrives. */
  covered: 1,
  /** Steps to hammer on a part-delivered site, and no builder on it. */
  unstaffed: 2,
  /** Its whole bill on site and steps to hammer. */
  ready: 3,
  /** Ready, with no builder on it. */
  readyUnstaffed: 4,
} as const;

/** The progress steps a tier splits into: one per tenth of the bill delivered. */
const PROGRESS_STEPS = 10;
/** Ranks a tier spans: tenths 0 to 10 inclusive. */
const RANKS_PER_TIER = PROGRESS_STEPS + 1;

/** Builders a covered site keeps waiting for its last loads: one bringing a load counts, so a crew's own
 *  hauler and one more hand stay while the rest go. Owner ruling. */
export const FINISHING_CREW = 2;

/** The rank order of one builder's pick: the distinct ranks present, highest first, and each site's. */
export interface SiteRanking {
  readonly ranks: readonly number[];
  readonly rankOf: ReadonlyMap<Entity, number>;
}

/**
 * Planner-tick reservations for hammer swings, one construction step each, and the standing of every
 * building site with the builders. Swings in progress seed the tally; idle builders then claim only
 * steps that already-delivered material can absorb. A builder still walking in holds no step: it would
 * keep the crew already standing at the site off the last swings until it arrived.
 */
export class ConstructionTaskClaims {
  private readonly hammerBySite = new Map<Entity, number>();
  private readonly stepCapacityBySite = new Map<Entity, number>();
  private readonly deliveredTenthsBySite = new Map<Entity, number>();
  private readonly materialsPresentBySite = new Map<Entity, boolean>();
  private crews: Map<Entity, number> | null = null;
  private walls: SoloSiteSurvey | undefined;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly supply: SupplyTally,
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

  /** `site`'s {@link SITE_TIER} as the crews and claims stand now. */
  siteTier(site: Entity): number {
    const { world, ctx } = this;
    if (this.hasHammerWork(site)) {
      const nobody = this.crewSize(site) === 0;
      if (this.materialsPresent(site)) {
        return nobody ? SITE_TIER.readyUnstaffed : SITE_TIER.ready;
      }
      if (nobody) return SITE_TIER.unstaffed;
    }
    return constructionBillCovered(world, ctx, site, this.supply) ? SITE_TIER.covered : SITE_TIER.waiting;
  }

  /** Whether `builder`, one of `site`'s crew, may wait there for its last loads: a covered site with no
   *  step to hammer keeps {@link FINISHING_CREW} of its crew and draws nobody else. */
  hasFinishingRoom(site: Entity, builder: Entity): boolean {
    const { world } = this;
    if (world.tryGet(builder, SiteAssignment)?.site !== site) return false;
    const labor = world.tryGet(site, UnderConstruction)?.labor;
    if (labor === undefined || labor >= ONE || this.hasHammerWork(site)) return false;
    if (!constructionBillCovered(world, this.ctx, site, this.supply)) return false;
    return this.crewSize(site) <= FINISHING_CREW;
  }

  /**
   * Rank `owner`'s building sites among `sites` for one builder's pick: by tier, then by the tenth of
   * the bill delivered, so a site nearer completion draws builders before a fresh one. The ranks are
   * read as the crews stand at this moment; a site another builder joins later in the pass re-ranks on
   * its own pick.
   */
  rankBuildingSites(owner: number | undefined, sites: readonly Entity[]): SiteRanking {
    const rankOf = new Map<Entity, number>();
    const ranks: number[] = [];
    for (const site of sites) {
      if (!ownersCompatible(owner, ownerOf(this.world, site))) continue;
      const rank = this.siteTier(site) * RANKS_PER_TIER + this.deliveredTenths(site);
      rankOf.set(site, rank);
      if (!ranks.includes(rank)) ranks.push(rank);
    }
    ranks.sort((a, b) => b - a);
    return { ranks, rankOf };
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

  /** Site stock stays put during the planner, so one read serves the pass. */
  private materialsPresent(site: Entity): boolean {
    let present = this.materialsPresentBySite.get(site);
    if (present === undefined) {
      present = constructionMaterialsPresent(this.world, this.ctx, site);
      this.materialsPresentBySite.set(site, present);
    }
    return present;
  }

  /** Tenths of the bill on site, 0 to 10; site stock stays put during the planner, so one read serves. */
  private deliveredTenths(site: Entity): number {
    let tenths = this.deliveredTenthsBySite.get(site);
    if (tenths === undefined) {
      const delivered = deliveredConstructionFraction(this.world, this.ctx, site);
      tenths = Math.min(PROGRESS_STEPS, Math.floor((delivered * PROGRESS_STEPS) / ONE));
      this.deliveredTenthsBySite.set(site, tenths);
    }
    return tenths;
  }
}

interface SoloSiteSurvey {
  /** Sites with an unclaimed delivered step when the pass first asked. */
  readonly hammerable: readonly Entity[];
  /** Every good some site's bill still lacks on site. */
  readonly missing: readonly number[];
}
