import {
  CurrentAtomic,
  ownerOf,
  ownersCompatible,
  Palisade,
  SiteAssignment,
  UnderConstruction,
} from '../../../../components/index.js';
import { type Fixed, fx, ONE } from '../../../../core/fixed.js';
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
 * A building site's standing with the builders, weighed ahead of its distance; a higher tier draws a
 * builder off a lower one, up to {@link PRIORITY_CREW} builders. Within a tier the nearest site wins, so
 * the ordinary work spreads over the sites by distance. Owner ruling.
 */
const SITE_TIER = {
  /** Material still to fetch, or nothing to do at all. */
  waiting: 0,
  /** Its whole bill on site or on its way, and no step to hammer until the last load lands: it keeps a
   *  small finishing crew waiting so the load is hammered in as it arrives. */
  covered: 1,
  /** Most of its bill on site and the rest to fetch, so it is finished before fresh sites are begun. */
  nearlyDone: 2,
  /** Steps to hammer on a part-delivered site, and no builder on it. */
  unstaffed: 3,
  /** Its whole bill on site and steps to hammer. */
  ready: 4,
  /** Ready, with no builder on it. */
  readyUnstaffed: 5,
} as const;

/** Builders a ready or nearly done site draws before it ranks like any other: enough to finish it fast
 *  without emptying the other sites. Owner ruling. */
const PRIORITY_CREW = 3;

/** The delivered share of the bill from which a site counts as nearly done: two thirds. Approximation. */
const NEARLY_DONE: Fixed = fx.div(fx.fromInt(2), fx.fromInt(3));

/** Builders a covered site keeps waiting for its last loads: one bringing a load counts, so a crew's own
 *  hauler and one more hand stay while the rest go. Owner ruling. */
const FINISHING_CREW = 2;

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
  private readonly deliveredBySite = new Map<Entity, Fixed>();
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

  /** `site`'s {@link SITE_TIER} as the crews and claims stand now, for `builder`'s pick: its own place in
   *  the crew is not counted, so a site it holds never drops a tier under its own weight and sends it to
   *  a neighbour the same way; two full sites would otherwise trade builders every pass. */
  siteTier(site: Entity, builder: Entity): number {
    const { world, ctx } = this;
    const own = world.tryGet(builder, SiteAssignment)?.site === site ? 1 : 0;
    const crew = this.crewSize(site) - own;
    if (this.hasHammerWork(site)) {
      if (this.materialsPresent(site)) {
        if (crew === 0) return SITE_TIER.readyUnstaffed;
        if (crew < PRIORITY_CREW) return SITE_TIER.ready;
      } else if (crew === 0) {
        return SITE_TIER.unstaffed;
      }
    }
    if (constructionBillCovered(world, ctx, site, this.supply)) return SITE_TIER.covered;
    return crew < PRIORITY_CREW && this.delivered(site) >= NEARLY_DONE
      ? SITE_TIER.nearlyDone
      : SITE_TIER.waiting;
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
   * Rank `owner`'s building sites among `sites` for `builder`'s pick, by tier. The ranks are read as the
   * crews stand at this moment; a site another builder joins later in the pass re-ranks on its own pick.
   */
  rankBuildingSites(owner: number | undefined, sites: readonly Entity[], builder: Entity): SiteRanking {
    const rankOf = new Map<Entity, number>();
    const ranks: number[] = [];
    for (const site of sites) {
      if (!ownersCompatible(owner, ownerOf(this.world, site))) continue;
      const rank = this.siteTier(site, builder);
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

  /** The delivered share of the bill; site stock stays put during the planner, so one read serves. */
  private delivered(site: Entity): Fixed {
    let delivered = this.deliveredBySite.get(site);
    if (delivered === undefined) {
      delivered = deliveredConstructionFraction(this.world, this.ctx, site);
      this.deliveredBySite.set(site, delivered);
    }
    return delivered;
  }
}

interface SoloSiteSurvey {
  /** Sites with an unclaimed delivered step when the pass first asked. */
  readonly hammerable: readonly Entity[];
  /** Every good some site's bill still lacks on site. */
  readonly missing: readonly number[];
}
